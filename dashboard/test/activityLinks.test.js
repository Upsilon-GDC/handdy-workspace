import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIdsForProject, tasksForActivityProject, toggleVisibleTasks, tasksForBulkProjects } from '../src/utils/activityLinks.js';

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

test('explicitly reused tasks are available for client linking only in matching teams', () => {
  const tasks = [{ _id: 'review', project: 'original', teams: ['tax'] }, { _id: 'foreign', project: 'original', teams: ['other'] }];
  assert.deepEqual(tasksForActivityProject(tasks, { _id: 'second', teams: ['tax'], linkedTasks: ['review', 'foreign'] }).map(task => task._id), ['review']);
});

test('bulk linking reuses existing tasks only when they share a team with every selected project', () => {
  const tasks = [{ _id: 'tax', project: 'original', teams: ['tax'] }, { _id: 'other', teams: ['other'] }];
  assert.deepEqual(tasksForBulkProjects(tasks, [{ teams: ['tax'] }, { teams: ['tax', 'other'] }]).map(task => task._id), ['tax']);
  assert.deepEqual(tasksForBulkProjects(tasks, [{ teams: ['tax'] }, { teams: ['other'] }]), []);
  assert.deepEqual(tasksForBulkProjects(tasks, []), []);
});
