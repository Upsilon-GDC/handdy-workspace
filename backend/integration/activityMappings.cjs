// Real local mongod transactions; never reads .env or accepts an external URI.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Project = require('../src/models/Project');
const Client = require('../src/models/Client');
const Task = require('../src/models/Task');
const Team = require('../src/models/Team');
const Employee = require('../src/models/Employee');
const ActivityMapping = require('../src/models/ActivityMapping');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const ActivityLinkChange = require('../src/models/ActivityLinkChange');
const { ensureActivityMappingIndexes } = require('../src/services/activityMappings');
const { saveActivityLinks, saveBatchActivityLinks, getActivityLinkHistory, ensureActivityLinkHistoryIndexes } = require('../src/modules/projects/activityLinkController');
const { createLinkedTasks } = require('../src/modules/tasks/linkedTaskController');
const { getManualEntryOptions } = require('../src/modules/timers/manualTimeEntryController');
const { validateActivitySelection, activityOptionsForEmployee } = require('../src/services/activitySelection');

const user = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
const databaseName = `crm_activity_integration_${crypto.randomUUID().replaceAll('-', '')}`;
let replicaSet;
let writeConflicts = 0;
let commandTrace = null;

before(async context => {
  replicaSet = await MongoMemoryReplSet.create({
    binary: { version: '7.0.24' },
    replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1', dbName: databaseName, spawn: { windowsHide: true } },
  });
  // A timed-out initial binary download must not leave a late-starting server.
  if (context.signal.aborted) {
    await replicaSet.stop();
    throw new Error('Integration database startup exceeded its time limit.');
  }
  const uri = replicaSet.getUri(databaseName);
  assert.ok(uri.startsWith('mongodb://127.0.0.1:'), 'Only the newly started loopback server is allowed');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, monitorCommands: true });
  mongoose.connection.getClient().on('commandFailed', event => {
    if (event.failure?.code === 112) writeConflicts += 1;
  });
  const pendingCommands = new Map();
  mongoose.connection.getClient().on('commandStarted', event => {
    if (commandTrace) pendingCommands.set(event.requestId, event.command);
  });
  mongoose.connection.getClient().on('commandSucceeded', event => {
    const command = pendingCommands.get(event.requestId);
    pendingCommands.delete(event.requestId);
    if (commandTrace && command) commandTrace.push({ command, reply: event.reply });
  });
  for (const model of [Project, Client, Task, Team, Employee, TaskTimeLog]) {
    await model.createCollection();
    await model.createIndexes();
  }
  await ensureActivityMappingIndexes();
  await ensureActivityLinkHistoryIndexes();
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.ok(hello.setName, 'Transactions require an actual replica set');
  console.log(`Isolated MongoDB 7.0.24 / ${hello.setName}; no application URI loaded.`);
}, { timeout: 900_000 });

after(async () => {
  console.log(`MongoDB reported ${writeConflicts} transaction write conflicts during concurrent requests.`);
  // No dropDatabase: stop() removes only this runner's disposable server files.
  try { await mongoose.disconnect(); } finally { await replicaSet?.stop(); }
});

async function fixture() {
  const suffix = crypto.randomUUID();
  const team = await Team.create({ teamName: `Integration team ${suffix}`, createdBy: user._id });
  const client = await Client.create({ clientName: `Integration client ${suffix}`, createdBy: user._id });
  const project = await Project.create({ projectCode: `IT-${suffix}`, projectName: 'Integration project',
    clients: [client._id], client: client._id, teams: [team._id], createdBy: user._id });
  const task = await Task.create({ taskCode: `IT-${suffix}`, taskName: 'Existing shared task', teams: [team._id],
    team: team._id, assignToAllEmployees: true, createdBy: user._id });
  return { team, client, project, task };
}
async function invoke(controller, body, actor = user, query = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await controller({ user: actor, body, query }, res);
  return res;
}
const linkBody = (f, overrides = {}) => ({ project: String(f.project._id), client: String(f.client._id),
  taskIds: [String(f.task._id)], action: 'link', version: 0, ...overrides });
const createBody = f => ({ project: String(f.project._id), client: String(f.client._id),
  taskNames: ['Preparation', 'Review'], teamAssignment: 'project' });

