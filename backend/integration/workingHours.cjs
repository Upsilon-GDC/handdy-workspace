// Isolated loopback replica set only. No production URI or .env access.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Employee = require('../src/models/Employee');
const Attendance = require('../src/models/Attendance');
const Team = require('../src/models/Team');
const Task = require('../src/models/Task');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const WorkingHoursPolicy = require('../src/models/WorkingHoursPolicy');
const controller = require('../src/modules/settings/workingHoursController');
const { syncAttendanceForDay } = require('../src/services/attendanceService');
const { getDateKeyInTimezone, addDateKeyDays, dateKeyToUtc } = require('../src/utils/billingUtils');
const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const today = getDateKeyInTimezone(new Date(), timezone), yesterday = addDateKeyDays(today, -1);
const user = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
let replica;
before(async context => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  if (context.signal.aborted) { await replica.stop(); throw new Error('Startup timeout'); }
  const uri = replica.getUri(`crm_working_hours_${crypto.randomUUID().replaceAll('-', '')}`);
  assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  for (const Model of [Employee, Attendance, Team, Task, TaskTimeLog]) { await Model.createCollection(); await Model.createIndexes(); }
  await controller.ensureWorkingHoursIndexes();
}, { timeout: 900000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
async function invoke(action, body = {}, query = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await action({ user, body, query }, res); return res;
}
async function fixture() {
  const tag = crypto.randomUUID();
  const team = await Team.create({ teamName: `Synthetic ${tag}`, createdBy: user._id });
  const employees = ['First', 'Second'].map(name => ({ _id: new mongoose.Types.ObjectId(), fullName: `${name} Employee`, employeeId: `${name}-${tag}`, email: `${name}-${tag}@example.invalid`, role: 'employee', isActive: true, team: team._id }));
  await Employee.collection.insertMany(employees);
  return { team, employees, employeeIds: employees.map(row => String(row._id)) };
}
const settings = (f, overrides = {}) => ({ employeeIds: f.employeeIds, requiredHours: '7.8', effectiveFrom: today, halfDayPercent: 50, versions: f.employeeIds.map(employee => ({ employee, version: 0 })), ...overrides });
async function logsFor(f, date = yesterday) {
  const task = await Task.create({ taskName: 'Synthetic work', taskCode: crypto.randomUUID(), team: f.team._id, teams: [f.team._id], createdBy: user._id });
  const start = dateKeyToUtc(date, timezone);
  for (const employee of f.employees) {
    await TaskTimeLog.create({ employee: employee._id, project: new mongoose.Types.ObjectId(), task: task._id, startedAt: start, stoppedAt: new Date(+start + 3 * 3600000), status: 'stopped', isActiveTimer: false, totalWorkedSeconds: 10800 });
    await syncAttendanceForDay(employee._id, date);
    await WorkingHoursPolicy.create({ employee: employee._id, version: 1, revisions: [{ effectiveFrom: date, requiredSeconds: 28080, halfDayPercent: 60, changedBy: user._id, changedAt: new Date() }] });
  }
}
test('bulk configuration persists exact decimals, teams and independent employee revisions', async () => {
  const f = await fixture();
  const saved = await invoke(controller.saveWorkingHoursSettings, settings(f));
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
  const policies = await WorkingHoursPolicy.find({ employee: { $in: f.employeeIds } }).lean();
  assert.equal(policies.length, 2); assert.ok(policies.every(row => row.version === 1 && row.revisions[0].requiredSeconds === 28080));
  const loaded = await invoke(controller.getWorkingHoursSettings, {}, { date: today });
  const rows = loaded.body.employees.filter(row => f.employeeIds.includes(String(row._id)));
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.team.teamName === f.team.teamName && row.policy.requiredSeconds === 28080));
});
test('stale employee versions roll back the entire selected batch', async () => {
  const f = await fixture();
  await invoke(controller.saveWorkingHoursSettings, settings(f));
  const saved = await invoke(controller.saveWorkingHoursSettings, settings(f, { requiredHours: '8', versions: [{ employee: f.employeeIds[0], version: 1 }, { employee: f.employeeIds[1], version: 0 }] }));
  assert.equal(saved.code, 409);
  const rows = await WorkingHoursPolicy.find({ employee: { $in: f.employeeIds } }).lean();
  assert.ok(rows.every(row => row.version === 1 && row.revisions.length === 1));
});
test('new requirements do not change historical reports; retroactive schedule edits are rejected', async () => {
  const f = await fixture(); await logsFor(f);
  const query = { date: yesterday, team: String(f.team._id) };
  const before = await invoke(controller.getWorkingHoursOverview, {}, query);
  assert.equal(before.body.totals.requiredSeconds, 56160); assert.equal(before.body.totals.completedSeconds, 21600);
  const saved = await invoke(controller.saveWorkingHoursSettings, settings(f, { requiredHours: '8.5', versions: f.employeeIds.map(employee => ({ employee, version: 1 })) }));
  assert.equal(saved.code, 200);
  const after = await invoke(controller.getWorkingHoursOverview, {}, query);
  assert.deepEqual(after.body.totals, before.body.totals);
  const rejected = await invoke(controller.saveWorkingHoursSettings, settings(f, { effectiveFrom: yesterday }));
  assert.equal(rejected.code, 400);
});
test('approved leave and half day survive attendance resync without modifying tracked time', async () => {
  const f = await fixture(); await logsFor(f);
  const beforeLogs = await TaskTimeLog.find({ employee: { $in: f.employeeIds } }).lean();
  const half = await invoke(controller.saveWorkingHoursAdjustment, { employeeIds: [f.employeeIds[0]], date: yesterday, type: 'half_day', reason: 'Approved half-day attendance' });
  assert.equal(half.code, 200, JSON.stringify(half.body));
  const leave = await invoke(controller.saveWorkingHoursAdjustment, { employeeIds: [f.employeeIds[1]], date: yesterday, type: 'leave', reason: 'Approved leave recorded by Admin' });
  assert.equal(leave.code, 200);
  for (const employee of f.employeeIds) await syncAttendanceForDay(employee, yesterday);
  const summary = await invoke(controller.getWorkingHoursOverview, {}, { date: yesterday, team: String(f.team._id) });
  assert.equal(summary.code, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.totals.presentCount, 1); assert.equal(summary.body.totals.requiredSeconds, 16848); assert.equal(summary.body.totals.completedSeconds, 10800);
  assert.equal(summary.body.teams[0].members[1].attendance, 'Approved leave');
  assert.deepEqual(await TaskTimeLog.find({ employee: { $in: f.employeeIds } }).lean(), beforeLogs);
  await invoke(controller.saveWorkingHoursAdjustment, { employeeIds: [f.employeeIds[1]], date: yesterday, type: 'normal', reason: 'Leave correction approved' });
  const attendance = await Attendance.findOne({ employee: f.employeeIds[1], date: yesterday }).lean();
  assert.equal(attendance.workingHoursAdjustments.length, 2); assert.equal(attendance.status, 'Present');
});
test('exceptions cannot create presence for an employee without attendance', async () => {
  const f = await fixture();
  const saved = await invoke(controller.saveWorkingHoursAdjustment, { employeeIds: f.employeeIds, date: yesterday, type: 'half_day', reason: 'Half day approved in advance' });
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
  const summary = await invoke(controller.getWorkingHoursOverview, {}, { date: yesterday, team: String(f.team._id) });
  assert.equal(summary.body.totals.presentCount, 0); assert.equal(summary.body.totals.requiredSeconds, 0);
});
test('malformed inputs reject before writes; missing employees do not partially update valid employees', async () => {
  const f = await fixture();
  for (const payload of [settings(f, { requiredHours: '7.800' }), settings(f, { halfDayPercent: 0 }), settings(f, { versions: [] }), settings(f, { employeeIds: [f.employeeIds[0], f.employeeIds[0]] })]) assert.equal((await invoke(controller.saveWorkingHoursSettings, payload)).code, 400);
  const missing = String(new mongoose.Types.ObjectId());
  assert.equal((await invoke(controller.saveWorkingHoursSettings, settings(f, { employeeIds: [f.employeeIds[0], missing], versions: [{ employee: f.employeeIds[0], version: 0 }, { employee: missing, version: 0 }] }))).code, 409);
  assert.equal(await WorkingHoursPolicy.countDocuments({ employee: { $in: f.employeeIds } }), 0);
  assert.equal((await invoke(controller.getWorkingHoursOverview, {}, { date: '2026-02-30' })).code, 400);
  assert.equal((await invoke(controller.getWorkingHoursOverview, {}, { date: addDateKeyDays(today, 1) })).code, 400);
  assert.equal((await invoke(controller.getWorkingHoursOverview, {}, { date: yesterday, team: 'invalid' })).code, 400);
});
