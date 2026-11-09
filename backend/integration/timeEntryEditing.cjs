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
const { createManualEntry, deleteManualEntry, ensureManualEntryIndexes } = require('../src/modules/timers/manualTimeEntryController');
const { startTimer, stopTimer } = require('../src/modules/timers/taskTimeLogController');
const { checkIn, checkOut } = require('../src/modules/attendance/attendanceController');
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
  await ensureManualEntryIndexes();
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

const manualPayload = (f, extra = {}) => ({ employee: String(f.employee._id), project: String(f.project._id),
  client: String(f.client._id), task: String(f.task._id), startedAt: '2026-01-01T12:00:00Z',
  stoppedAt: '2026-01-01T13:00:00Z', reason: 'Forgot the synthetic timer', ...extra });

test('retired attendance requests cannot create presence for an employee without activity', async () => {
  const f = await fixture();
  const actor = { ...f.employee, _id: new mongoose.Types.ObjectId() };
  for (const handler of [checkIn, checkOut]) {
    const result = await invoke(handler, f, { source: 'check_in', status: 'Present' }, actor);
    assert.equal(result.code, 410);
    assert.equal(result.body.code, 'ATTENDANCE_TIMER_MANAGED');
  }
  assert.equal(await Attendance.countDocuments({ employee: actor._id }), 0);
  assert.equal(await TaskTimeLog.countDocuments({ employee: actor._id }), 0);
});

test('legacy requests racing timer actions cannot close or overwrite timer-owned attendance', async () => {
  const f = await fixture();
  const old = await Attendance.create({ employee: f.employee._id, date: '2025-12-31', source: 'check_in', checkIn: '2025-12-31T09:00:00Z' });
  const historical = old.toObject();
  const legacyRequests = () => Promise.all(Array.from({ length: 8 }, (_, i) => invoke(i % 2 ? checkIn : checkOut, f, {}, f.employee)));
  const [started, firstLegacy] = await Promise.all([
    invoke(startTimer, f, { project: String(f.project._id), task: String(f.task._id), client: String(f.client._id) }, f.employee),
    legacyRequests(),
  ]);
  assert.equal(started.code, 201, JSON.stringify(started.body));
  assert.ok(firstLegacy.every(result => result.code === 410));
  const live = await TaskTimeLog.findById(started.body.timeLog._id).lean();
  const open = await Attendance.findOne({ employee: f.employee._id, checkIn: live.startedAt, source: 'timer' }).lean();
  assert.ok(open);
  assert.equal(open.checkOut, null);
  assert.ok((await legacyRequests()).every(result => result.code === 410));
  assert.deepEqual(await Attendance.findById(open._id).lean(), open);
  const [stopped, lastLegacy] = await Promise.all([
    invoke(stopTimer, f, { timeLogId: String(live._id) }, f.employee),
    legacyRequests(),
  ]);
  assert.equal(stopped.code, 200);
  assert.ok(lastLegacy.every(result => result.code === 410));
  const closed = await Attendance.findById(open._id).lean();
  assert.equal(+closed.checkOut, +stopped.body.timeLog.stoppedAt);
  assert.equal(closed.source, 'timer');
  assert.deepEqual(await Attendance.findById(old._id).lean(), historical, 'historical legacy row remains unchanged');
});

test('overnight attendance remains on the start day and only time-entry reconciliation closes it', async () => {
  const f = await fixture();
  const start = new Date('2026-01-01T18:00:00Z'); // 23:30 in the business timezone.
  const end = new Date('2026-01-01T20:00:00Z'); // 01:30 the following day.
  await TaskTimeLog.updateOne({ _id: f.log._id }, { $set: { startedAt: start, stoppedAt: null, status: 'paused', isActiveTimer: true } });
  await syncAttendanceForDay(f.employee._id, '2026-01-01', 'Asia/Kolkata');
  const before = await Attendance.findOne({ employee: f.employee._id, date: '2026-01-01' }).lean();
  assert.equal(before.checkOut, null);
  assert.equal((await invoke(checkOut, f, {}, f.employee)).code, 410);
  assert.deepEqual(await Attendance.findById(before._id).lean(), before);
  await TaskTimeLog.updateOne({ _id: f.log._id }, { $set: { stoppedAt: end, status: 'stopped', isActiveTimer: false } });
  await syncAttendanceForDay(f.employee._id, '2026-01-01', 'Asia/Kolkata');
  const after = await Attendance.findById(before._id).lean();
  assert.equal(+after.checkIn, +start);
  assert.equal(+after.checkOut, +end);
  assert.equal(after.totalHours, 2);
  assert.equal(after.source, 'timer');
  assert.equal(await Attendance.countDocuments({ employee: f.employee._id, date: '2026-01-02' }), 0);
});

test('eight concurrent overlapping manual creates accept exactly one interval', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => invoke(createManualEntry, f, manualPayload(f, { operationId: crypto.randomUUID() }))));
  assert.deepEqual(results.map(result => result.code).sort(), [201, 409, 409, 409, 409, 409, 409, 409]);
  assert.equal(await TaskTimeLog.countDocuments({ employee: f.employee._id, entrySource: 'manual' }), 1);
});

