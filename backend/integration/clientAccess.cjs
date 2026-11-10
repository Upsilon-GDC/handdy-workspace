// Isolated test database only: never loads .env or an application URI.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Team = require('../src/models/Team');
const Employee = require('../src/models/Employee');
const Client = require('../src/models/Client');
const Policy = require('../src/models/ClientAccessPolicy');
const Change = require('../src/models/ClientAccessChange');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const ActivityMapping = require('../src/models/ActivityMapping');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const Attendance = require('../src/models/Attendance');
const { activityOptionsForEmployee } = require('../src/services/activitySelection');
const { getAllProjects } = require('../src/modules/projects/projectController');
const { startTimer } = require('../src/modules/timers/taskTimeLogController');
const { getManualEntryOptions, createManualEntry } = require('../src/modules/timers/manualTimeEntryController');
const controller = require('../src/modules/settings/clientAccessController');
const router = require('../src/modules/settings/clientAccessRoutes');
const { initializeClientAccess, allowedClientIds, replacePolicies } = require('../src/services/clientAccess');
const actor = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
let server, team, person, upsilon, other;
before(async () => {
  server = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  const uri = server.getUri(); assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  for (const Model of [Team, Employee, Client, Project, Task, ActivityMapping, TaskTimeLog, Attendance]) await Model.createCollection();
  team = await Team.create({ teamName: 'Synthetic software', createdBy: actor._id });
  person = { _id: new mongoose.Types.ObjectId(), team: team._id, role: 'employee', isActive: true, fullName: 'Synthetic employee' };
  await Employee.collection.insertOne(person);
  upsilon = await Client.create({ clientName: 'Synthetic Upsilon', createdBy: actor._id });
  other = await Client.create({ clientName: 'Synthetic other', createdBy: actor._id });
  await initializeClientAccess();
}, { timeout: 120000 });
after(async () => { replacePolicies([]); await mongoose.disconnect(); await server?.stop(); });
async function save(type, id, body) {
  const handler = router.stack.find(layer => layer.route?.methods.put).route.stack.at(-1).handle;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { type, id: String(id) }, body, user: actor }, res);
  return res;
}
test('team save persists restriction, employee override narrows it, and startup restores both', async () => {
  assert.equal(allowedClientIds(person), null);
  const first = await save('team', team._id, { enabled: true, clients: [String(upsilon._id), String(other._id)], version: 0 });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.policy.version, 1);
  const own = await save('employee', person._id, { enabled: true, clients: [String(upsilon._id)], version: 0 });
  assert.equal(own.statusCode, 200, JSON.stringify(own.body));
  assert.deepEqual(allowedClientIds(person), [String(upsilon._id)]);
  replacePolicies([]); await initializeClientAccess();
  assert.deepEqual(allowedClientIds(person), [String(upsilon._id)]);
});
test('stale versions cannot overwrite a team or its effective in-memory restriction', async () => {
  const saved = await save('team', team._id, { enabled: true, clients: [String(upsilon._id)], version: 1 });
  assert.equal(saved.statusCode, 200);
  for (const version of [0, 1]) {
    const stale = await save('team', team._id, { enabled: false, clients: [], version });
    assert.equal(stale.statusCode, 409);
  }
  assert.equal((await Policy.findOne({ subjectType: 'team', subjectId: team._id })).version, 2);
  assert.deepEqual(allowedClientIds(person), [String(upsilon._id)]);
});
test('invalid clients, inactive subjects and malformed requests do not change saved access', async () => {
  const version = 2;
  assert.equal((await save('team', team._id, { enabled: true, clients: [String(new mongoose.Types.ObjectId())], version })).statusCode, 400);
  assert.equal((await save('team', team._id, { enabled: 'true', clients: [], version })).statusCode, 400);
  await Employee.collection.updateOne({ _id: person._id }, { $set: { isActive: false } });
  assert.equal((await save('employee', person._id, { enabled: true, clients: [], version: 1 })).statusCode, 404);
  assert.equal((await Policy.findOne({ subjectType: 'team', subjectId: team._id })).version, version);
});

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function batch(body) { const res = response(); await controller.saveBatch({ body, user: { ...actor, fullName: 'Synthetic administrator' } }, res); return res; }
async function membersFixture() {
  const group = await Team.create({ teamName: `Synthetic bulk ${new mongoose.Types.ObjectId()}`, createdBy: actor._id });
  const members = ['First', 'Second'].map(name => ({ _id: new mongoose.Types.ObjectId(), fullName: name, team: group._id, role: 'employee', isActive: true }));
  await Employee.collection.insertMany(members);
  return { group, members, body: { team: String(group._id), employees: members.map(row => ({ id: String(row._id), version: 0 })), enabled: true, clients: [String(upsilon._id)] } };
}
test('one batch updates multiple members and records names, actor and before/after values in one history entry', async () => {
  const f = await membersFixture(), before = await Change.countDocuments();
  const saved = await batch(f.body);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.policies.length, 2);
  assert.equal(await Change.countDocuments(), before + 1);
  assert.equal(saved.body.history.actorName, 'Synthetic administrator');
  assert.equal(saved.body.history.targets.length, 2);
  assert.ok(saved.body.history.targets.every(row => row.beforeEnabled === false && row.afterEnabled === true && row.afterClients[0].name === upsilon.clientName));
  assert.ok(f.members.every(row => allowedClientIds(row)[0] === String(upsilon._id)));
  const inherited = await batch({ ...f.body, enabled: false, clients: [], employees: f.body.employees.map(row => ({ ...row, version: 1 })) });
  assert.equal(inherited.statusCode, 200);
  assert.ok(inherited.body.history.targets.every(row => row.beforeEnabled === true && row.beforeClients[0].name === upsilon.clientName && row.afterEnabled === false));
});
test('one stale version or a member moved to another team aborts the entire batch without history', async () => {
  const f = await membersFixture(); await batch(f.body);
  const before = await Change.countDocuments();
  const stale = await batch({ ...f.body, clients: [String(other._id)], employees: [{ ...f.body.employees[0], version: 1 }, f.body.employees[1]] });
  assert.equal(stale.statusCode, 409);
  await Employee.collection.updateOne({ _id: f.members[1]._id }, { $set: { team: team._id } });
  assert.equal((await batch({ ...f.body, employees: f.body.employees.map(row => ({ ...row, version: 1 })) })).statusCode, 409);
  assert.equal(await Change.countDocuments(), before);
  const policies = await Policy.find({ subjectId: { $in: f.members.map(row => row._id) } }).lean();
  assert.ok(policies.every(row => row.version === 1 && String(row.clients[0]) === String(upsilon._id)));
});

