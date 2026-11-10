const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const catalogCache = require('../src/middleware/catalogCache');
const { invalidate } = require('../src/services/readRevisions');
const { replacePolicies, rememberPolicy, allowedClientIds, workTeamIds, workProjectIds } = require('../src/services/clientAccess');
const { protect } = require('../src/middleware/authMiddleware');
const Employee = require('../src/models/Employee');
const Team = require('../src/models/Team');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const Client = require('../src/models/Client');
const ActivityMapping = require('../src/models/ActivityMapping');
const employeeRoutes = require('../src/modules/employees/employeeRoutes');
const teamRoutes = require('../src/modules/teams/teamRoutes');
const projectRoutes = require('../src/modules/projects/projectRoutes');
const response = () => ({ statusCode: 200, headers: { Vary: 'Origin' },
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
  set(headers) { Object.assign(this.headers, headers); return this; }, get(name) { return this.headers[name]; }, end() { return this; } });
function mockRevisions(t, models) {
  for (const Model of models) {
    invalidate(Model.modelName);
    t.mock.method(Model, 'aggregate', () => ({ hint: async () => [{ count: 1, latest: new Date('2026-11-06'), total: 1 }] }));
  }
}
const request = (path = '/') => ({ baseUrl: '/phase3', path, query: {}, headers: {},
  user: { _id: 'first', role: 'employee', team: 'software' } });
afterEach(() => replacePolicies([]));

test('unchanged lists retain their validator across five-minute polls; edits still invalidate it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: +new Date('2026-11-06T04:01:00Z') });
  mockRevisions(t, [Employee, Team]);
  const middleware = catalogCache([Employee, Team]);
  const req = request('/employees'); let reads = 0;
  const call = async input => { const res = response(); await middleware(input, res, () => { reads++; res.json({ success: true, employees: [{ _id: 'one' }] }); }); return res; };
  const first = await call(req);
  t.mock.timers.tick(5 * 60_000 + 1000);
  const unchanged = await call({ ...req, headers: { 'if-none-match': first.headers.ETag } });
  assert.equal(unchanged.statusCode, 304); assert.equal(reads, 1);
  assert.equal(unchanged.headers.Vary, 'Origin, Authorization');
  invalidate('Employee');
  const changed = await call({ ...req, headers: { 'if-none-match': first.headers.ETag } });
  assert.equal(changed.statusCode, 200); assert.equal(reads, 2);
  assert.notEqual(changed.headers.ETag, first.headers.ETag);
});

test('activity choices invalidate immediately when team or employee client policy changes', async t => {
  mockRevisions(t, [Project, Client, Task, Team, Employee, ActivityMapping]);
  const route = projectRoutes.stack.find(layer => layer.route?.path === '/:id/activity-options').route;
  const cache = route.stack[1].handle;
  const req = request('/software/activity-options'); let reads = 0;
  const call = async input => { const res = response(); await cache(input, res, () => { reads++; res.json({ success: true, clients: allowedClientIds(input.user) }); }); return res; };
  const first = await call(req);
  rememberPolicy({ subjectType: 'team', subjectId: 'software', enabled: true, clients: ['upsilon'], version: 1 });
  const changed = await call({ ...req, headers: { 'if-none-match': first.headers.ETag } });
  assert.equal(changed.statusCode, 200); assert.deepEqual(changed.body.clients, ['upsilon']);
  const unchanged = await call({ ...req, headers: { 'if-none-match': changed.headers.ETag } });
  assert.equal(unchanged.statusCode, 304);
  rememberPolicy({ subjectType: 'employee', subjectId: 'first', enabled: true, clients: [], version: 1 });
  const narrowed = await call({ ...req, headers: { 'if-none-match': changed.headers.ETag } });
  assert.equal(narrowed.statusCode, 200); assert.deepEqual(narrowed.body.clients, []);
  assert.equal(reads, 3);
});

test('catalog responses stay isolated by caller, query filters, team and effective permissions', async t => {
  mockRevisions(t, [Employee]);
  const cache = catalogCache([Employee]), req = request('/isolation');
  const call = async input => { const res = response(); await cache(input, res, () => res.json({ success: true, employees: [] })); return res; };
  const first = await call(req);
  for (const input of [
    { ...req, user: { ...req.user, _id: 'other' } },
    { ...req, user: { ...req.user, team: 'other' } },
    { ...req, user: { ...req.user, permissionOverrides: { granted: ['view_all_reports'], revoked: [] } } },
    { ...req, query: { page: '2' } },
    { ...req, query: { search: 'different' } },
  ]) assert.equal((await call({ ...input, headers: { 'if-none-match': first.headers.ETag } })).statusCode, 200);
});

