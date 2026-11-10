const { test } = require('node:test');
const assert = require('node:assert/strict');
const Employee = require('../src/models/Employee');
const Team = require('../src/models/Team');
const Task = require('../src/models/Task');
const Project = require('../src/models/Project');
const Client = require('../src/models/Client');
const TaskTimeLog = require('../src/models/TaskTimeLog');
const { getBillingReport } = require('../src/modules/billing/billingController');
const teamId = '64b000000000000000000030', projectId = '64b000000000000000000020', taskId = '64b000000000000000000010';
const members = [25, 40, 50].map((rate, index) => ({ _id: `64b00000000000000000000${index + 1}`, fullName: `Member ${index + 1}`, employeeId: `E${index + 1}`, team: index < 2 ? teamId : null, projectRates: [{ project: projectId, chargeRate: rate }] }));
const query = rows => ({ select() { return this; }, sort() { return this; }, lean: async () => rows });
async function invoke(params, user = { role: 'admin' }) {
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await getBillingReport({ user, query: { startDate: '2026-11-10', endDate: '2026-11-10', ...params } }, response);
  return response;
}
function fixtures(t) {
  const seen = { employeeReads: 0 };
  t.mock.method(Employee, 'find', filter => { seen.employeeReads++; seen.employeeFilter = filter; return query(members.filter(member => !Object.hasOwn(filter, 'team') || member.team === filter.team)); });
  t.mock.method(Employee, 'findOne', filter => query(members.find(member => member._id === filter._id)));
  t.mock.method(Team, 'findById', value => query(value === teamId ? { _id: teamId, teamName: 'Tax' } : null));
  t.mock.method(TaskTimeLog, 'find', filter => {
    seen.logFilter = filter;
    const ids = filter.employee.$in || [filter.employee];
    return query(members.filter(member => ids.includes(member._id)).map((member, index) => ({ _id: `log-${member._id}`, employee: member._id, project: projectId, task: taskId, startedAt: new Date('2026-11-10T06:00:00Z'), stoppedAt: new Date('2026-11-10T07:00:00Z'), pauses: [] })));
  });
  t.mock.method(Task, 'find', () => query([{ _id: taskId, taskName: 'Review', taskType: 'work' }]));
  t.mock.method(Project, 'find', () => query([{ _id: projectId, projectName: 'Tax Filing' }]));
  t.mock.method(Client, 'find', () => query([]));
  return seen;
}
test('all members of one team use one scoped log query and their own rates', async t => {
  const seen = fixtures(t);
  const response = await invoke({ employee: 'all', team: teamId });
  assert.equal(response.code, 200);
  assert.deepEqual(seen.employeeFilter, { team: teamId });
  assert.deepEqual(seen.logFilter.employee, { $in: members.slice(0, 2).map(member => member._id) });
  assert.equal(response.body.report.scope.label, 'Tax');
  assert.equal(response.body.report.scope.memberCount, 2);
  assert.equal(response.body.report.summary.totalBillableAmount, 65);
});
test('company and unassigned reports keep their requested member scope', async t => {
  const seen = fixtures(t);
  const all = await invoke({ employee: 'all', team: 'all' });
  assert.equal(all.code, 200); assert.equal(all.body.report.members.length, 3);
  assert.deepEqual(seen.employeeFilter, {});
  const unassigned = await invoke({ employee: 'all', team: 'unassigned' });
  assert.equal(unassigned.code, 200);
  assert.deepEqual(seen.employeeFilter, { team: null });
  assert.deepEqual(unassigned.body.report.members.map(row => row._id), [members[2]._id]);
});
test('billing permissions and team validation are enforced before member reads', async t => {
  const seen = fixtures(t);
  assert.equal((await invoke({ employee: 'all', team: teamId }, { role: 'employee' })).code, 403);
  assert.equal((await invoke({ employee: 'all', team: 'invalid' })).code, 400);
  assert.equal((await invoke({ employee: 'all', team: { $ne: null } })).code, 400);
  assert.equal((await invoke({ employee: 'all', team: '64b000000000000000000099' })).code, 404);
  assert.equal(seen.employeeReads, 0);
});
test('individual employee billing keeps the existing response and calculation', async t => {
  fixtures(t);
  const response = await invoke({ employee: members[0]._id });
  assert.equal(response.code, 200);
  assert.equal(response.body.report.employee.fullName, members[0].fullName);
  assert.equal(response.body.report.scope, undefined);
  assert.equal(response.body.report.summary.totalBillableAmount, 25);
});
