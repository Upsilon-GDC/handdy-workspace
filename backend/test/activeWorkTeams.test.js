const test = require('node:test');
const assert = require('node:assert/strict');
const Team = require('../src/models/Team');
const { activeWorkTeams, replacePolicies } = require('../src/services/clientAccess');

test('home and additional teams use one query and exclude inactive teams', async (t) => {
  replacePolicies([{ subjectType: 'employee', subjectId: 'person', workTeams: ['extra', 'inactive', 'home', 'extra'] }]);
  t.after(() => replacePolicies([]));
  let reads = 0;
  t.mock.method(Team, 'exists', () => assert.fail('must not make a separate home-team query'));
  t.mock.method(Team, 'find', (filter) => {
    reads += 1;
    assert.deepEqual(filter, { _id: { $in: ['home', 'extra', 'inactive'] }, isActive: true });
    return { select(fields) {
      assert.equal(fields, '_id');
      return { lean: async () => [{ _id: 'extra' }, { _id: 'home' }] };
    } };
  });
  assert.deepEqual(await activeWorkTeams({ _id: 'person', team: { _id: 'home' } }), {
    hasActiveTeam: true, teamIds: ['home', 'extra'],
  });
  assert.equal(reads, 1);
});

test('team deactivation is checked again on the next request', async (t) => {
  replacePolicies([{ subjectType: 'employee', subjectId: 'person', workTeams: ['extra'] }]);
  t.after(() => replacePolicies([]));
  let active = [{ _id: 'home' }, { _id: 'extra' }];
  t.mock.method(Team, 'find', () => ({ select: () => ({ lean: async () => active }) }));
  const person = { _id: 'person', team: 'home' };
  assert.deepEqual(await activeWorkTeams(person), { hasActiveTeam: true, teamIds: ['home', 'extra'] });
  active = [{ _id: 'extra' }];
  assert.deepEqual(await activeWorkTeams(person), { hasActiveTeam: false, teamIds: ['extra'] });
});

test('no assigned team avoids a database query', async (t) => {
  replacePolicies([]);
  t.mock.method(Team, 'find', () => assert.fail('no teams to check'));
  assert.deepEqual(await activeWorkTeams({ _id: 'unassigned' }), { hasActiveTeam: false, teamIds: [] });
});

test('additional teams work without a home team', async (t) => {
  replacePolicies([{ subjectType: 'employee', subjectId: 'person', workTeams: ['extra'] }]);
  t.after(() => replacePolicies([]));
  t.mock.method(Team, 'find', () => ({ select: () => ({ lean: async () => [{ _id: 'extra' }] }) }));
  assert.deepEqual(await activeWorkTeams({ _id: 'person' }), { hasActiveTeam: false, teamIds: ['extra'] });
});