async function batchFixture() {
  const f = await fixture(); const tag = crypto.randomUUID();
  const client = await Client.create({ clientName: tag, createdBy: user._id });
  const project = await Project.create({ projectCode: tag, projectName: tag, teams: [f.team._id], clients: [f.client._id], createdBy: user._id });
  const task = await Task.create({ taskCode: tag, taskName: 'Project-owned task', project: f.project._id, teams: [f.team._id], assignToAllEmployees: true, createdBy: user._id });
  return { ...f, secondProject: project, secondClient: client, secondTask: task, body: { action: 'link',
    projects: [f.project, project].map(project => ({ project: String(project._id), version: 0 })),
    clientIds: [String(f.client._id), String(client._id)], taskIds: [String(f.task._id), String(task._id)] } };
}

test('batch linking saves all project/client/task combinations and reuses tasks without changing assignments', async () => {
  const f = await batchFixture(); const before = await Task.findById(f.secondTask._id).lean();
  const result = await invoke(saveBatchActivityLinks, f.body); assert.equal(result.code, 200, JSON.stringify(result.body));
  assert.equal(result.body.combinationCount, 8);
  assert.equal(result.body.history.action, 'link');
  assert.equal(await ActivityLinkChange.countDocuments({ 'projects.id': f.project._id, mode: 'tasks' }), 1);
  assert.equal(await ActivityMapping.countDocuments({ project: { $in: [f.project._id, f.secondProject._id] }, isActive: true }), 8);
  for (const reference of [f.project, f.secondProject]) {
    const project = await Project.findById(reference._id).lean();
    assert.deepEqual(project.clients.map(String).sort(), [...f.body.clientIds].sort());
    assert.deepEqual(project.linkedTasks.map(String).sort(), [...f.body.taskIds].sort());
    assert.equal(project.activityMappingEnabled, false);
  }
  assert.deepEqual(await Task.findById(f.secondTask._id).lean(), before);
});

test('batch unlink and repeated link retain mapping IDs and historical time', async () => {
  const f = await batchFixture(); assert.equal((await invoke(saveBatchActivityLinks, f.body)).code, 200);
  const initial = await ActivityMapping.find({ task: f.task._id }).lean();
  const log = await TaskTimeLog.create({ employee: user._id, project: f.project._id, client: f.client._id, task: f.task._id,
    startedAt: '2026-01-01T09:00:00Z', stoppedAt: '2026-01-01T10:00:00Z', status: 'stopped', isActiveTimer: false, totalWorkedSeconds: 3600 });
  const before = await TaskTimeLog.findById(log._id).lean();
  const next = { ...f.body, projects: f.body.projects.map(row => ({ ...row, version: 1 })) };
  assert.equal((await invoke(saveBatchActivityLinks, next)).code, 200);
  assert.equal(await ActivityMapping.countDocuments({ task: { $in: [f.task._id, f.secondTask._id] } }), 8);
  assert.equal((await invoke(saveBatchActivityLinks, { ...next, action: 'unlink', projects: next.projects.map(row => ({ ...row, version: 2 })) })).code, 200);
  assert.equal(await ActivityMapping.countDocuments({ task: { $in: [f.task._id, f.secondTask._id] }, isActive: true }), 0);
  assert.deepEqual((await ActivityMapping.find({ task: f.task._id }).lean()).map(row => String(row._id)).sort(), initial.map(row => String(row._id)).sort());
  assert.deepEqual(await TaskTimeLog.findById(log._id).lean(), before);
});

test('a stale project or inactive client rejects the entire batch', async () => {
  const f = await batchFixture();
  const stale = { ...f.body, projects: f.body.projects.map((row, i) => ({ ...row, version: i })) };
  assert.equal((await invoke(saveBatchActivityLinks, stale)).code, 409);
  assert.equal((await Project.findById(f.project._id)).activityLinksVersion, 0);
  await Client.updateOne({ _id: f.secondClient._id }, { $set: { status: 'Inactive' } });
  assert.equal((await invoke(saveBatchActivityLinks, f.body)).code, 400);
  assert.equal(await ActivityMapping.countDocuments({ task: f.task._id }), 0);
});

test('simultaneous batches commit once and reject the stale writer', async () => {
  const f = await batchFixture();
  const results = await Promise.all([invoke(saveBatchActivityLinks, f.body), invoke(saveBatchActivityLinks, f.body)]);
  assert.deepEqual(results.map(result => result.code).sort(), [200, 409]);
});

