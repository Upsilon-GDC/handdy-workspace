const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { allowedClientIds, clientAccessError, replacePolicies, rememberPolicy } = require('../src/services/clientAccess');
const { activityOptionsForEmployee, validateActivitySelection } = require('../src/services/activitySelection');
const Client = require('../src/models/Client');
const Task = require('../src/models/Task');
const Team = require('../src/models/Team');
const Project = require('../src/models/Project');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const { startTimer } = require('../src/modules/timers/taskTimeLogController');
const { buildEmployeeScope, projectAllowedForTeam } = require('../src/services/activitySelection');
const employee = { _id: 'person', team: 'software', role: 'employee' };
const policy = (subjectType, subjectId, clients, enabled = true) => ({ subjectType, subjectId, clients, enabled });
const query = rows => ({ select() { return this; }, sort() { return this; }, lean: async () => rows });
afterEach(() => replacePolicies([]));
test('unconfigured and disabled policies preserve project-based selection', () => {
  assert.equal(allowedClientIds(employee), null);
  replacePolicies([policy('team', 'software', [], false), policy('employee', 'person', [], false)]);
  assert.equal(allowedClientIds(employee), null);
});
test('employees inherit team clients and individual choices can only narrow them', () => {
  replacePolicies([policy('team', 'software', ['upsilon', 'wcpa'])]);
  assert.deepEqual(allowedClientIds(employee), ['upsilon', 'wcpa']);
  rememberPolicy(policy('employee', 'person', ['upsilon', 'renau']));
  assert.deepEqual(allowedClientIds(employee), ['upsilon']);
  assert.match(clientAccessError(employee, 'renau'), /allowed/);
  rememberPolicy(policy('team', 'software', ['wcpa']));
  assert.deepEqual(allowedClientIds(employee), []);
});
test('explicit empty restrictions deny new selections; disabling override restores inheritance', () => {
  replacePolicies([policy('team', 'software', ['upsilon']), policy('employee', 'person', [])]);
  assert.match(clientAccessError(employee, 'upsilon'), /allowed/);
  assert.match(clientAccessError(employee, null), /allowed/);
  rememberPolicy(policy('employee', 'person', [], false));
  assert.equal(clientAccessError(employee, 'upsilon'), null);
});

test('explicit cross-team selection replaces team limits only for the configured employee and preserves project links', async () => {
  replacePolicies([policy('team', 'software', ['upsilon']),
    { ...policy('employee', 'person', ['upsilon', 'renau']), overrideTeam: true }]);
  assert.deepEqual(allowedClientIds(employee), ['upsilon', 'renau']);
  assert.deepEqual(allowedClientIds({ ...employee, _id: 'someone-else' }), ['upsilon']);
  assert.equal(clientAccessError(employee, 'renau'), null);
  assert.match((await validateActivitySelection({ clients: ['upsilon'] }, 'renau', 'task', employee)).error, /not linked/);
  assert.equal((await validateActivitySelection({ clients: ['renau'] }, 'renau', 'task', employee)).error, undefined);
  rememberPolicy({ ...policy('employee', 'person', []), overrideTeam: true });
  assert.deepEqual(allowedClientIds(employee), []);
  rememberPolicy({ ...policy('employee', 'person', [], false), overrideTeam: true });
  assert.deepEqual(allowedClientIds(employee), ['upsilon']);
});
test('moving team uses the new team policy; another employee does not inherit an individual override', () => {
  replacePolicies([policy('team', 'other', ['wcpa']), policy('employee', 'person', ['upsilon'])]);
  assert.deepEqual(allowedClientIds({ ...employee, team: 'other' }), []);
  assert.equal(allowedClientIds({ ...employee, _id: 'another' }), null);
});