test('shared project cache isolates additional work teams and invalidates immediately on removal', async t => {
  mockRevisions(t, [Project, Client, Team, Employee]);
  const cache = projectRoutes.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack[1].handle;
  const req = request('/work-team-projects');
  rememberPolicy({ subjectType: 'employee', subjectId: 'first', enabled: false, clients: [], workTeams: ['wcpa'], version: 1 });
  const call = async input => { const res = response(); await cache(input, res, () => res.json({ success: true, workTeams: workTeamIds(input.user) })); return res; };
  const granted = await call(req);
  assert.deepEqual(granted.body.workTeams, ['software', 'wcpa']);
  const other = await call({ ...req, user: { ...req.user, _id: 'other' }, headers: { 'if-none-match': granted.headers.ETag } });
  assert.equal(other.statusCode, 200); assert.deepEqual(other.body.workTeams, ['software']);
  rememberPolicy({ subjectType: 'employee', subjectId: 'first', enabled: false, clients: [], workTeams: [], version: 2 });
  const revoked = await call({ ...req, headers: { 'if-none-match': granted.headers.ETag } });
  assert.equal(revoked.statusCode, 200); assert.deepEqual(revoked.body.workTeams, ['software']);
});

test('employee and team list caches run after authentication and route permission gates', () => {
  for (const [router, path] of [[employeeRoutes, '/'], [employeeRoutes, '/options'], [employeeRoutes, '/my-team'], [teamRoutes, '/']]) {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route;
    assert.equal(route.stack[0].handle, protect);
    assert.equal(route.stack.length, 4, `${path} has authentication, authorization, cache, then handler`);
    assert.equal(route.stack[2].handle.name, '', 'cache is installed after permission gate');
  }
});

test('project caches isolate specific-project grants even when employee teams and clients match', async t => {
  mockRevisions(t, [Project, Client, Team, Employee, Task, ActivityMapping]);
  for (const path of ['/', '/:id/activity-options']) {
    replacePolicies([]);
    const cache = projectRoutes.stack.find(layer => layer.route?.path === path && layer.route.methods.get).route.stack[1].handle;
    const req = request(`/specific-project-grants${path}`);
    const call = async input => { const res = response(); await cache(input, res, () => res.json({ success: true, projects: workProjectIds(input.user) })); return res; };
    rememberPolicy({ subjectType: 'employee', subjectId: 'first', enabled: false, clients: [], workProjects: ['audit'], version: 1 });
    const granted = await call(req);
    assert.deepEqual(granted.body.projects, ['audit']);
    const other = await call({ ...req, user: { ...req.user, _id: 'another' }, headers: { 'if-none-match': granted.headers.ETag } });
    assert.equal(other.statusCode, 200); assert.deepEqual(other.body.projects, []);
    rememberPolicy({ subjectType: 'employee', subjectId: 'first', enabled: false, clients: [], workProjects: [], version: 2 });
    const revoked = await call({ ...req, headers: { 'if-none-match': granted.headers.ETag } });
    assert.equal(revoked.statusCode, 200); assert.deepEqual(revoked.body.projects, []);
  }
});

test('cache failures fall through and errors are never stored as successful lists', async t => {
  mockRevisions(t, [Task]);
  const cache = catalogCache([Task]), req = request('/errors');
  const first = response(); await cache(req, first, () => first.status(500).json({ success: false }));
  assert.equal(first.headers.ETag, undefined);
  const next = response(); await cache(req, next, () => next.json({ success: true, tasks: [] }));
  assert.equal(next.statusCode, 200); assert.ok(next.headers.ETag);
  invalidate('Task'); t.mock.method(Task, 'aggregate', () => { throw Error('Synthetic metadata outage'); });
  let reached = false; await cache(req, response(), () => { reached = true; });
  assert.equal(reached, true);
});


test('project-specific client changes invalidate activity choices while preserving other projects and employees', async t => {
  mockRevisions(t, [Project, Client, Task, Team, Employee, ActivityMapping]);
  const cache = projectRoutes.stack.find(layer => layer.route?.path === '/:id/activity-options').route.stack[1].handle;
  const req = { ...request('/tax/activity-options'), params: { id: 'tax' } };
  rememberPolicy({ subjectType: 'team', subjectId: 'software', enabled: true, clients: ['wcpa', 'upsilon'], version: 1 });
  const call = async input => { const res = response(); await cache(input, res, () => res.json({ success: true, clients: allowedClientIds(input.user, input.params.id) })); return res; };
  const first = await call(req);
  rememberPolicy({ subjectType: 'employee', subjectId: 'first', enabled: true, clients: ['wcpa', 'upsilon'],
    projectClients: [{ project: 'tax', clients: ['wcpa'] }], version: 1 });
  const narrowed = await call({ ...req, headers: { 'if-none-match': first.headers.ETag } });
  assert.equal(narrowed.statusCode, 200); assert.deepEqual(narrowed.body.clients, ['wcpa']);
  assert.equal((await call({ ...req, headers: { 'if-none-match': narrowed.headers.ETag } })).statusCode, 304);
  const other = await call({ ...req, user: { ...req.user, _id: 'exception' }, headers: { 'if-none-match': narrowed.headers.ETag } });
  assert.equal(other.statusCode, 200); assert.deepEqual(other.body.clients, ['wcpa', 'upsilon']);
  const noProject = await call({ ...req, path: '/no-project/activity-options', params: { id: 'no-project' } });
  assert.deepEqual(noProject.body.clients, ['wcpa', 'upsilon']);
});
