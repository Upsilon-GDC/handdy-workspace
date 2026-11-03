const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const Client = require('../src/models/Client');
const Team = require('../src/models/Team');
const Employee = require('../src/models/Employee');
const ActivityMapping = require('../src/models/ActivityMapping');
const { validateLinkedTaskInput, resolveCreationClient, createLinkedTasks, getTaskCreationOptions } = require('../src/modules/tasks/linkedTaskController');
const routes = require('../src/modules/tasks/taskRoutes');
const { createTask, createTasksBulk, getAllTasks } = require('../src/modules/tasks/taskController');
const ids = { project: '64b000000000000000000a01', client: '64b000000000000000000a02', team: '64b000000000000000000a03', actor: '64b000000000000000000a04', task: '64b000000000000000000a05', other: '64b000000000000000000a06' };
const body = overrides => ({ project: ids.project, client: ids.client, teams: [ids.team], taskNames: ['Review', 'Preparation'], taskType: 'work', ...overrides });
const actor = { _id: ids.actor, role: 'admin' };
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const query = value => ({ session() { return this; }, select() { return this; }, populate() { return this; }, sort() { return this; }, distinct: async () => [ids.team], lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
function setup(t, { project = {}, clients = [{ _id: ids.client }], duplicates = [], teamCount = 1 } = {}) {
  const calls = { tasks: [], links: [], projectWrites: 0, ended: false, session: null };
  const session = { withTransaction: async fn => { calls.transaction = true; await fn(); }, endSession: async () => { calls.ended = true; } };
  calls.session = session;
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Team, 'find', () => query([{ _id: ids.team, teamName: 'Team' }]));
  t.mock.method(Team, 'countDocuments', () => query(teamCount));
  t.mock.method(Project, 'findOne', () => query({ _id: ids.project, status: 'Active', clients: [ids.client], teams: [ids.team], ...project }));
  t.mock.method(Project, 'updateOne', async (_filter, _update, options) => { assert.equal(options.session, session); calls.projectWrites++; });
  t.mock.method(Client, 'find', () => query(clients));
  t.mock.method(ActivityMapping, 'find', () => query([]));
  t.mock.method(Task, 'find', () => query(duplicates));
  t.mock.method(Task, 'insertMany', async (documents, options) => {
    assert.equal(options.session, session); calls.tasks = documents;
    return documents.map((document, index) => ({ ...document, _id: new mongoose.Types.ObjectId() }));
  });
  t.mock.method(ActivityMapping, 'insertMany', async (documents, options) => { assert.equal(options.session, session); calls.links = documents; });
  t.mock.method(Employee, 'countDocuments', () => query(1));
  t.mock.method(Employee, 'find', () => query([]));
  return calls;
}
test('input rejects invalid tuples, normalized duplicate names, excessive batches and forged field types', () => {
  for (const override of [{ project: '' }, { client: 'not-id' }, { taskNames: [] }, { taskNames: [' Review ', 'review'] },
    { taskNames: Array(101).fill('name') }, { taskNames: [7] }, { taskType: 'billable' }, { teams: ['not-id'] },
    { assignedTo: ['not-id'] }, { assignToAllEmployees: 'true' }, { idleLogout: {} }]) assert.throws(() => validateLinkedTaskInput(body(override)));
  assert.equal(validateLinkedTaskInput(body({ taskNames: ['One'] })).taskNames.length, 1);
});
test('one active linked client is inferred; multiple clients and foreign choices are rejected', () => {
  const project = { clients: [ids.client, ids.other] };
  assert.equal(resolveCreationClient(project, [{ _id: ids.client }], ''), ids.client);
  assert.throws(() => resolveCreationClient(project, [{ _id: ids.client }, { _id: ids.other }], ''), /Select a client/);
  assert.throws(() => resolveCreationClient({ clients: [] }, [], ''), /no active linked clients/);
  assert.throws(() => resolveCreationClient(project, [{ _id: ids.client }], ids.other), /not active or linked/);
});
test('new endpoints require task creation permission, including revoked TL permission', () => {
  for (const [path, method] of [['/creation-options', 'get'], ['/linked', 'post']]) {
    const route = routes.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    let allowed = false; const res = response();
    route.stack[1].handle({ user: { role: 'team_lead', permissionOverrides: { revoked: ['create_tasks'] } } }, res, () => { allowed = true; });
    assert.equal(allowed, false); assert.equal(res.code, 403);
  }
});
test('admin batch saves all tasks and mappings with the same transaction and preserves scope', async t => {
  const calls = setup(t); const res = response();
  await createLinkedTasks({ user: actor, body: body() }, res);
  assert.equal(res.code, 201); assert.equal(calls.tasks.length, 2); assert.equal(calls.links.length, 2);
  assert.equal(calls.transaction, true); assert.equal(calls.ended, true);
  assert.equal(new Set(calls.tasks.map(task => task.taskCode)).size, 2);
  assert.ok(calls.tasks.every(task => task.project === ids.project && task.assignToAllEmployees && task.teams[0] === ids.team));
  assert.ok(calls.links.every(link => link.client === ids.client && link.project === ids.project));
});
test('single-task creation also infers the only client on the backend', async t => {
  const calls = setup(t); const res = response();
  await createLinkedTasks({ user: actor, body: body({ client: undefined, taskNames: ['One'] }) }, res);
  assert.equal(res.code, 201); assert.equal(calls.links[0].client, ids.client);
});
test('manager creation automatically copies project accounting teams and excludes unrelated teams', async t => {
  const calls = setup(t, { project: { teams: [ids.team, ids.other] }, teamCount: 2 }); const res = response();
  await createLinkedTasks({ user: { ...actor, role: 'manager' }, body: body({ teams: undefined, teamAssignment: 'project' }) }, res);
  assert.equal(res.code, 201);
  assert.ok(calls.tasks.every(task => task.teams.length === 2 && task.teams.includes(ids.team) && task.teams.includes(ids.other)));
});
test('automatic assignment is resolved on the server even when team IDs are omitted', async t => {
  const calls = setup(t); const res = response();
  await createLinkedTasks({ user: actor, body: body({ teams: undefined }) }, res);
  assert.equal(res.code, 201); assert.deepEqual(calls.tasks[0].teams, [ids.team]);
});
test('an unrestricted project does not silently default to every company team', async t => {
  const calls = setup(t, { project: { teams: [] } }); const res = response();
  await createLinkedTasks({ user: actor, body: body({ teams: undefined, teamAssignment: 'project' }) }, res);
  assert.equal(res.code, 400); assert.equal(calls.tasks.length, 0);
});
test('admin override narrows a task to one allowed project team', async t => {
  const calls = setup(t, { project: { teams: [ids.team, ids.other] } }); const res = response();
  await createLinkedTasks({ user: actor, body: body({ teamAssignment: 'selected', teams: [ids.team] }) }, res);
  assert.equal(res.code, 201); assert.deepEqual(calls.tasks[0].teams, [ids.team]);
});
test('TL automatic assignment uses only the team they lead, not every project team', async t => {
  const calls = setup(t, { project: { teams: [ids.team, ids.other] } }); const res = response();
  await createLinkedTasks({ user: { ...actor, role: 'team_lead', team: ids.team }, body: body({ teamAssignment: 'own', teams: undefined }) }, res);
  assert.equal(res.code, 201); assert.deepEqual(calls.tasks[0].teams, [ids.team]);
});
test('TL cannot request the company-wide project assignment mode', async t => {
  const calls = setup(t); const res = response();
  await createLinkedTasks({ user: { ...actor, role: 'team_lead', team: ids.team }, body: body({ teamAssignment: 'project', teams: undefined }) }, res);
  assert.equal(res.code, 403); assert.equal(calls.tasks.length, 0);
});
test('inactive automatic project-team references reject the entire batch', async t => {
  const calls = setup(t, { project: { teams: [ids.team, ids.other] }, teamCount: 1 }); const res = response();
  await createLinkedTasks({ user: actor, body: body({ teamAssignment: 'project', teams: undefined }) }, res);
  assert.equal(res.code, 403); assert.equal(calls.tasks.length, 0);
});
test('managers list tasks from every TL team without being individually assigned', async t => {
  const rows = [{ _id: ids.task, teams: [ids.team] }, { _id: ids.other, teams: [ids.other] }];
  let filter;
  t.mock.method(Task, 'countDocuments', async () => rows.length);
  t.mock.method(Task, 'find', value => { filter = value; return query(rows); });
  const res = response();
  await getAllTasks({ user: { ...actor, role: 'manager', team: null }, query: { all: 'true', scope: 'manage' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.tasks.length, 2);
  assert.deepEqual(filter, { deletedAt: null });
});
test('legacy endpoints cannot silently ignore an explicitly supplied invalid client', async t => {
  const calls = setup(t);
  for (const handler of [createTask, createTasksBulk]) {
    const res = response();
    await handler({ user: actor, body: body({ client: ids.other, taskName: 'Review' }) }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(calls.tasks.length, 0);
});
test('foreign or inactive client creates neither tasks nor links', async t => {
  const calls = setup(t); const res = response();
  await createLinkedTasks({ user: actor, body: body({ client: ids.other }) }, res);
  assert.equal(res.code, 400); assert.equal(calls.tasks.length, 0); assert.equal(calls.projectWrites, 0);
});
test('TL cannot forge a different team or a project outside their team', async t => {
  const calls = setup(t, { project: { teams: [ids.other] } }); const user = { ...actor, role: 'team_lead', team: ids.team };
  const differentTeam = response();
  await createLinkedTasks({ user, body: body({ teams: [ids.other] }) }, differentTeam);
  assert.equal(differentTeam.code, 403);
  const differentProject = response();
  await createLinkedTasks({ user, body: body() }, differentProject);
  assert.equal(differentProject.code, 403); assert.equal(calls.tasks.length, 0);
});
test('TL creates one shared project/client batch only for their live team', async t => {
  const calls = setup(t); const res = response();
  await createLinkedTasks({ user: { ...actor, role: 'team_lead', team: ids.team }, body: body() }, res);
  assert.equal(res.code, 201); assert.equal(calls.tasks.length, 2);
});
test('stale team membership cannot write tasks', async t => {
  const calls = setup(t, { teamCount: 0 }); const res = response();
  await createLinkedTasks({ user: actor, body: body() }, res);
  assert.equal(res.code, 403); assert.equal(calls.tasks.length, 0);
});
test('an employee outside the chosen active teams cannot be assigned', async t => {
  const calls = setup(t); const res = response();
  t.mock.method(Employee, 'countDocuments', filter => {
    assert.deepEqual(filter.team, { $in: [ids.team] });
    assert.equal(filter.role, 'employee'); assert.equal(filter.isActive, true);
    return query(0);
  });
  await createLinkedTasks({ user: actor, body: body({ assignToAllEmployees: false, assignedTo: [ids.other] }) }, res);
  assert.equal(res.code, 403); assert.equal(calls.tasks.length, 0);
});
test('same task names may be created under a different client using separate task IDs', async t => {
  const calls = setup(t, { project: { clients: [ids.client, ids.other] }, clients: [{ _id: ids.client }, { _id: ids.other }] });
  t.mock.method(ActivityMapping, 'find', filter => {
    assert.equal(filter.client, ids.other, 'duplicate lookup is scoped to the selected client');
    return query([]);
  });
  const res = response();
  await createLinkedTasks({ user: actor, body: body({ client: ids.other }) }, res);
  assert.equal(res.code, 201); assert.ok(calls.links.every(link => link.client === ids.other));
});
test('individual assignments need reassign_tasks even for an otherwise valid creator', async t => {
  const calls = setup(t); const res = response();
  await createLinkedTasks({ user: { ...actor, role: 'employee', team: ids.team, permissionOverrides: { granted: ['create_tasks'] } }, body: body({ assignToAllEmployees: false, assignedTo: [ids.other] }) }, res);
  assert.equal(res.code, 403); assert.equal(calls.tasks.length, 0);
});
test('a duplicate in the selected client rejects the entire batch before inserts', async t => {
  const calls = setup(t, { duplicates: [{ taskName: ' REVIEW ' }] }); const res = response();
  await createLinkedTasks({ user: actor, body: body() }, res);
  assert.equal(res.code, 409); assert.equal(calls.tasks.length, 0); assert.equal(calls.projectWrites, 0);
});
test('mapping failure aborts the transaction and is never reported as success', async t => {
  const calls = setup(t); const res = response();
  t.mock.method(console, 'error', () => {});
  t.mock.method(ActivityMapping, 'insertMany', async () => { throw new Error('injected mapping failure'); });
  let aborted = false;
  calls.session.withTransaction = async fn => { try { await fn(); } catch (error) { aborted = true; calls.tasks = []; calls.projectWrites = 0; throw error; } };
  await createLinkedTasks({ user: actor, body: body() }, res);
  assert.equal(res.code, 500); assert.equal(aborted, true); assert.equal(calls.tasks.length, 0); assert.equal(calls.ended, true);
});
test('creation options expose only active projects in the TL scope and linked active clients', async t => {
  setup(t);
  let filter;
  t.mock.method(Project, 'find', value => { filter = value; return query([{ _id: ids.project, projectName: 'Audit', clients: [ids.client, ids.other], teams: [ids.team] }]); });
  const res = response();
  await getTaskCreationOptions({ user: { ...actor, role: 'team_lead', team: ids.team } }, res);
  assert.equal(res.code, 200); assert.equal(filter.status, 'Active'); assert.ok(filter.$or);
  assert.deepEqual(res.body.projects[0].clientIds, [ids.client]);
});