test('additional work teams allow shared work without changing primary membership, clients or task management', async t => {
  replacePolicies([{ ...policy('employee', 'person', [], false), workTeams: ['wcpa', 'inactive'] }]);
  t.mock.method(Team, 'exists', async () => ({ _id: 'software' }));
  t.mock.method(Team, 'find', () => query([{ _id: 'wcpa' }]));
  const scope = await buildEmployeeScope(employee);
  assert.equal(employee.team, 'software');
  assert.equal(allowedClientIds(employee), null);
  assert.deepEqual(scope.teamIds, ['software', 'wcpa']);
  assert.equal(projectAllowedForTeam({ teams: ['wcpa'] }, scope, employee), true);
  assert.equal(projectAllowedForTeam({ teams: ['inactive'] }, scope, employee), false);
  assert.equal(projectAllowedForTeam({ teams: ['unrelated'] }, scope, employee), false);
  assert.deepEqual(scope.taskScope.$or[1].$and[1], { assignToAllEmployees: true });
  assert.equal((await buildEmployeeScope({ ...employee, _id: 'another' })).teamIds.includes('wcpa'), false);
});
test('activity picker intersects project, team and employee limits without extra database policy reads', async t => {
  replacePolicies([policy('team', 'software', ['upsilon', 'wcpa']), policy('employee', 'person', ['upsilon'])]);
  t.mock.method(Team, 'exists', async () => ({ _id: 'software' }));
  t.mock.method(Client, 'find', filter => {
    assert.deepEqual(filter, { status: 'Active', _id: { $in: ['upsilon'] } });
    return query([{ _id: 'upsilon', clientName: 'Upsilon' }]);
  });
  t.mock.method(Task, 'find', () => query([]));
  const options = await activityOptionsForEmployee({ _id: 'project', teams: ['software'], clients: ['upsilon', 'renau'] }, employee);
  assert.deepEqual(options.clients.map(row => row._id), ['upsilon']);
  assert.match((await validateActivitySelection({ clients: ['renau'] }, 'renau', 'task', employee)).error, /allowed/);
});
test('an empty allowed list never reopens all active clients on an unlinked project', async t => {
  replacePolicies([policy('team', 'software', [])]);
  t.mock.method(Team, 'exists', async () => ({ _id: 'software' }));
  t.mock.method(Client, 'find', filter => { assert.deepEqual(filter._id, { $in: [] }); return query([]); });
  t.mock.method(Task, 'find', () => query([]));
  assert.deepEqual((await activityOptionsForEmployee({ _id: 'project', clients: [] }, employee)).clients, []);
});