test('a Team Lead cannot batch-link a foreign-team project or task', async () => {
  const f = await batchFixture(); const lead = { _id: new mongoose.Types.ObjectId(), role: 'team_lead', team: f.team._id };
  await Team.updateOne({ _id: f.team._id }, { $set: { teamLead: lead._id } });
  const other = await Team.create({ teamName: crypto.randomUUID(), createdBy: user._id });
  await Project.updateOne({ _id: f.secondProject._id }, { $set: { teams: [other._id] } });
  assert.equal((await invoke(saveBatchActivityLinks, f.body, lead)).code, 403);
  assert.equal(await ActivityMapping.countDocuments({ task: f.task._id }), 0);
});

test('failed batch mapping writes roll back every project update', async t => {
  const f = await batchFixture();
  t.mock.method(ActivityMapping, 'bulkWrite', async () => { throw new Error('Synthetic batch failure'); });
  assert.equal((await invoke(saveBatchActivityLinks, f.body)).code, 500);
  for (const reference of [f.project, f.secondProject]) {
    const project = await Project.findById(reference._id);
    assert.equal(project.activityLinksVersion, 0); assert.equal(project.linkedTasks.length, 0);
    assert.deepEqual(project.clients.map(String), [String(f.client._id)]);
  }
});

test('project/client-only linking changes no tasks or task mappings', async () => {
  const f = await batchFixture(); const before = await Task.findById(f.secondTask._id).lean();
  const result = await invoke(saveBatchActivityLinks, { ...f.body, mode: 'clients', taskIds: [] });
  assert.equal(result.code, 200, JSON.stringify(result.body)); assert.equal(result.body.combinationCount, 4);
  for (const reference of [f.project, f.secondProject]) {
    const project = await Project.findById(reference._id);
    assert.deepEqual(project.clients.map(String).sort(), [...f.body.clientIds].sort());
    assert.equal(project.linkedTasks.length, 0);
  }
  assert.equal(await ActivityMapping.countDocuments({ task: { $in: [f.task._id, f.secondTask._id] } }), 0);
  assert.deepEqual(await Task.findById(f.secondTask._id).lean(), before);
});

test('project/client-only removal disables affected mappings while preserving other clients and history', async () => {
  const f = await batchFixture(); assert.equal((await invoke(saveBatchActivityLinks, f.body)).code, 200);
  const record = await TaskTimeLog.create({ employee: user._id, project: f.project._id, client: f.secondClient._id, task: f.task._id,
    startedAt: '2026-01-01T09:00:00Z', stoppedAt: '2026-01-01T10:00:00Z', status: 'stopped', isActiveTimer: false, totalWorkedSeconds: 3600 });
  const before = await TaskTimeLog.findById(record._id).lean();
  const result = await invoke(saveBatchActivityLinks, { ...f.body, mode: 'clients', action: 'unlink', taskIds: [], clientIds: [String(f.secondClient._id)], projects: f.body.projects.map(row => ({ ...row, version: 1 })) });
  assert.equal(result.code, 200, JSON.stringify(result.body));
  for (const reference of [f.project, f.secondProject]) {
    const project = await Project.findById(reference._id);
    assert.deepEqual(project.clients.map(String), [String(f.client._id)]);
    assert.equal(project.linkedTasks.length, 2);
  }
  assert.equal(await ActivityMapping.countDocuments({ task: f.task._id, client: f.secondClient._id, isActive: true }), 0);
  assert.equal(await ActivityMapping.countDocuments({ task: f.task._id, client: f.client._id, isActive: true }), 2);
  assert.deepEqual(await TaskTimeLog.findById(record._id).lean(), before);
});

test('delegated client removal cannot disable mappings for another team', async () => {
  const f = await batchFixture();
  const otherTeam = await Team.create({ teamName: crypto.randomUUID(), createdBy: user._id });
  const otherTask = await Task.create({ taskCode: crypto.randomUUID(), taskName: 'Other team', teams: [otherTeam._id], createdBy: user._id });
  await ActivityMapping.create({ project: f.project._id, client: f.client._id, task: otherTask._id });
  const lead = { _id: new mongoose.Types.ObjectId(), role: 'team_lead' };
  await Team.updateOne({ _id: f.team._id }, { $set: { teamLead: lead._id } });
  const result = await invoke(saveBatchActivityLinks, { ...f.body, mode: 'clients', action: 'unlink', taskIds: [], clientIds: [String(f.client._id)] }, lead);
  assert.equal(result.code, 403);
  assert.equal((await Project.findById(f.project._id)).activityLinksVersion, 0);
  assert.equal(await ActivityMapping.countDocuments({ task: otherTask._id, isActive: true }), 1);
});

