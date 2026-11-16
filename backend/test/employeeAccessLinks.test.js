const test = require('node:test');
const assert = require('node:assert/strict');
const Employee = require('../src/models/Employee');
const Project = require('../src/models/Project');
const Team = require('../src/models/Team');
const Client = require('../src/models/Client');
const Task = require('../src/models/Task');
const Mapping = require('../src/models/ActivityMapping');
const { replacePolicies } = require('../src/services/clientAccess');
const { getEmployeeLinks } = require('../src/modules/settings/employeeAccessController');
const query = rows => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => rows });
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
  set(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } });
const employeeId = '64b000000000000000000001';

test('employee preview uses timer scope, team client limits and exact task/client mappings', async t => {
  replacePolicies([{ subjectType: 'team', subjectId: 'software', enabled: true, clients: ['upsilon'] }]);
  t.after(() => replacePolicies([]));
  t.mock.method(Employee, 'findOne', filter => {
    assert.deepEqual(filter, { _id: employeeId, isActive: true, role: { $ne: 'alpha' } });
    return query({ _id: employeeId, fullName: 'Employee', employeeId: '100', role: 'employee', team: 'software', password: 'must-not-return' });
  });
  t.mock.method(Team, 'exists', async () => ({ _id: 'software' }));
  t.mock.method(Project, 'find', filter => {
    assert.deepEqual(filter, { status: 'Active', deletedAt: null });
    return query([
      { _id: 'p', projectName: 'SOFTWARE', teams: ['software'], clients: ['upsilon', 'unit1'], activityMappingEnabled: true },
      { _id: 'audit', projectName: 'AUDIT', teams: ['wcpa'] },
    ]);
  });
  t.mock.method(Client, 'find', filter => {
    assert.deepEqual(filter, { status: 'Active', _id: { $in: ['upsilon'] } });
    return query([{ _id: 'upsilon', clientName: 'UPSILON' }]);
  });
  t.mock.method(Mapping, 'find', filter => {
    assert.deepEqual(filter, { project: 'p', client: { $in: ['upsilon'] }, isActive: true });
    return query([{ client: 'upsilon', task: 'debug' }]);
  });
  const taskReads = t.mock.method(Task, 'find', filter => {
    assert.deepEqual(filter._id, { $in: ['debug'] });
    assert.ok(filter.$and[0].$or.some(part => part.assignedTo === employeeId));
    return query([{ _id: 'debug', taskName: 'Debugging', taskType: 'work' }]);
  });
  const res = response();
  await getEmployeeLinks({ params: { employeeId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.employee.password, undefined);
  assert.deepEqual(res.body.projects.map(p => p.projectName), ['SOFTWARE']);
  assert.deepEqual(res.body.projects[0].tasks[0].clientIds, ['upsilon']);
  assert.equal(taskReads.mock.callCount(), 1);
});

test('preview rejects malformed or missing employees without loading project data', async t => {
  t.mock.method(Project, 'find', () => assert.fail('must not inspect catalogs'));
  t.mock.method(Employee, 'findOne', () => query(null));
  for (const [value, expected] of [['bad', 400], [employeeId, 404]]) {
    const res = response();
    await getEmployeeLinks({ params: { employeeId: value } }, res);
    assert.equal(res.statusCode, expected);
  }
});

test('employee preview route is behind the company-admin and activity-link guards', () => {
  const router = require('../src/modules/settings/clientAccessRoutes');
  const index = router.stack.findIndex(layer => layer.route?.path === '/employees/:employeeId/links');
  assert.ok(index > 2);
  for (const role of ['employee', 'team_lead', 'hr']) {
    const res = response();
    router.stack[1].handle({ user: { role } }, res, () => assert.fail('restricted role passed'));
    assert.equal(res.statusCode, 403);
  }
});
