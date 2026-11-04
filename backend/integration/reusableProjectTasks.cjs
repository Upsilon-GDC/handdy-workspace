const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const Team = require('../src/models/Team');
const Employee = require('../src/models/Employee');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const { createProject } = require('../src/modules/projects/projectController');
const { startTimer, stopTimer } = require('../src/modules/timers/taskTimeLogController');
const { activityOptionsForEmployee } = require('../src/services/activitySelection');
const { createManualEntry, getManualEntryOptions } = require('../src/modules/timers/manualTimeEntryController');
let database;
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
before(async () => {
  database = await MongoMemoryServer.create({ binary: { version: '7.0.24' }, instance: { ip: '127.0.0.1' }, spawn: { windowsHide: true } });
  const uri = database.getUri('reusable_project_tasks');
  assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri);
}, { timeout: 120000 });
after(async () => { try { await mongoose.disconnect(); } finally { await database?.stop(); } });

test('one existing task is usable on two new projects without moving it or rewriting old logs', async () => {
  const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
  const team = await Team.create({ teamName: 'Tax', createdBy: admin._id });
  const employee = { _id: new mongoose.Types.ObjectId(), role: 'employee', team: team._id, isActive: true };
  await Employee.collection.insertOne(employee);
  const original = await Project.create({ projectCode: 'ORIGINAL', projectName: 'Original', teams: [team._id], createdBy: admin._id });
  const task = await Task.create({ taskCode: 'REVIEW', taskName: 'Tax Review', project: original._id, team: team._id, teams: [team._id], assignToAllEmployees: true, createdBy: admin._id });
  const historical = await TaskTimeLog.create({ employee: employee._id, project: original._id, task: task._id, startedAt: '2026-01-01T09:00:00Z', stoppedAt: '2026-01-01T10:00:00Z', status: 'stopped', isActiveTimer: false, totalWorkedSeconds: 3600 });
  let secondProject;
  for (const code of ['TAX-A', 'TAX-B']) {
    const created = response();
    await createProject({ user: admin, body: { projectCode: code, projectName: code, teams: [String(team._id)], linkedTasks: [String(task._id)] } }, created);
    assert.equal(created.code, 201, JSON.stringify(created.body));
    const project = created.body.project;
    secondProject = project;
    const options = await activityOptionsForEmployee(project.toObject(), employee);
    assert.ok(options.tasks.some(value => String(value._id) === String(task._id)));
    const started = response();
    await startTimer({ user: employee, body: { project: String(project._id), task: String(task._id), clientType: 'desktop' } }, started);
    assert.equal(started.code, 201, JSON.stringify(started.body));
    const active = await TaskTimeLog.findOne({ employee: employee._id, isActiveTimer: true });
    assert.equal(String(active.project), String(project._id));
    const stopped = response();
    await stopTimer({ user: employee, body: { timeLogId: String(active._id) } }, stopped);
    assert.equal(stopped.code, 200, JSON.stringify(stopped.body));
  }
  const manual = response();
  await createManualEntry({ user: admin, body: { employee: String(employee._id), project: String(secondProject._id), task: String(task._id),
    startedAt: '2026-01-02T09:00:00Z', stoppedAt: '2026-01-02T10:00:00Z', reason: 'Synthetic shared task entry' } }, manual);
  assert.equal(manual.code, 201, JSON.stringify(manual.body));
  const choices = response();
  await getManualEntryOptions({ user: admin, query: { employee: String(employee._id) } }, choices);
  assert.ok(choices.body.tasks.some(value => String(value._id) === String(task._id) && String(value.project) === String(secondProject._id)));
  await Project.updateOne({ _id: secondProject._id }, { $set: { linkedTasks: [] } });
  const unlinked = response();
  await startTimer({ user: employee, body: { project: String(secondProject._id), task: String(task._id) } }, unlinked);
  assert.equal(unlinked.code, 404, 'Removing the reuse link must block a new timer');
  assert.equal(await Task.countDocuments({}), 1);
  assert.equal(String((await Task.findById(task._id)).project), String(original._id));
  const unchanged = await TaskTimeLog.findById(historical._id);
  assert.equal(String(unchanged.project), String(original._id)); assert.equal(unchanged.totalWorkedSeconds, 3600);
});