test('history records client-only operations and restricts delegated users to their own actions', async () => {
  const f = await batchFixture();
  assert.equal((await invoke(saveBatchActivityLinks, { ...f.body, mode: 'clients', taskIds: [] })).code, 200);
  const ownUser = { _id: new mongoose.Types.ObjectId(), role: 'employee' };
  await ActivityLinkChange.create({ action: 'unlink', mode: 'clients', actor: ownUser._id, actorName: 'Own action',
    projects: [{ id: f.project._id, name: f.project.projectName }], clients: [{ id: f.client._id, name: f.client.clientName }], combinationCount: 1 });
  const own = await invoke(getActivityLinkHistory, {}, ownUser, { mode: 'clients' });
  assert.equal(own.code, 200); assert.equal(own.body.totalRecords, 1); assert.equal(own.body.history[0].actorName, 'Own action');
  const all = await invoke(getActivityLinkHistory, {}, user, { mode: 'clients', limit: '100' });
  assert.ok(all.body.history.some(row => row.projects.some(project => String(project.id) === String(f.project._id)) && String(row.actor) === String(user._id)));
  assert.ok(all.body.history.every(row => row.mode === 'clients'));
});

test('history insert failure rolls back the links and every project update', async t => {
  const f = await batchFixture();
  t.mock.method(ActivityLinkChange, 'create', async () => { throw new Error('Synthetic history failure'); });
  assert.equal((await invoke(saveBatchActivityLinks, f.body)).code, 500);
  assert.equal(await ActivityMapping.countDocuments({ task: f.task._id }), 0);
  for (const reference of [f.project, f.secondProject]) {
    const project = await Project.findById(reference._id);
    assert.equal(project.activityLinksVersion, 0); assert.equal(project.linkedTasks.length, 0);
  }
  assert.equal(await ActivityLinkChange.countDocuments({ 'projects.id': f.project._id }), 0);
});

test('mapping index initialization is repeatable and MongoDB rejects duplicate tuples', async () => {
  const f = await fixture();
  await ensureActivityMappingIndexes();
  const indexes = await ActivityMapping.collection.indexes();
  assert.equal(indexes.find(index => index.name === 'activity_tuple_unique').unique, true);
  const tuple = { project: f.project._id, client: f.client._id, task: f.task._id };
  await ActivityMapping.create(tuple);
  await assert.rejects(ActivityMapping.create(tuple), error => error.code === 11000);
  assert.equal(await ActivityMapping.countDocuments(tuple), 1);
});

test('simultaneous versioned link saves commit once and return stale-save conflicts', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => invoke(saveActivityLinks, linkBody(f))));
  assert.equal(results.filter(result => result.code === 200).length, 1);
  assert.equal(results.filter(result => result.code === 409).length, 9);
  assert.equal(await ActivityMapping.countDocuments({ project: f.project._id, isActive: true }), 1);
  assert.equal((await Project.findById(f.project._id)).activityLinksVersion, 1);
});

test('simultaneous same-name batches create exactly one complete batch with links', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => invoke(createLinkedTasks, createBody(f))));
  assert.equal(results.filter(result => result.code === 201).length, 1);
  assert.equal(results.filter(result => result.code === 409).length, 7);
  const tasks = await Task.find({ project: f.project._id });
  assert.deepEqual(tasks.map(task => task.taskName).sort(), ['Preparation', 'Review']);
  assert.equal(await ActivityMapping.countDocuments({ project: f.project._id }), 2);
  assert.equal((await Project.findById(f.project._id)).activityLinksVersion, 1);
  for (const task of tasks) assert.ok(await ActivityMapping.exists({ project: f.project._id, task: task._id, client: f.client._id }));
});

