import test from 'node:test';
import assert from 'node:assert/strict';
import { clientsForTaskProject, selectedCreationClient, creationTeamsForProject, automaticCreationTeamIds, commonTaskProject } from '../src/utils/taskCreation.js';
test('a project with one client selects it automatically without another user choice', () => {
  const data = { projects: [{ _id: 'p', clientIds: ['c'] }], clients: [{ _id: 'c' }, { _id: 'other' }] };
  const clients = clientsForTaskProject(data, 'p');
  assert.deepEqual(clients, [{ _id: 'c' }]);
  assert.equal(selectedCreationClient(clients, ''), 'c');
  assert.equal(selectedCreationClient(clients, 'stale'), 'c');
});
test('automatic company access uses the project accounting teams and excludes Software', () => {
  const teams = [{ _id: 'wcpa' }, { _id: 'renau' }, { _id: 'software' }];
  assert.deepEqual(automaticCreationTeamIds(teams, { teams: ['wcpa', 'renau'] }, true), ['wcpa', 'renau']);
  assert.deepEqual(automaticCreationTeamIds(teams, { teams: [] }, true), [], 'an unrestricted legacy project must not silently grant all teams');
  assert.deepEqual(automaticCreationTeamIds([{ _id: 'wcpa' }], { teams: ['wcpa', 'renau'] }, false), ['wcpa']);
});
test('multiple clients require a valid explicit choice; stale choices cannot cross projects', () => {
  const clients = [{ _id: 'one' }, { _id: 'two' }];
  assert.equal(selectedCreationClient(clients, ''), '');
  assert.equal(selectedCreationClient(clients, 'two'), 'two');
  assert.equal(selectedCreationClient(clients, 'old-project-client'), '');
  assert.equal(selectedCreationClient([], 'two'), '');
});
test('team buttons narrow to the project without changing existing assignments', () => {
  const teams = [{ _id: 'a' }, { _id: 'b' }];
  assert.deepEqual(creationTeamsForProject(teams, { teams: ['a'] }), [{ _id: 'a' }]);
  assert.deepEqual(creationTeamsForProject(teams, { teams: [] }), teams);
});

test('multiple-project automatic assignment uses common teams and keeps unrelated teams separate', () => {
  assert.deepEqual(commonTaskProject([{ teams: ['wcpa', 'renau'] }, { teams: ['wcpa'] }]).teams, ['wcpa']);
  assert.deepEqual(commonTaskProject([{ teams: ['wcpa'] }, { teams: ['renau'] }]).teams, []);
  assert.equal(commonTaskProject([]), null);
});