test('concurrent manual retries replay one entry, reject changed payloads and retain identity after correction/deletion', async () => {
  const f = await fixture(); const body = manualPayload(f, { operationId: crypto.randomUUID() });
  const results = await Promise.all(Array.from({ length: 6 }, () => invoke(createManualEntry, f, body)));
  assert.deepEqual(results.map(result => result.code).sort(), [200, 200, 200, 200, 200, 201]);
  const entryId = results[0].body.timeLog._id;
  assert.ok(results.every(result => String(result.body.timeLog._id) === String(entryId)));
  assert.equal((await invoke(createManualEntry, f, { ...body, reason: 'Different request content' })).body.code, 'OPERATION_ID_REUSED');
  const log = await TaskTimeLog.findById(entryId);
  const g = { ...f, log };
  assert.equal((await invoke(editTimeEntry, g, { ...payload(g), segments: [{ type: 'work', start: '2026-01-01T14:00:00Z', end: '2026-01-01T15:00:00Z' }] })).code, 200);
  const replay = await invoke(createManualEntry, f, body);
  assert.equal(replay.code, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(+new Date(replay.body.timeLog.startedAt), +new Date('2026-01-01T14:00:00Z'));
  assert.equal((await invoke(deleteManualEntry, g)).code, 200);
  assert.equal((await invoke(createManualEntry, f, body)).body.code, 'ENTRY_DELETED');
  assert.equal(await TaskTimeLog.countDocuments({ employee: f.employee._id, manualOperationId: body.operationId }), 1);
});

test('touching manual intervals both save while manual creation and correction contend for one interval', async () => {
  const f = await fixture();
  const touching = await Promise.all([
    invoke(createManualEntry, f, manualPayload(f)),
    invoke(createManualEntry, f, manualPayload(f, { startedAt: '2026-01-01T13:00:00Z', stoppedAt: '2026-01-01T14:00:00Z' })),
  ]);
  assert.deepEqual(touching.map(result => result.code), [201, 201]);
  const g = await fixture();
  const correction = { ...payload(g), segments: [{ type: 'work', start: '2026-01-01T12:00:00Z', end: '2026-01-01T13:00:00Z' }] };
  const results = await Promise.all([invoke(createManualEntry, g, manualPayload(g)), invoke(editTimeEntry, g, correction)]);
  assert.equal(results.filter(result => [200, 201].includes(result.code)).length, 1, JSON.stringify(results));
  assert.equal(results.filter(result => result.code === 409).length, 1);
  assert.equal(await TaskTimeLog.countDocuments({ employee: g.employee._id, startedAt: new Date('2026-01-01T12:00:00Z') }), 1);
});

test('live starts, manual writes and corrections preserve non-overlap and active-timer protection', async () => {
  const f = await fixture();
  const startBody = { project: String(f.project._id), client: String(f.client._id), task: String(f.task._id), operationId: crypto.randomUUID() };
  const results = await Promise.all([
    invoke(startTimer, f, startBody, f.employee),
    invoke(createManualEntry, f, manualPayload(f)),
  ]);
  assert.deepEqual(results.map(result => result.code), [201, 201], JSON.stringify(results));
  const live = await TaskTimeLog.findById(results[0].body.timeLog._id);
  // While this live timer owns the present interval, neither writer can
  // insert or move historical work into it, even when both arrive together.
  await new Promise(resolve => setTimeout(resolve, 5));
  const end = new Date(); const start = new Date(+live.startedAt - 60_000);
  const overlap = await Promise.all([
    invoke(createManualEntry, f, manualPayload(f, { startedAt: start.toISOString(), stoppedAt: end.toISOString() })),
    invoke(editTimeEntry, f, { ...payload(f), segments: [{ type: 'work', start: start.toISOString(), end: end.toISOString() }] }),
  ]);
  assert.deepEqual(overlap.map(result => result.code), [409, 409]);
  const stopped = await invoke(stopTimer, f, { timeLogId: String(live._id) }, f.employee);
  assert.equal(stopped.code, 200);
  const intervals = await TaskTimeLog.find({ employee: f.employee._id }).sort('startedAt').lean();
  for (let i = 1; i < intervals.length; i++) assert.ok(+intervals[i - 1].stoppedAt <= +intervals[i].startedAt);
});

test('failed manual insertion releases coordination so a later valid submission can save', async () => {
  const f = await fixture();
  await mongoose.connection.db.command({ collMod: TaskTimeLog.collection.name, validator: { entrySource: { $ne: 'manual' } }, validationAction: 'error' });
  try { assert.equal((await invoke(createManualEntry, f, manualPayload(f))).code, 500); }
  finally { await mongoose.connection.db.command({ collMod: TaskTimeLog.collection.name, validator: {} }); }
  assert.equal((await invoke(createManualEntry, f, manualPayload(f))).code, 201);
});
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