test('real team queries keep TL-created tasks in their own team and managers see both teams', async () => {
  const f = await fixture();
  const leadA = { _id: new mongoose.Types.ObjectId(), role: 'team_lead', team: f.team._id };
  const leadB = { _id: new mongoose.Types.ObjectId(), role: 'team_lead' };
  const teamB = await Team.create({ teamName: `Other integration team ${crypto.randomUUID()}`, createdBy: user._id, teamLead: leadB._id });
  leadB.team = teamB._id;
  await Team.updateOne({ _id: f.team._id }, { $set: { teamLead: leadA._id } });
  await Project.updateOne({ _id: f.project._id }, { $push: { teams: teamB._id } });
  const body = { ...createBody(f), teamAssignment: 'own' };
  assert.equal((await invoke(createLinkedTasks, body, leadA)).code, 201);
  assert.equal((await invoke(createLinkedTasks, body, leadB)).code, 201);
  assert.equal((await invoke(saveActivityLinks, linkBody(f, { action: 'policy', enabled: true, version: 2 }))).code, 200);
  const project = await Project.findById(f.project._id).lean();
  const optionsA = await activityOptionsForEmployee(project, leadA);
  const optionsB = await activityOptionsForEmployee(project, leadB);
  assert.equal(optionsA.tasks.length, 2);
  assert.equal(optionsB.tasks.length, 2);
  assert.ok(optionsA.tasks.every(task => !optionsB.tasks.some(other => String(other._id) === String(task._id))));
  assert.equal((await activityOptionsForEmployee(project, { ...user, role: 'manager' })).tasks.length, 4);
  const employee = { _id: new mongoose.Types.ObjectId(), team: f.team._id, role: 'employee' };
  assert.equal((await activityOptionsForEmployee(project, employee)).tasks.length, 2);
  await Team.updateOne({ _id: f.team._id }, { $set: { isActive: false } });
  assert.equal(await activityOptionsForEmployee(project, employee), null);
});

test('manual-entry options read shared mapped work with the target employee scope from MongoDB', async () => {
  const f = await fixture();
  const employee = { _id: new mongoose.Types.ObjectId(), role: 'employee', team: f.team._id,
    employeeId: `IT-${crypto.randomUUID()}`, fullName: 'Integration Employee', isActive: true };
  await Employee.collection.insertOne(employee);
  assert.equal((await invoke(saveActivityLinks, linkBody(f))).code, 200);
  assert.equal((await invoke(saveActivityLinks, linkBody(f, { action: 'policy', enabled: true, version: 1 }))).code, 200);
  const result = await invoke(getManualEntryOptions, {}, user, { employee: String(employee._id) });
  assert.equal(result.code, 200);
  assert.equal(result.body.projects.length, 1);
  assert.equal(result.body.projects[0].mappingEnabled, true);
  assert.equal(String(result.body.tasks[0]._id), String(f.task._id));
  assert.equal(String(result.body.tasks[0].project), String(f.project._id));
  assert.deepEqual(result.body.tasks[0].clientIds, [String(f.client._id)]);
  await Task.updateOne({ _id: f.task._id }, { $set: { assignToAllEmployees: false } });
  const denied = await invoke(getManualEntryOptions, {}, user, { employee: String(employee._id) });
  assert.deepEqual(denied.body.tasks, []);
  assert.deepEqual(denied.body.projects, []);
});

test('MongoDB rejects mapping writes after task insertion and rolls back the entire batch', async () => {
  const f = await fixture();
  await mongoose.connection.db.command({ collMod: ActivityMapping.collection.name,
    validator: { project: { $ne: f.project._id } }, validationLevel: 'strict', validationAction: 'error' });
  try {
    commandTrace = [];
    const result = await invoke(createLinkedTasks, createBody(f));
    assert.equal(result.code, 500);
    assert.ok(commandTrace.some(({ command, reply }) => command.insert === Task.collection.name
      && command.autocommit === false && reply.n === 2), 'The task inserts really succeeded inside the transaction');
    assert.ok(commandTrace.some(({ command, reply }) => command.insert === ActivityMapping.collection.name
      && reply.writeErrors?.some(error => error.code === 121)), 'MongoDB itself rejected the subsequent mapping write');
    assert.equal(await Task.countDocuments({ project: f.project._id }), 0);
    assert.equal(await ActivityMapping.countDocuments({ project: f.project._id }), 0);
    assert.equal((await Project.findById(f.project._id)).activityLinksVersion, 0);
  } finally {
    commandTrace = null;
    await mongoose.connection.db.command({ collMod: ActivityMapping.collection.name, validator: {} });
  }
});

