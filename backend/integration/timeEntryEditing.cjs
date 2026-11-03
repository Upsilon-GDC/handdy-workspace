const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Employee = require('../src/models/Employee');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const Client = require('../src/models/Client');
const Team = require('../src/models/Team');
const Attendance = require('../src/models/Attendance');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const ActivityMapping = require('../src/models/ActivityMapping');
const TimeEntryEdit = require('../src/models/TimeEntryEdit');
const { editTimeEntry, getTimeEntryForEdit, ensureTimeEntryEditIndexes } = require('../src/modules/timers/timeEntryEditController');
const { ensureActivityMappingIndexes } = require('../src/services/activityMappings');
const { syncAttendanceForDay } = require('../src/services/attendanceService');
let replica;
const user = { _id: new mongoose.Types.ObjectId(), role: 'manager' };
before(async context => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  if (context.signal.aborted) { await replica.stop(); throw new Error('Startup timeout'); }
  const uri = replica.getUri(`crm_entry_edits_${crypto.randomUUID().replaceAll('-', '')}`);
  assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  for (const Model of [Employee, Project, Task, Client, Team, Attendance, TaskTimeLog]) { await Model.createCollection(); await Model.createIndexes(); }
  await ensureActivityMappingIndexes(); await ensureTimeEntryEditIndexes();
}, { timeout: 900000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
async function fixture() {
  const tag = crypto.randomUUID();
  const employee = { _id: new mongoose.Types.ObjectId(), fullName: 'Synthetic Employee', employeeId: tag, email: `${tag}@example.invalid`, role: 'employee', isActive: true };
  const team = await Team.create({ teamName: tag, createdBy: user._id }); employee.team = team._id;
  await Employee.collection.insertOne(employee);
  const client = await Client.create({ clientName: 'Synthetic Client', createdBy: user._id });
  const project = await Project.create({ projectName: 'Synthetic Project', projectCode: tag, clients: [client._id], teams: [team._id], activityMappingEnabled: true, createdBy: user._id });
  const task = await Task.create({ taskCode: tag, taskName: 'Synthetic Task', project: project._id, team: team._id, teams: [team._id], assignToAllEmployees: true, createdBy: user._id });
  const mapping = await ActivityMapping.create({ project: project._id, client: client._id, task: task._id });
  const log = await TaskTimeLog.create({ employee: employee._id, project: project._id, client: client._id, task: task._id, activityMapping: mapping._id,
    startedAt: '2026-01-01T09:00:00Z', stoppedAt: '2026-01-01T10:00:00Z', status: 'stopped', isActiveTimer: false, totalWorkedSeconds: 3600 });
  await syncAttendanceForDay(employee._id, '2026-01-01');
  return { employee, project, client, task, mapping, log };
}
const payload = f => ({ project: String(f.project._id), client: String(f.client._id), task: String(f.task._id),
  expectedVersion: f.log.editVersion || 0, expectedUpdatedAt: f.log.updatedAt.toISOString(), reason: 'Correct synthetic entry', note: 'Corrected note',
  segments: [{ type: 'work', start: '2026-01-01T09:00:00Z', end: '2026-01-01T10:00:00Z' }] });
async function invoke(controller, f, body = payload(f), actor = user) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await controller({ user: actor, params: { id: String(f.log._id) }, body }, res); return res;
}
test('whole activity and segment corrections save totals, mapping and immutable before/after audit', async () => {
  const f = await fixture();
  const second = await Task.create({ taskCode: crypto.randomUUID(), taskName: 'Correct activity', project: f.project._id, team: f.employee.team, teams: [f.employee.team], assignToAllEmployees: true, createdBy: user._id });
  const map = await ActivityMapping.create({ project: f.project._id, client: f.client._id, task: second._id });
  const body = { ...payload(f), task: String(second._id), segments: [
    { type: 'work', start: '2026-01-01T09:00:00Z', end: '2026-01-01T09:30:00Z' },
    { type: 'idle', start: '2026-01-01T09:30:00Z', end: '2026-01-01T09:40:00Z' },
    { type: 'work', start: '2026-01-01T09:40:00Z', end: '2026-01-01T10:00:00Z' },
  ] };
  const result = await invoke(editTimeEntry, f, body); assert.equal(result.code, 200, JSON.stringify(result.body));
  const saved = await TaskTimeLog.findById(f.log._id).lean();
  assert.equal(saved.totalWorkedSeconds, 3000); assert.equal(saved.totalIdleSeconds, 600);
  assert.equal(String(saved.activityMapping), String(map._id)); assert.equal(saved.editVersion, 1);
  const audit = await TimeEntryEdit.findOne({ timeLog: f.log._id }).lean();
  assert.equal(String(audit.before.task), String(f.task._id)); assert.equal(String(audit.after.task), String(second._id));
  assert.equal(typeof audit.after.task.toHexString, 'function', 'After snapshot retains MongoDB ObjectId values');
  assert.equal(String(audit.editedBy), String(user._id)); assert.equal(audit.reason, body.reason);
});
test('date changes atomically reconcile old and new attendance days', async () => {
  const f = await fixture(); const body = payload(f);
  body.segments = [{ type: 'work', start: '2026-01-02T09:00:00Z', end: '2026-01-02T11:00:00Z' }];
  assert.equal((await invoke(editTimeEntry, f, body)).code, 200);
  assert.equal((await Attendance.findOne({ employee: f.employee._id, date: '2026-01-01' })).status, 'Absent');
  const updated = await Attendance.findOne({ employee: f.employee._id, date: '2026-01-02' });
  assert.equal(updated.status, 'Present'); assert.equal(updated.totalHours, 2);
});
test('simultaneous edits to the same entry reject one stale revision', async () => {
  const f = await fixture();
  const results = await Promise.all([invoke(editTimeEntry, f), invoke(editTimeEntry, f)]);
  assert.deepEqual(results.map(result => result.code).sort(), [200, 409]);
  assert.equal(await TimeEntryEdit.countDocuments({ timeLog: f.log._id }), 1);
});
test('different entry edits for one employee serialize and cannot introduce overlapping intervals', async () => {
  const f = await fixture();
  const log = await TaskTimeLog.create({ ...f.log.toObject(), _id: new mongoose.Types.ObjectId(), startedAt: '2026-01-01T08:00:00Z', stoppedAt: '2026-01-01T08:30:00Z' });
  const g = { ...f, log };
  const target = [{ type: 'work', start: '2026-01-01T12:00:00Z', end: '2026-01-01T13:00:00Z' }];
  const results = await Promise.all([invoke(editTimeEntry, f, { ...payload(f), segments: target }), invoke(editTimeEntry, g, { ...payload(g), segments: target })]);
  assert.deepEqual(results.map(result => result.code).sort(), [200, 409]);
});
test('audit insert failure rolls back the log and employee lock version', async () => {
  const f = await fixture();
  await mongoose.connection.db.command({ collMod: TimeEntryEdit.collection.name, validator: { revision: { $lt: 1 } }, validationAction: 'error', validationLevel: 'strict' });
  try {
    assert.equal((await invoke(editTimeEntry, f)).code, 500);
    assert.equal((await TaskTimeLog.findById(f.log._id)).editVersion, 0);
    assert.equal(await TimeEntryEdit.countDocuments({ timeLog: f.log._id }), 0);
    assert.equal((await Employee.findById(f.employee._id)).timeEntryEditVersion, 0);
  } finally { await mongoose.connection.db.command({ collMod: TimeEntryEdit.collection.name, validator: {} }); }
});
test('attendance write failure rolls back both the correction and already inserted audit', async () => {
  const f = await fixture();
  await mongoose.connection.db.command({ collMod: Attendance.collection.name, validator: { employee: { $ne: f.employee._id } }, validationAction: 'error', validationLevel: 'strict' });
  try {
    assert.equal((await invoke(editTimeEntry, f)).code, 500);
    assert.equal((await TaskTimeLog.findById(f.log._id)).editVersion, 0);
    assert.equal(await TimeEntryEdit.countDocuments({ timeLog: f.log._id }), 0);
  } finally { await mongoose.connection.db.command({ collMod: Attendance.collection.name, validator: {} }); }
});
test('active entries, existing overlaps and unauthorized activity choices are rejected', async () => {
  const f = await fixture();
  await TaskTimeLog.updateOne({ _id: f.log._id }, { $set: { status: 'running', isActiveTimer: true, stoppedAt: null } });
  assert.equal((await invoke(editTimeEntry, f)).code, 409);
  assert.equal((await invoke(getTimeEntryForEdit, f)).code, 409);
  assert.equal(await TimeEntryEdit.countDocuments({ timeLog: f.log._id }), 0);
  const g = await fixture(); const other = await fixture();
  assert.equal((await invoke(editTimeEntry, g, { ...payload(g), project: String(other.project._id), client: String(other.client._id), task: String(other.task._id) })).code, 400);
  await TaskTimeLog.create({ employee: g.employee._id, project: g.project._id, task: g.task._id, startedAt: '2026-01-01T12:00:00Z', stoppedAt: '2026-01-01T13:00:00Z', status: 'stopped', isActiveTimer: false });
  assert.equal((await invoke(editTimeEntry, g, { ...payload(g), segments: [{ type: 'work', start: '2026-01-01T09:00:00Z', end: '2026-01-01T12:30:00Z' }] })).code, 409);
});
test('archived original activity can be retained for time-only correction and history is readable', async () => {
  const f = await fixture();
  await Task.updateOne({ _id: f.task._id }, { $set: { isActive: false } });
  await ActivityMapping.updateOne({ _id: f.mapping._id }, { $set: { isActive: false } });
  const opened = await invoke(getTimeEntryForEdit, f); assert.equal(opened.code, 200);
  assert.ok(opened.body.options.tasks.some(task => String(task._id) === String(f.task._id)));
  assert.equal((await invoke(editTimeEntry, f)).code, 200);
  const history = await invoke(getTimeEntryForEdit, f);
  assert.equal(history.body.history.length, 1);
  assert.equal(String(history.body.record.activityMapping), String(f.mapping._id));
});

test('a historical entry without a client can be corrected without inventing an attribution', async () => {
  const f = await fixture();
  await TaskTimeLog.updateOne({ _id: f.log._id }, { $set: { client: null }, $unset: { activityMapping: '' } });
  f.log = await TaskTimeLog.findById(f.log._id);
  assert.equal((await invoke(getTimeEntryForEdit, f)).code, 200);
  assert.equal((await invoke(editTimeEntry, f, { ...payload(f), client: null })).code, 200);
  const saved = await TaskTimeLog.findById(f.log._id).lean();
  assert.equal(saved.client, null);
  assert.equal(saved.activityMapping, undefined);
});