test('cross-team employee batches persist independently of team limits and audit mode changes across restart', async () => {
  const f = await membersFixture();
  assert.equal((await save('team', f.group._id, { enabled: true, clients: [String(upsilon._id)], version: 0 })).statusCode, 200);
  const body = { ...f.body, overrideTeam: true, clients: [String(other._id)] };
  const saved = await batch(body);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.ok(saved.body.policies.every(row => row.overrideTeam === true));
  assert.ok(saved.body.history.targets.every(row => !row.beforeOverrideTeam && row.afterOverrideTeam));
  replacePolicies([]); await initializeClientAccess();
  assert.ok(f.members.every(row => allowedClientIds(row).join() === String(other._id)));
  const restored = await batch({ ...body, overrideTeam: false, employees: body.employees.map(row => ({ ...row, version: 1 })) });
  assert.equal(restored.statusCode, 200);
  assert.ok(restored.body.history.targets.every(row => row.beforeOverrideTeam && !row.afterOverrideTeam));
  assert.ok(f.members.every(row => allowedClientIds(row).length === 0));
});
test('a history insertion failure rolls back policy writes and leaves picker cache unchanged', async t => {
  const f = await membersFixture(), before = await Change.countDocuments();
  t.mock.method(Change, 'create', async () => { throw new Error('Synthetic history failure'); });
  const saved = await batch(f.body);
  assert.equal(saved.statusCode, 500);
  assert.equal(await Policy.countDocuments({ subjectId: { $in: f.members.map(row => row._id) } }), 0);
  assert.equal(await Change.countDocuments(), before);
  assert.ok(f.members.every(row => allowedClientIds(row) === null));
});

