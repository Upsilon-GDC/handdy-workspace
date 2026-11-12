// Disposable loopback MongoDB only; no .env or company database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Log = require('../src/models/TaskTimeLog');
const Task = require('../src/models/Task');
const Attendance = require('../src/models/Attendance');
const Settings = require('../src/models/SystemSettings');
const { invalidateSettings } = require('../src/services/idlePolicySettings');
const { heartbeatTimer } = require('../src/modules/timers/taskTimeLogController');
let replica;
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  const uri = replica.getUri(`idle_safety_${crypto.randomUUID().replaceAll('-', '')}`); assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  for (const Model of [Log, Task, Attendance, Settings]) { await Model.createCollection(); await Model.createIndexes(); }
  await Settings.create({ key: 'global', idleThresholdMinutes: 26, autoLogoutMinutes: 50 }); invalidateSettings();
}, { timeout: 180000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
async function fixture(taskType = 'work', person = {}) {
  const user = { _id: new mongoose.Types.ObjectId(), ...person };
  const task = await Task.create({ taskCode: crypto.randomUUID(), taskName: 'Synthetic work', taskType, idleLogout: false, createdBy: user._id });
  const timer = await Log.create({ employee: user._id, task: task._id, project: new mongoose.Types.ObjectId(), startedAt: new Date(Date.now() - 5*3600000),
    desktopHeartbeatAt: new Date(), status: 'running', isActiveTimer: true, pauses: [] });
  return { user, timer, taskType };
}
async function heartbeat(f, sample, overrides = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await heartbeatTimer({ user: f.user, body: { timeLogId: String(f.timer._id), ...(sample === undefined ? {} : { osIdleSeconds: sample, appVersion: 'test-version' }), ...overrides } }, res); return res;
}
test('a 26-minute idle sample stops a five-hour work session despite a missed desktop idle poll', async () => {
  const f = await fixture(); const response = await heartbeat(f, 1560);
  assert.equal(response.code, 200, JSON.stringify(response.body)); assert.equal(response.body.idleStopped, true);
  const saved = await Log.findById(f.timer._id).lean();
  assert.equal(saved.status, 'stopped'); assert.equal(saved.isActiveTimer, false);
  assert.ok(Math.abs(saved.totalIdleSeconds - 1560) <= 1); assert.ok(Math.abs(saved.totalWorkedSeconds - (18000 - 1560)) <= 1);
  assert.equal(saved.pauses[0].reason, 'idle'); assert.equal(saved.desktopIdleSample.appVersion, 'test-version');
  assert.equal((await heartbeat(f, 1560)).code, 404);
  assert.equal((await Settings.findOne({ key: 'global' }).lean()).idleThresholdMinutes, 26, 'policy is not changed');
});
test('five-hour active work is never inferred idle from session length', async () => {
  const f = await fixture(); const response = await heartbeat(f, 10);
  assert.equal(response.code, 200); assert.equal(response.body.idleStopped, undefined);
  const saved = await Log.findById(f.timer._id).lean(); assert.equal(saved.status, 'running'); assert.equal(saved.desktopIdleSample.seconds, 10);
});
test('break tasks, exempt employees and intentional pauses retain their behavior', async () => {
  for (const f of [await fixture('break'), await fixture('work', { idleTrackingExempt: true }), await fixture()]) {
    if (f.taskType !== 'break' && !f.user.idleTrackingExempt) await Log.updateOne({ _id: f.timer._id }, { $set: { status: 'paused' }, $push: { pauses: { reason: 'break', pausedAt: new Date() } } });
    const response = await heartbeat(f, 3000); assert.equal(response.code, 200); assert.equal(response.body.idleStopped, undefined);
    assert.equal((await Log.findById(f.timer._id).lean()).isActiveTimer, true);
  }
});
test('employee threshold overrides apply and a stale heartbeat cannot stop a different timer', async () => {
  const f = await fixture('work', { idlePolicyOverride: { idleThresholdMinutes: 5, autoLogoutMinutes: 50 } });
  assert.equal((await heartbeat(f, 300)).body.idleStopped, true);
  const g = await fixture(); const reply = await heartbeat(g, 3000, { timeLogId: String(new mongoose.Types.ObjectId()) });
  assert.equal(reply.code, 404); assert.equal((await Log.findById(g.timer._id).lean()).status, 'running');
  assert.equal((await heartbeat(g, -1)).code, 400);
  assert.equal((await heartbeat(g, undefined)).code, 200, 'older apps keep the normal heartbeat contract');
});

test('an intentional pause arriving during the heartbeat check is not stopped as idle', async t => {
  const f = await fixture();
  t.mock.method(Task, 'findById', () => ({ select() { return this; }, lean: async () => {
    await Log.updateOne({ _id: f.timer._id }, { $set: { status: 'paused' }, $push: { pauses: { reason: 'break', pausedAt: new Date() } } });
    return { taskType: 'work' };
  } }));
  const response = await heartbeat(f, 1560);
  assert.equal(response.code, 200); assert.equal(response.body.idleStopped, undefined);
  const saved = await Log.findById(f.timer._id).lean(); assert.equal(saved.status, 'paused'); assert.equal(saved.isActiveTimer, true);
});
