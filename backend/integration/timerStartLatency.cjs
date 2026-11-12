// Isolated database only. Optional baseline is the pre-edit local controller;
// no application URI or .env is read. Compare database commands, not fake UI time.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Employee = require('../src/models/Employee');
const Team = require('../src/models/Team');
const Project = require('../src/models/Project');
const Client = require('../src/models/Client');
const Task = require('../src/models/Task');
const Mapping = require('../src/models/ActivityMapping');
const Log = require('../src/models/TaskTimeLog');
const Attendance = require('../src/models/Attendance');
const current = require('../src/modules/timers/taskTimeLogController');
let replica, trace = null;
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  const uri = replica.getUri(`timer_latency_${crypto.randomUUID().replaceAll('-', '')}`); assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false, monitorCommands: true });
  for (const Model of [Employee, Team, Project, Client, Task, Mapping, Log, Attendance]) { await Model.createCollection(); await Model.createIndexes(); }
  mongoose.connection.getClient().on('commandStarted', event => {
    if (trace && ['find', 'insert', 'findAndModify', 'update', 'aggregate'].includes(event.commandName)) trace.push({ name: event.commandName, collection: event.command[event.commandName] });
  });
}, { timeout: 180000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
async function invoke(handler, user, body) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ user, body }, res); return res;
}
async function measure(controller, label) {
  const actor = new mongoose.Types.ObjectId(), suffix = crypto.randomUUID();
  const team = await Team.create({ teamName: suffix, createdBy: actor });
  const user = { _id: actor, team: team._id, role: 'employee' };
  const client = await Client.create({ clientName: 'Selected client', email: 'private@example.invalid', createdBy: actor });
  const project = await Project.create({ projectCode: suffix, projectName: 'Selected project', teams: [team._id], clients: [client._id], activityMappingEnabled: true, description: 'private notes', createdBy: actor });
  const task = await Task.create({ taskCode: suffix, taskName: 'Selected task', taskType: 'work', team: team._id, teams: [team._id], assignToAllEmployees: true, createdBy: actor });
  await Mapping.create({ project: project._id, client: client._id, task: task._id });
  const body = { project: String(project._id), client: String(client._id), task: String(task._id), operationId: crypto.randomUUID() };
  trace = []; const before = performance.now();
  const res = await invoke(controller.startTimer, user, body);
  const ms = performance.now() - before, commands = trace; trace = null;
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.timeLog.project.projectName, 'Selected project'); assert.equal(res.body.timeLog.task.taskType, 'work'); assert.equal(res.body.timeLog.client.clientName, 'Selected client');
  assert.equal(res.body.timeLog.project.description, undefined); assert.equal(res.body.timeLog.client.email, undefined);
  assert.equal(await Log.countDocuments({ employee: actor, isActiveTimer: true }), 1);
  const attendance = await Attendance.findOne({ employee: actor }).lean(); assert.equal(attendance.status, 'Present', 'Attendance is committed before replying');
  const replay = await invoke(controller.startTimer, user, body); assert.equal(replay.statusCode, 200); assert.equal(replay.body.replayed, true); assert.equal(String(replay.body.timeLog._id), String(res.body.timeLog._id));
  await invoke(controller.stopTimer, user, { timeLogId: String(res.body.timeLog._id), operationId: crypto.randomUUID() });
  return { label, milliseconds: Math.round(ms * 100) / 100, commandCount: commands.length, commands };
}
test('fresh mapped starts avoid redundant reference reads while preserving attendance, metadata and retries', async () => {
  const results = [];
  if (process.env.TIMER_START_BASELINE_PATH) {
    const file = require.resolve('../src/modules/timers/taskTimeLogController');
    const baseline = new Module(file, module); baseline.filename = file; baseline.paths = Module._nodeModulePaths(path.dirname(file));
    baseline._compile(fs.readFileSync(process.env.TIMER_START_BASELINE_PATH, 'utf8'), file);
    results.push(await measure(baseline.exports, 'before'));
  }
  const result = await measure(current, 'after'); results.push(result);
  assert.equal(result.commands.filter(row => row.name === 'find' && row.collection === 'projects').length, 1);
  assert.equal(result.commands.filter(row => row.name === 'find' && row.collection === 'clients').length, 1);
  assert.equal(result.commands.filter(row => row.name === 'find' && row.collection === 'tasks').length, 1);
  if (results.length === 2) assert.equal(results[0].commandCount - result.commandCount, 3);
  console.log(JSON.stringify({ results, note: 'Local MongoDB timings; not deployed network latency.' }));
});
