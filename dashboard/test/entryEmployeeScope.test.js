import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryEmployeesForTeam, UNASSIGNED_ENTRY_TEAM } from '../src/utils/entryEmployeeScope.js';
test('entry team scope handles populated references, unassigned staff and an empty initial choice', () => {
  const employees = [{ _id: 'a', team: 'team1' }, { _id: 'b', team: { _id: 'team2' } }, { _id: 'c', team: null }];
  assert.deepEqual(entryEmployeesForTeam(employees, ''), []);
  assert.deepEqual(entryEmployeesForTeam(employees, 'team1').map(e => e._id), ['a']);
  assert.deepEqual(entryEmployeesForTeam(employees, 'team2').map(e => e._id), ['b']);
  assert.deepEqual(entryEmployeesForTeam(employees, UNASSIGNED_ENTRY_TEAM).map(e => e._id), ['c']);
});