test('failed final project update restores mappings already disabled inside the transaction', async () => {
  const f = await fixture();
  const mapping = await ActivityMapping.create({ project: f.project._id, client: f.client._id, task: f.task._id });
  await mongoose.connection.db.command({ collMod: Project.collection.name,
    validator: { $or: [{ _id: { $ne: f.project._id } }, { activityLinksVersion: { $lte: 0 } }] },
    validationLevel: 'strict', validationAction: 'error' });
  try {
    commandTrace = [];
    const result = await invoke(saveActivityLinks, linkBody(f, { action: 'clients', clientIds: [] }));
    assert.equal(result.code, 500);
    assert.ok(commandTrace.some(({ command, reply }) => command.update === ActivityMapping.collection.name
      && command.autocommit === false && reply.nModified === 1), 'The mapping was changed inside the transaction before failure');
    assert.ok(commandTrace.some(({ command, reply }) => command.update === Project.collection.name
      && reply.writeErrors?.some(error => error.code === 121)), 'MongoDB rejected the final project update');
    assert.equal((await ActivityMapping.findById(mapping._id)).isActive, true);
    const project = await Project.findById(f.project._id);
    assert.equal(project.activityLinksVersion, 0);
    assert.deepEqual(project.clients.map(String), [String(f.client._id)]);
  } finally {
    commandTrace = null;
    await mongoose.connection.db.command({ collMod: Project.collection.name, validator: {} });
  }
});

test('client removal racing linked creation never leaves an active mapping for a removed client', async () => {
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const f = await fixture();
    const [created, removed] = await Promise.all([
      invoke(createLinkedTasks, createBody(f)),
      invoke(saveActivityLinks, linkBody(f, { action: 'clients', clientIds: [] })),
    ]);
    assert.ok([201, 400].includes(created.code));
    assert.ok([200, 409].includes(removed.code));
    const project = await Project.findById(f.project._id);
    const active = await ActivityMapping.find({ project: f.project._id, isActive: true });
    for (const mapping of active) assert.ok(project.clients.map(String).includes(String(mapping.client)));
    assert.equal(await Task.countDocuments({ project: f.project._id }), created.code === 201 ? 2 : 0);
    if (removed.code === 200) assert.equal(active.length, 0);
  }
});

test('unlink and relink retain mapping identity, enforcement and historical time unchanged', async () => {
  const f = await fixture();
  assert.equal((await invoke(saveActivityLinks, linkBody(f))).code, 200);
  assert.equal((await invoke(saveActivityLinks, linkBody(f, { action: 'policy', enabled: true, version: 1 }))).code, 200);
  const project = await Project.findById(f.project._id).lean();
  const selected = await validateActivitySelection(project, f.client._id, f.task._id);
  assert.ok(selected.mapping);
  assert.match((await validateActivitySelection(project, f.client._id, new mongoose.Types.ObjectId())).error, /not linked/);
  assert.match((await validateActivitySelection(project, new mongoose.Types.ObjectId(), f.task._id)).error, /client is not linked/);
  // Raw historical fixture avoids unrelated attendance/billing side effects.
  const historical = { _id: new mongoose.Types.ObjectId(), employee: user._id, project: f.project._id,
    client: f.client._id, task: f.task._id, activityMapping: selected.mapping,
    startedAt: new Date('2026-01-01T09:00:00Z'), stoppedAt: new Date('2026-01-01T10:00:00Z'),
    status: 'stopped', isActiveTimer: false, totalWorkedSeconds: 3600 };
  await TaskTimeLog.collection.insertOne(historical);
  const before = await TaskTimeLog.collection.findOne({ _id: historical._id });
  assert.equal((await invoke(saveActivityLinks, linkBody(f, { action: 'unlink', version: 2 }))).code, 200);
  assert.match((await validateActivitySelection(project, f.client._id, f.task._id)).error, /not linked/);
  assert.deepEqual((await activityOptionsForEmployee(project, user)).tasks, []);
  assert.equal((await Project.findById(project._id)).activityMappingEnabled, true);
  assert.equal((await invoke(saveActivityLinks, linkBody(f, { version: 3 }))).code, 200);
  assert.equal(String((await validateActivitySelection(project, f.client._id, f.task._id)).mapping), String(selected.mapping));
  assert.equal(await ActivityMapping.countDocuments({ project: project._id }), 1);
  assert.deepEqual(await TaskTimeLog.collection.findOne({ _id: historical._id }), before);
  assert.ok(await Task.exists({ _id: f.task._id, project: null }));
});
