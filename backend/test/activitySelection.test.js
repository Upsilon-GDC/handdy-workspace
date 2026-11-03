const test = require('node:test');
const assert = require('node:assert/strict');
const ActivityMapping = require('../src/models/ActivityMapping');
const Client = require('../src/models/Client');
const Task = require('../src/models/Task');
const Team = require('../src/models/Team');
const { validateActivitySelection, activityOptionsForEmployee } = require('../src/services/activitySelection');
const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
test('configured projects reject foreign clients even during legacy task rollout', async () => {
  const result = await validateActivitySelection({ _id: 'p', clients: ['c'] }, 'other', 't');
  assert.match(result.error, /client is not linked/);
  assert.deepEqual(await validateActivitySelection({ _id: 'p', clients: [] }, 'legacy', 't'), { mapping: null });
});
test('enabled selection requires an active exact tuple and records its mapping ID', async t => {
  const project = { _id: 'p', clients: ['c'], activityMappingEnabled: true };
  t.mock.method(ActivityMapping, 'findOne', filter => {
    assert.deepEqual(filter, { project: 'p', client: 'c', task: 't', isActive: true });
    return query({ _id: 'mapping' });
  });
  assert.equal((await validateActivitySelection(project, 'c', 't')).mapping, 'mapping');
  assert.match((await validateActivitySelection(project, null, 't')).error, /Select an active client/);
});
test('removing the last mapping never falls back to unlinked task access', async t => {
  t.mock.method(ActivityMapping, 'findOne', () => query(null));
  const result = await validateActivitySelection({ _id: 'p', clients: ['c'], activityMappingEnabled: true }, 'c', 't');
  assert.match(result.error, /not linked/);
});
test('mapped picker restricts clients, tasks and employee scope; shared tasks carry per-client IDs', async t => {
  t.mock.method(Team, 'exists', async () => ({ _id: 'team' }));
  t.mock.method(Client, 'find', filter => {
    assert.deepEqual(filter, { status: 'Active', _id: { $in: ['c'] } });
    return query([{ _id: 'c', clientName: 'Client' }]);
  });
  t.mock.method(ActivityMapping, 'find', filter => {
    assert.equal(filter.isActive, true); return query([{ task: 't', client: 'c' }]);
  });
  t.mock.method(Task, 'find', filter => {
    assert.deepEqual(filter._id, { $in: ['t'] });
    assert.ok(filter.$and[0].$or.some(branch => branch.assignedTo === 'employee'));
    assert.equal(filter.taskType, 'work');
    return query([{ _id: 't', taskName: 'Shared', project: null }]);
  });
  const result = await activityOptionsForEmployee({ _id: 'p', teams: ['team'], clients: ['c'], activityMappingEnabled: true }, { _id: 'employee', role: 'employee', team: 'team' }, { workOnly: true });
  assert.equal(result.mappingEnabled, true);
  assert.deepEqual(result.tasks[0].clientIds, ['c']); assert.equal(result.tasks[0].project, 'p');
});
test('an employee cannot inspect activity choices for a different project team', async t => {
  t.mock.method(Team, 'exists', async () => ({ _id: 'team' }));
  const result = await activityOptionsForEmployee({ _id: 'p', teams: ['other'] }, { _id: 'employee', role: 'employee', team: 'team' });
  assert.equal(result, null);
});
test('an unmapped project keeps the active client catalog and task-assignment rules', async t => {
  t.mock.method(Client, 'find', filter => { assert.deepEqual(filter, { status: 'Active' }); return query([]); });
  t.mock.method(Task, 'find', filter => { assert.equal(filter._id, undefined); return query([]); });
  const result = await activityOptionsForEmployee({ _id: 'p', teams: [] }, { role: 'manager' });
  assert.equal(result.mappingEnabled, false);
});

test('legacy manual picker retains project-owned tasks in a mixed rollout', async t => {
  t.mock.method(Client, 'find', () => query([]));
  t.mock.method(Task, 'find', filter => {
    assert.equal(filter.taskType, 'work');
    assert.deepEqual(filter.$and[1], { project: 'p' });
    return query([]);
  });
  await activityOptionsForEmployee({ _id: 'p', teams: [] }, { role: 'manager' }, { workOnly: true, includeShared: false });
});