test('a forged timer Start for a project-linked but team-disallowed client writes no time log', async t => {
  replacePolicies([policy('team', 'software', ['upsilon'])]);
  t.mock.method(TaskTimeLog, 'find', () => query([]));
  t.mock.method(Project, 'findById', async () => ({ _id: 'project', status: 'Active', clients: ['upsilon', 'renau'], teams: ['software'] }));
  t.mock.method(Client, 'exists', async () => ({ _id: 'renau' }));
  t.mock.method(Team, 'exists', async () => ({ _id: 'software' }));
  t.mock.method(Task, 'findOne', async () => ({ _id: 'task' }));
  const create = t.mock.method(TaskTimeLog, 'create', async () => { throw Error('Must not create a timer'); });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await startTimer({ user: employee, body: { project: 'project', task: 'task', client: 'renau', clientType: 'desktop' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /allowed/);
  assert.equal(create.mock.callCount(), 0);
});

test('client-access settings reject employee and delegated team-lead roles before route reads or writes', () => {
  const router = require('../src/modules/settings/clientAccessRoutes');
  const guard = router.stack[1].handle;
  for (const role of ['employee', 'team_lead', 'hr']) {
    let next = false;
    const res = { status(code) { this.code = code; return this; }, json() { return this; } };
    guard({ user: { role } }, res, () => { next = true; });
    assert.equal(res.code, 403); assert.equal(next, false);
  }
});

test('bulk access validation bounds and deduplicates members before any database work', () => {
  const { validateSave } = require('../src/modules/settings/clientAccessController');
  for (const body of [undefined, null, [], 'invalid']) {
    assert.throws(() => validateSave({ body }, true), error => error.statusCode === 400);
  }
  const team = '64b000000000000000000001', employee = '64b000000000000000000002';
  const body = { team, enabled: true, clients: [], employees: [{ id: employee, version: 0 }] };
  assert.equal(validateSave({ body }, true).targets.length, 1);
  assert.equal(validateSave({ body: { ...body, overrideTeam: true } }, true).overrideTeam, true);
  for (const overrideTeam of ['true', 1]) assert.throws(() => validateSave({ body: { ...body, overrideTeam } }, true));
  assert.throws(() => validateSave({ body: { ...body, enabled: false, overrideTeam: true } }, true));
  assert.throws(() => validateSave({ params: { type: 'team', id: team }, body: { ...body, version: 0, overrideTeam: true } }, false));
  assert.throws(() => validateSave({ body: { ...body, workTeams: ['bad'] } }, true));
  assert.throws(() => validateSave({ body: { ...body, workProjects: ['bad'] } }, true));
  assert.throws(() => validateSave({ params: { type: 'team', id: team }, body: { ...body, version: 0, workProjects: [team] } }, false));
  assert.throws(() => validateSave({ params: { type: 'team', id: team }, body: { ...body, version: 0, workTeams: [team] } }, false));
  for (const invalid of [{ employees: [] }, { employees: Array(501).fill(body.employees[0]) }, { employees: [...body.employees, ...body.employees] }, { team: 'bad' }, { employees: [{ id: employee, version: -1 }] }]) {
    assert.throws(() => validateSave({ body: { ...body, ...invalid } }, true));
  }
});


test('project client limits narrow only the configured employee and project, including empty limits', async t => {
  replacePolicies([policy('team', 'software', ['wcpa', 'upsilon']), {
    ...policy('employee', 'person', ['wcpa', 'upsilon']), overrideTeam: true,
    projectClients: [{ project: 'tax', clients: ['wcpa'] }, { project: 'blocked', clients: [] }],
  }]);
  assert.deepEqual(allowedClientIds(employee, 'tax'), ['wcpa']);
  assert.deepEqual(allowedClientIds(employee, { _id: 'tax' }), ['wcpa']);
  assert.deepEqual(allowedClientIds(employee, 'no-project'), ['wcpa', 'upsilon']);
  assert.deepEqual(allowedClientIds({ ...employee, _id: 'exception' }, 'tax'), ['wcpa', 'upsilon']);
  assert.deepEqual(allowedClientIds(employee, 'blocked'), []);
  assert.match(clientAccessError(employee, 'upsilon', 'tax'), /allowed/);
  assert.equal(clientAccessError(employee, 'upsilon', 'no-project'), null);
  for (const activityMappingEnabled of [false, true]) {
    assert.match((await validateActivitySelection({ _id: 'tax', clients: ['wcpa', 'upsilon'], activityMappingEnabled }, 'upsilon', 'task', employee)).error, /allowed/);
  }
  t.mock.method(Team, 'exists', async () => ({ _id: 'software' }));
  t.mock.method(Client, 'find', filter => {
    assert.deepEqual(filter._id, { $in: ['wcpa'] });
    return query([{ _id: 'wcpa', clientName: 'WCPA' }]);
  });
  t.mock.method(Task, 'find', () => query([]));
  const options = await activityOptionsForEmployee({ _id: 'tax', clients: ['wcpa', 'upsilon'] }, employee);
  assert.deepEqual(options.clients.map(row => row._id), ['wcpa']);
  rememberPolicy({ ...policy('employee', 'person', ['wcpa']), projectClients: [{ project: 'tax', clients: ['upsilon'] }] });
  assert.deepEqual(allowedClientIds(employee, 'tax'), [], 'project limits cannot grant clients beyond global access');
  rememberPolicy({ ...policy('employee', 'person', [], false), projectClients: [{ project: 'tax', clients: [] }] });
  assert.deepEqual(allowedClientIds(employee, 'tax'), ['wcpa', 'upsilon'], 'disabled employee restrictions restore inheritance');
});

test('project client API validation rejects duplicate, malformed and team-scoped limits', () => {
  const { validateSave } = require('../src/modules/settings/clientAccessController');
  const team = '64b000000000000000000001', employee = '64b000000000000000000002';
  const body = { enabled: true, clients: [team], version: 0, projectClients: [{ project: team, clients: [team, team] }] };
  const req = { params: { type: 'employee', id: employee }, body };
  assert.deepEqual(validateSave(req, false).projectClients, [{ project: team, clients: [team] }]);
  assert.equal(validateSave({ ...req, body: { ...body, projectClients: undefined } }, false).projectClients, undefined);
  for (const projectClients of [null, {}, [null], [{ project: 'bad', clients: [] }], [{ project: team, clients: 'bad' }],
    [{ project: team, clients: ['bad'] }], [...body.projectClients, ...body.projectClients], Array(501).fill(body.projectClients[0])]) {
    assert.throws(() => validateSave({ ...req, body: { ...body, projectClients } }, false), error => error.statusCode === 400);
  }
  assert.throws(() => validateSave({ ...req, params: { type: 'team', id: team } }, false));
});
