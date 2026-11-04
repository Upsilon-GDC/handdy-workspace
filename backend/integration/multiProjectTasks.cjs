// Transaction tests against a disposable loopback database; no .env is loaded.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const Client = require('../src/models/Client');
const Team = require('../src/models/Team');
const ActivityMapping = require('../src/models/ActivityMapping');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const { ensureActivityMappingIndexes } = require('../src/services/activityMappings');
const { saveMultiProjectTask, getTaskProjectSelections, validateProjectSelections } = require('../src/modules/tasks/multiProjectTaskController');
const { activityOptionsForEmployee } = require('../src/services/activitySelection');
const { createLinkedTasks } = require('../src/modules/tasks/linkedTaskController');
const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
let replica;
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  const uri = replica.getUri('multi_project_tasks'); assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri);
  await ensureActivityMappingIndexes();
}, { timeout: 120000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
async function fixture() {
  const tag = crypto.randomUUID();
  const team = await Team.create({ teamName: tag, createdBy: admin._id });
  const clients = await Client.create([{ clientName: `${tag}-client-A`, createdBy: admin._id }, { clientName: `${tag}-client-B`, createdBy: admin._id }]);
  const projects = await Project.create(clients.map((client, index) => ({ projectCode: `${tag}-${index}`, projectName: `${tag}-${index}`, teams: [team._id], clients: [client._id], createdBy: admin._id, activityMappingEnabled: true })));
  const body = { taskNames: ['Tax Review', 'Tax Preparation'], taskType: 'work', teamAssignment: 'project', assignToAllEmployees: true,
    projectSelections: projects.map((project, index) => ({ project: String(project._id), client: String(clients[index]._id) })) };
  return { team, clients, projects, body };
}
async function invoke(body, taskId, user = admin, controller = saveMultiProjectTask) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await controller({ user, params: taskId ? { id: String(taskId) } : {}, body }, res); return res;
}
const editBody = async (f, task, rows = f.body.projectSelections) => ({ ...f.body, projectSelections: rows, taskNames: [task.taskName], teams: [String(f.team._id)], expectedUpdatedAt: new Date(task.updatedAt).toISOString(),
  expectedProjectLinks: (await invoke({}, task._id, admin, getTaskProjectSelections)).body.expectedProjectLinks });

test('selection validation rejects empty, duplicate and malformed project IDs', () => {
  for (const rows of [[], [{ project: 'bad' }], [{ project: String(admin._id) }, { project: String(admin._id) }]]) assert.throws(() => validateProjectSelections({ projectSelections: rows }));
});

test('a batch creates one task per name with mappings to both projects and distinct clients', async () => {
  const f = await fixture(); const result = await invoke(f.body);
  assert.equal(result.code, 201, JSON.stringify(result.body)); assert.equal(result.body.tasks.length, 2);
  const taskIds = result.body.tasks.map(task => task._id);
  assert.equal(await ActivityMapping.countDocuments({ task: { $in: taskIds }, isActive: true }), 4);
  for (const project of f.projects) {
    const saved = await Project.findById(project._id).lean();
    assert.deepEqual(saved.linkedTasks.map(String).sort(), taskIds.map(String).sort());
    const options = await activityOptionsForEmployee(saved, { role: 'manager' });
    assert.equal(options.tasks.length, 2);
  }
});

test('edit removes a project atomically, retains other task links and historical project IDs', async () => {
  const f = await fixture(); const created = await invoke(f.body); const task = created.body.tasks[0];
  const log = await TaskTimeLog.create({ employee: admin._id, project: f.projects[0]._id, task: task._id,
    startedAt: '2026-01-01T09:00:00Z', stoppedAt: '2026-01-01T10:00:00Z', status: 'stopped', isActiveTimer: false, totalWorkedSeconds: 3600 });
  const result = await invoke(await editBody(f, task, [f.body.projectSelections[1]]), task._id);
  assert.equal(result.code, 200, JSON.stringify(result.body));
  assert.equal(String(result.body.task.project), String(f.projects[1]._id));
  assert.equal(await ActivityMapping.countDocuments({ task: task._id, project: f.projects[0]._id, isActive: true }), 0);
  assert.ok((await Project.findById(f.projects[0]._id)).linkedTasks.every(value => String(value) !== String(task._id)));
  assert.ok((await Project.findById(f.projects[0]._id)).linkedTasks.some(value => String(value) === String(created.body.tasks[1]._id)));
  assert.equal(String((await TaskTimeLog.findById(log._id)).project), String(f.projects[0]._id));
  const options = await invoke({}, task._id, admin, getTaskProjectSelections);
  assert.deepEqual(options.body.projectSelections.map(row => row.project), [String(f.projects[1]._id)]);
});