test('Tax members keep their main team while granted WCPA projects, mapped shared tasks and timer/manual access', async () => {
  const f = await membersFixture();
  const wcpa = await Team.create({ teamName: `WCPA work ${new mongoose.Types.ObjectId()}`, createdBy: actor._id });
  const projects = await Project.create(['Audit', 'Bookkeeping'].map(name => ({ projectName: name, projectCode: `${name}-${new mongoose.Types.ObjectId()}`,
    teams: [wcpa._id], clients: [other._id], activityMappingEnabled: true, createdBy: actor._id })));
  const tasks = await Task.create(projects.map(project => ({ taskName: `${project.projectName} shared`, taskCode: `T-${new mongoose.Types.ObjectId()}`,
    project: project._id, teams: [wcpa._id], assignToAllEmployees: true, createdBy: actor._id })));
  const privateTask = await Task.create({ taskName: 'Another employee only', taskCode: `T-${new mongoose.Types.ObjectId()}`,
    project: projects[0]._id, teams: [wcpa._id], assignedTo: [new mongoose.Types.ObjectId()], createdBy: actor._id });
  await ActivityMapping.create([...tasks.map((task, index) => ({ project: projects[index]._id, client: other._id, task: task._id })),
    { project: projects[0]._id, client: other._id, task: privateTask._id }]);
  assert.equal(await activityOptionsForEmployee(projects[0], f.members[0]), null);
  const granted = await batch({ ...f.body, clients: [String(other._id)], overrideTeam: true, workTeams: [String(wcpa._id)] });
  assert.equal(granted.statusCode, 200, JSON.stringify(granted.body));
  assert.ok(granted.body.history.targets.every(row => row.afterWorkTeams[0].name === wcpa.teamName));
  replacePolicies([]); await initializeClientAccess();
  for (const employee of f.members) {
    const visible = response(); await getAllProjects({ user: employee, query: { limit: '100' } }, visible);
    assert.equal(visible.statusCode, 200);
    assert.ok(projects.every(project => visible.body.projects.some(row => String(row._id) === String(project._id))));
    for (let index = 0; index < projects.length; index++) {
      const choices = await activityOptionsForEmployee(projects[index], employee);
      assert.deepEqual(choices.tasks.map(row => String(row._id)), [String(tasks[index]._id)]);
      assert.deepEqual(choices.clients.map(row => String(row._id)), [String(other._id)]);
    }
  }
  const manual = response(); await getManualEntryOptions({ user: actor, query: { employee: String(f.members[0]._id) } }, manual);
  assert.equal(manual.statusCode, 200, JSON.stringify(manual.body));
  assert.ok(projects.every(project => manual.body.projects.some(row => String(row._id) === String(project._id))));
  const forged = response(); await startTimer({ user: f.members[0], body: { project: String(projects[0]._id), task: String(privateTask._id), client: String(other._id) } }, forged);
  assert.equal(forged.statusCode, 404);
  const started = response(); await startTimer({ user: f.members[0], body: { project: String(projects[0]._id), task: String(tasks[0]._id), client: String(other._id), clientType: 'desktop' } }, started);
  assert.equal(started.statusCode, 201, JSON.stringify(started.body));
  assert.ok(started.body.timeLog.desktopHeartbeatAt);
  const revoked = await batch({ ...f.body, clients: [String(other._id)], overrideTeam: true, workTeams: [], employees: f.body.employees.map(row => ({ ...row, version: 1 })) });
  assert.equal(revoked.statusCode, 200);
  assert.ok(revoked.body.history.targets.every(row => row.beforeWorkTeams.length === 1 && row.afterWorkTeams.length === 0));
  assert.equal(await activityOptionsForEmployee(projects[0], f.members[0]), null);
  const log = await TaskTimeLog.findById(started.body.timeLog._id).lean();
  assert.equal(log.status, 'running', 'revoking work access does not rewrite an existing timer');
  assert.ok((await Employee.find({ _id: { $in: f.members.map(row => row._id) } }).lean()).every(row => String(row.team) === String(f.group._id)));
});
test('history remains readable across restart and uses stable paginated ordering', async () => {
  await initializeClientAccess();
  const res = response(); await controller.getHistory({ query: { page: '1', limit: '2' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.history.length, 2);
  assert.ok(res.body.totalRecords >= 3); assert.ok(res.body.totalPages >= 2);
  assert.ok(+res.body.history[0].createdAt >= +res.body.history[1].createdAt);
});

test('specific project grants allow only selected projects and shared tasks, persist, and revoke without moving employees', async () => {
  const f = await membersFixture();
  const wcpa = await Team.create({ teamName: `Direct projects ${new mongoose.Types.ObjectId()}`, createdBy: actor._id });
  const projects = await Project.create(['Audit', 'Bookkeeping', 'Unselected project'].map(name => ({ projectName: name,
    projectCode: `P-${new mongoose.Types.ObjectId()}`, teams: [wcpa._id], clients: [other._id], activityMappingEnabled: true, createdBy: actor._id })));
  const tasks = await Task.create(projects.map(project => ({ taskName: 'Shared work', taskCode: `T-${new mongoose.Types.ObjectId()}`,
    project: project._id, teams: [wcpa._id], assignToAllEmployees: true, createdBy: actor._id })));
  const privateTask = await Task.create({ taskName: 'Private work', taskCode: `T-${new mongoose.Types.ObjectId()}`, project: projects[0]._id,
    teams: [wcpa._id], assignedTo: [new mongoose.Types.ObjectId()], createdBy: actor._id });
  await ActivityMapping.create([...tasks.map((task, index) => ({ project: projects[index]._id, client: other._id, task: task._id })),
    { project: projects[0]._id, client: other._id, task: privateTask._id }]);
  const input = { ...f.body, overrideTeam: true, clients: [String(other._id)], workProjects: projects.slice(0, 2).map(row => String(row._id)), workTeams: [] };
  const historyBefore = await Change.countDocuments();
  assert.equal((await batch({ ...input, workProjects: [...input.workProjects, String(new mongoose.Types.ObjectId())] })).statusCode, 400);
  assert.equal(await Change.countDocuments(), historyBefore);
  assert.equal(await Policy.countDocuments({ subjectId: { $in: f.members.map(row => row._id) } }), 0);
  const granted = await batch(input);
  assert.equal(granted.statusCode, 200, JSON.stringify(granted.body));
  assert.ok(granted.body.history.targets.every(row => row.afterWorkProjects.length === 2 && row.afterWorkTeams.length === 0));
  replacePolicies([]); await initializeClientAccess();
  for (const employee of f.members) {
    const visible = response(); await getAllProjects({ user: employee, query: { limit: '100' } }, visible);
    assert.equal(visible.statusCode, 200);
    assert.ok(projects.slice(0, 2).every(project => visible.body.projects.some(row => String(row._id) === String(project._id))));
    assert.ok(!visible.body.projects.some(row => String(row._id) === String(projects[2]._id)), 'same-team sibling project is not granted');
    for (let index = 0; index < 2; index++) {
      const choices = await activityOptionsForEmployee(projects[index], employee);
      assert.deepEqual(choices.tasks.map(row => String(row._id)), [String(tasks[index]._id)]);
    }
    assert.equal(await activityOptionsForEmployee(projects[2], employee), null);
  }
  const manual = response(); await getManualEntryOptions({ user: actor, query: { employee: String(f.members[1]._id) } }, manual);
  assert.equal(manual.statusCode, 200, JSON.stringify(manual.body));
  assert.ok(projects.slice(0, 2).every(project => manual.body.projects.some(row => String(row._id) === String(project._id))));
  assert.ok(!manual.body.projects.some(row => String(row._id) === String(projects[2]._id)));
  const created = response(); await createManualEntry({ user: actor, body: { employee: String(f.members[1]._id), project: String(projects[1]._id),
    task: String(tasks[1]._id), client: String(other._id), startedAt: new Date(Date.now() - 120000).toISOString(),
    stoppedAt: new Date(Date.now() - 60000).toISOString(), reason: 'Synthetic direct project work' } }, created);
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  for (const [project, task, status] of [[projects[2], tasks[2], 403], [projects[0], privateTask, 404]]) {
    const denied = response(); await startTimer({ user: f.members[0], body: { project: String(project._id), task: String(task._id), client: String(other._id) } }, denied);
    assert.equal(denied.statusCode, status);
  }
  const started = response(); await startTimer({ user: f.members[0], body: { project: String(projects[0]._id), task: String(tasks[0]._id), client: String(other._id), clientType: 'desktop' } }, started);
  assert.equal(started.statusCode, 201, JSON.stringify(started.body));
  const legacySave = await batch({ ...f.body, overrideTeam: true, clients: input.clients, employees: f.body.employees.map(row => ({ ...row, version: 1 })) });
  assert.equal(legacySave.statusCode, 200);
  assert.ok(legacySave.body.policies.every(row => row.workProjects.length === 2), 'older saves preserve project grants');
  const revoked = await batch({ ...input, workProjects: [], employees: f.body.employees.map(row => ({ ...row, version: 2 })) });
  assert.equal(revoked.statusCode, 200);
  assert.ok(revoked.body.history.targets.every(row => row.beforeWorkProjects.length === 2 && row.afterWorkProjects.length === 0));
  assert.equal(await activityOptionsForEmployee(projects[0], f.members[0]), null);
  assert.equal((await TaskTimeLog.findById(started.body.timeLog._id).lean()).status, 'running');
  assert.ok((await Employee.find({ _id: { $in: f.members.map(row => row._id) } }).lean()).every(row => String(row.team) === String(f.group._id)));
});


test('employee project client limits persist, preserve exceptions, and enforce timer/manual choices', async () => {
  const f = await membersFixture();
  const [restricted, exception] = f.members;
  const projects = await Project.create(['Tax Review', 'Tax preparation', 'No Project'].map(name => ({
    projectName: name, projectCode: `PC-${new mongoose.Types.ObjectId()}`, teams: [f.group._id],
    clients: [other._id, upsilon._id], createdBy: actor._id,
  })));
  const tasks = await Task.create(projects.map(project => ({ taskName: 'Work', taskCode: `PC-${new mongoose.Types.ObjectId()}`,
    project: project._id, teams: [f.group._id], assignToAllEmployees: true, createdBy: actor._id })));
  const clients = [String(other._id), String(upsilon._id)];
  assert.equal((await batch({ ...f.body, clients })).statusCode, 200);
  const exceptionBefore = await Policy.findOne({ subjectId: exception._id }).lean();
  const projectClients = projects.slice(0, 2).map(project => ({ project: String(project._id), clients: [String(other._id)] }));
  const input = { enabled: true, clients, version: 1, projectClients };
  const historyBefore = await Change.countDocuments();
  for (const invalid of [
    [{ project: String(new mongoose.Types.ObjectId()), clients: [String(other._id)] }],
    [{ project: String(projects[0]._id), clients: [String(new mongoose.Types.ObjectId())] }],
  ]) assert.equal((await save('employee', restricted._id, { ...input, projectClients: invalid })).statusCode, 400);
  assert.equal(await Change.countDocuments(), historyBefore);
  const saved = await save('employee', restricted._id, input);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.history.targets[0].afterProjectClients.length, 2);
  assert.equal(saved.body.history.targets[0].afterProjectClients[0].project.name, 'Tax Review');
  assert.deepEqual(await Policy.findOne({ subjectId: exception._id }).lean(), exceptionBefore);
  replacePolicies([]); await initializeClientAccess();
  for (const project of projects.slice(0, 2)) {
    assert.deepEqual((await activityOptionsForEmployee(project, restricted)).clients.map(row => String(row._id)), [String(other._id)]);
    assert.equal((await activityOptionsForEmployee(project, exception)).clients.length, 2);
  }
  assert.equal((await activityOptionsForEmployee(projects[2], restricted)).clients.length, 2);
  const options = response();
  await getManualEntryOptions({ user: actor, query: { employee: String(restricted._id) } }, options);
  assert.equal(options.statusCode, 200, JSON.stringify(options.body));
  for (const project of projects.slice(0, 2)) assert.deepEqual(options.body.projects.find(p => String(p._id) === String(project._id)).clientIds, [String(other._id)]);
  const countBefore = await TaskTimeLog.countDocuments();
  for (const index of [0, 1]) {
    const forged = response();
    await startTimer({ user: restricted, body: { project: String(projects[index]._id), task: String(tasks[index]._id), client: String(upsilon._id), clientType: 'desktop' } }, forged);
    assert.equal(forged.statusCode, 400, JSON.stringify(forged.body)); assert.match(forged.body.message, /allowed/);
    const manual = response();
    await createManualEntry({ user: actor, body: { employee: String(restricted._id), project: String(projects[index]._id),
      task: String(tasks[index]._id), client: String(upsilon._id), startedAt: new Date(Date.now() - 120000).toISOString(),
      stoppedAt: new Date(Date.now() - 60000).toISOString(), reason: 'Synthetic disallowed project client' } }, manual);
    assert.equal(manual.statusCode, 400, JSON.stringify(manual.body)); assert.match(manual.body.message, /allowed/);
  }
  assert.equal(await TaskTimeLog.countDocuments(), countBefore);
  const started = response();
  await startTimer({ user: restricted, body: { project: String(projects[2]._id), task: String(tasks[2]._id), client: String(upsilon._id), clientType: 'desktop' } }, started);
  assert.equal(started.statusCode, 201, JSON.stringify(started.body));
  const omitted = await save('employee', restricted._id, { enabled: true, clients, version: 2 });
  assert.equal(omitted.statusCode, 200, JSON.stringify(omitted.body));
  assert.equal(omitted.body.policy.projectClients.length, 2, 'older settings callers preserve saved per-project limits');
  const cleared = await save('employee', restricted._id, { enabled: true, clients, version: 3, projectClients: [] });
  assert.equal(cleared.statusCode, 200, JSON.stringify(cleared.body));
  assert.equal((await activityOptionsForEmployee(projects[0], restricted)).clients.length, 2);
  assert.equal((await TaskTimeLog.findById(started.body.timeLog._id)).status, 'running');
});
