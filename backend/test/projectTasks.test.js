const test = require('node:test');
const assert = require('node:assert/strict');
const Task = require('../src/models/Task');
const Project = require('../src/models/Project');
const Team = require('../src/models/Team');
const Client = require('../src/models/Client');
const { taskProjectScope, validateProjectTasks } = require('../src/services/projectTasks');
const { createProject, updateProject } = require('../src/modules/projects/projectController');
const { activityOptionsForEmployee } = require('../src/services/activitySelection');
const { validateTaskLinks } = require('../src/modules/projects/activityLinkController');
const task = '64b000000000000000000001', team = '64b000000000000000000002';
const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('reusing a task preserves its original project and checks task permission and teams', async t => {
  const existing = { _id: task, project: 'original', teams: [team] };
  t.mock.method(Task, 'find', () => query([existing]));
  assert.deepEqual(await validateProjectTasks([task, task], [team], { role: 'admin' }), [task]);
  assert.equal(existing.project, 'original');
  await assert.rejects(validateProjectTasks([task], ['other'], { role: 'admin' }), /share a team/);
  await assert.rejects(validateProjectTasks([task], [team], { role: 'employee' }), /permission/);
  await assert.rejects(validateProjectTasks(['bad-id'], [team], { role: 'admin' }), /valid existing tasks/);
  t.mock.method(Task, 'find', () => query([]));
  await assert.rejects(validateProjectTasks([task], [team], { role: 'admin' }), /inactive or outside/);
});

test('creation and editing store reusable references without writing tasks or time logs', async t => {
  t.mock.method(Team, 'find', () => ({ select: async () => [{ _id: team }] }));
  t.mock.method(Task, 'find', () => query([{ _id: task, teams: [team] }]));
  t.mock.method(Project, 'create', async value => value);
  t.mock.method(Project, 'findOne', async () => ({ teams: [team] }));
  let update;
  t.mock.method(Project, 'findByIdAndUpdate', async (_id, value) => { update = value; return value; });
  const body = { projectCode: 'NEW', projectName: 'Second project', teams: [team], linkedTasks: [task] };
  const created = response(); await createProject({ user: { role: 'admin', _id: 'admin' }, body }, created);
  assert.equal(created.code, 201); assert.deepEqual(created.body.project.linkedTasks, [task]);
  const edited = response(); await updateProject({ user: { role: 'admin' }, params: { id: 'second' }, body: { linkedTasks: [] } }, edited);
  assert.equal(edited.code, 200); assert.deepEqual(update.linkedTasks, []);
});

test('employee activity choices admit linked task IDs while retaining assignments and client mapping policy', async t => {
  t.mock.method(Team, 'exists', async () => true);
  t.mock.method(Client, 'find', () => query([]));
  t.mock.method(Task, 'find', filter => {
    assert.ok(filter.$and[0].$or.some(branch => branch.assignedTo === 'employee'));
    assert.ok(filter.$and[1].$or.some(branch => branch._id?.$in.includes(task)));
    return query([{ _id: task, taskName: 'Tax Review', project: 'original' }]);
  });
  const result = await activityOptionsForEmployee({ _id: 'second', teams: [team], linkedTasks: [task] }, { _id: 'employee', role: 'employee', team });
  assert.equal(result.tasks[0].project, 'second'); assert.equal(result.tasks[0]._id, task);
  assert.deepEqual(taskProjectScope({ _id: 'legacy' }, { includeShared: false }), { project: 'legacy' });
});

test('client links accept explicitly reused tasks and reject unrelated projects or teams', () => {
  const project = { _id: 'second', teams: [team], linkedTasks: [task] };
  assert.doesNotThrow(() => validateTaskLinks(project, [{ _id: task, project: 'original', teams: [team] }], 1));
  assert.throws(() => validateTaskLinks(project, [{ _id: 'unlinked', project: 'original', teams: [team] }], 1), /another project/);
  assert.throws(() => validateTaskLinks(project, [{ _id: task, project: 'original', teams: ['other'] }], 1), /team in common/);
});
