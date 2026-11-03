import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIdsForProject, tasksForActivityProject, toggleVisibleTasks } from '../src/utils/activityLinks.js';

test('bulk selection adds only filtered tasks and preserves other selections', () => {
  assert.deepEqual(toggleVisibleTasks(['hidden'], ['a', 'b']), ['hidden', 'a', 'b']);
  assert.deepEqual(toggleVisibleTasks(['hidden', 'a', 'b'], ['a', 'b']), ['hidden']);
  assert.deepEqual(toggleVisibleTasks(['hidden'], []), ['hidden']);
});
test('task choices respect explicit projects and shared team boundaries', () => {
  const project = { _id: 'p', teams: [{ _id: 'team' }] };
  const tasks = [{ _id: 'shared', teams: ['team'] }, { _id: 'other-project', project: 'other', teams: ['team'] },
    { _id: 'other-team', teams: ['else'] }, { _id: 'specific', project: 'p', team: { _id: 'team' } }];
  assert.deepEqual(tasksForActivityProject(tasks, project).map(t => t._id), ['shared', 'specific']);
  assert.deepEqual(tasksForActivityProject(tasks, null), []);
});
test('project clients retain distinct IDs and normalize populated legacy references', () => {
  assert.deepEqual(clientIdsForProject({ clients: [{ _id: 'a' }, 'b'], client: 'a' }), ['a', 'b']);
});