test('editing an existing single-project task adds another project without creating a copy', async () => {
  const f = await fixture();
  const created = await invoke({ ...f.body, project: f.body.projectSelections[0].project, client: f.body.projectSelections[0].client }, null, admin, createLinkedTasks);
  assert.equal(created.code, 201, JSON.stringify(created.body)); const task = created.body.tasks[0];
  const result = await invoke(await editBody(f, task), task._id);
  assert.equal(result.code, 200, JSON.stringify(result.body));
  assert.equal(String(result.body.task._id), String(task._id));
  assert.equal(await Task.countDocuments({ _id: task._id }), 1);
  assert.equal(await ActivityMapping.countDocuments({ task: task._id, isActive: true }), 2);
});

test('team leads retain only their own team and cannot add a project belonging to another team', async () => {
  const f = await fixture(); const lead = { _id: new mongoose.Types.ObjectId(), role: 'team_lead', team: f.team._id };
  await Team.updateOne({ _id: f.team._id }, { $set: { teamLead: lead._id } });
  const body = { ...f.body, teamAssignment: 'own' };
  const result = await invoke(body, null, lead); assert.equal(result.code, 201, JSON.stringify(result.body));
  assert.deepEqual(result.body.tasks[0].teams.map(String), [String(f.team._id)]);
  const other = await Team.create({ teamName: crypto.randomUUID(), createdBy: admin._id });
  await Project.updateOne({ _id: f.projects[1]._id }, { $set: { teams: [other._id] } });
  const rejected = await invoke({ ...body, taskNames: ['Foreign team test'] }, null, lead);
  assert.equal(rejected.code, 403);
  assert.equal(await Task.countDocuments({ taskName: 'Foreign team test' }), 0);
});

test('a duplicate in the second project rejects the entire batch and concurrent creates commit once', async () => {
  const f = await fixture();
  const results = await Promise.all([invoke(f.body), invoke(f.body)]);
  assert.deepEqual(results.map(result => result.code).sort(), [201, 409]);
  const tasks = await Task.find({ project: f.projects[0]._id }); assert.equal(tasks.length, 2);
  const duplicate = await invoke({ ...f.body, projectSelections: [...f.body.projectSelections].reverse() });
  assert.equal(duplicate.code, 409); assert.equal(await Task.countDocuments({ project: f.projects[0]._id }), 2);
});

test('concurrent edits reject a stale revision', async () => {
  const f = await fixture(); const created = await invoke(f.body); const task = created.body.tasks[0];
  const body = await editBody(f, task);
  const results = await Promise.all([invoke(body, task._id), invoke(body, task._id)]);
  assert.deepEqual(results.map(result => result.code).sort(), [200, 409]);
});

test('an intervening project-link change rejects an old form without changing the task', async () => {
  const f = await fixture(); const created = await invoke(f.body); const task = created.body.tasks[0];
  const body = await editBody(f, task);
  await ActivityMapping.updateOne({ task: task._id, project: f.projects[1]._id }, { $set: { isActive: false } });
  const result = await invoke(body, task._id);
  assert.equal(result.code, 409); assert.match(result.body.message, /Project links changed/);
  assert.equal(String((await Task.findById(task._id)).updatedAt), String(task.updatedAt));
});

test('editing project selections preserves other client mappings on retained projects', async () => {
  const f = await fixture(); const created = await invoke(f.body); const task = created.body.tasks[0];
  const extra = await Client.create({ clientName: crypto.randomUUID(), createdBy: admin._id });
  await Project.updateOne({ _id: f.projects[0]._id }, { $addToSet: { clients: extra._id } });
  await ActivityMapping.create({ project: f.projects[0]._id, task: task._id, client: extra._id });
  const result = await invoke(await editBody(f, task), task._id);
  assert.equal(result.code, 200, JSON.stringify(result.body));
  assert.equal(await ActivityMapping.countDocuments({ task: task._id, client: extra._id, isActive: true }), 1);
});

test('mapping write failure rolls back task creation and every project link', async t => {
  const f = await fixture();
  t.mock.method(ActivityMapping, 'bulkWrite', async () => { throw new Error('Synthetic mapping failure'); });
  const result = await invoke(f.body); assert.equal(result.code, 500);
  assert.equal(await Task.countDocuments({ project: f.projects[0]._id }), 0);
  for (const project of f.projects) assert.equal((await Project.findById(project._id)).linkedTasks.length, 0);
});
