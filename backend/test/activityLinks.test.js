const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const Client = require('../src/models/Client');
const ActivityMapping = require('../src/models/ActivityMapping');
const { validateLinkRequest, validateTaskLinks, saveActivityLinks } = require('../src/modules/projects/activityLinkController');
const routes = require('../src/modules/projects/projectRoutes');
const ids = { project: '64b000000000000000000a01', client: '64b000000000000000000a02', task: '64b000000000000000000a03', team: '64b000000000000000000a04' };
const input = overrides => ({ ...ids, taskIds: [ids.task], action: 'link', version: 0, ...overrides });
const query = value => ({ session() { return this; }, select() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('bulk input rejects malformed, empty and oversized requests before opening a transaction', () => {
  for (const override of [{ project: 'bad' }, { client: 'bad' }, { taskIds: [] }, { taskIds: ['bad'] }, { taskIds: Array(501).fill(ids.task) }, { version: -1 }, { action: 'replace' }]) {
    assert.throws(() => validateLinkRequest(input(override)));
  }
  assert.equal(validateLinkRequest(input({ taskIds: [ids.task, ids.task] })).selectedIds.length, 1);
  assert.deepEqual(validateLinkRequest(input({ action: 'clients', clientIds: [] })).selectedIds, []);
});
test('mapping validation rejects cross-project, cross-team and out-of-scope tasks', () => {
  const project = { _id: ids.project, teams: [ids.team] };
  assert.doesNotThrow(() => validateTaskLinks(project, [{ teams: [ids.team] }], 1));
  assert.throws(() => validateTaskLinks(project, [{ project: 'other', teams: [ids.team] }], 1), /another project/);
  assert.throws(() => validateTaskLinks(project, [{ teams: ['other'] }], 1), /no team/);
  assert.throws(() => validateTaskLinks(project, [], 1), /permissions/);
});
test('routes require BOTH project and task permissions, including personal revocations', () => {
  for (const method of ['get', 'post']) {
    const route = routes.stack.find(layer => layer.route?.path === '/activity-links' && layer.route.methods[method]).route;
    for (const revoked of ['manage_projects', 'edit_tasks']) {
      const user = { role: 'hr', permissionOverrides: { revoked: [revoked] } };
      let rejected = false;
      for (const gate of route.stack.slice(1, -1)) {
        let passed = false; const res = response();
        gate.handle({ user }, res, () => { passed = true; });
        if (!passed) { assert.equal(res.code, 403); rejected = true; break; }
      }
      assert.equal(rejected, true);
    }
  }
});
function setup(t, overrides = {}) {
  const project = { _id: ids.project, clients: [ids.client], teams: [ids.team], activityLinksVersion: 0, ...overrides };
  const calls = { writes: [], ended: false };
  const session = { withTransaction: async fn => fn(), endSession: async () => { calls.ended = true; } };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Project, 'findOne', () => query(project));
  t.mock.method(Project, 'updateOne', async (...args) => { calls.writes.push(['project', ...args]); });
  t.mock.method(Client, 'exists', () => query({ _id: ids.client }));
  t.mock.method(Client, 'find', () => query([{ _id: ids.client, clientName: 'Client' }]));
  t.mock.method(Task, 'find', () => query([{ _id: ids.task, teams: [ids.team] }]));
  t.mock.method(ActivityMapping, 'bulkWrite', async (...args) => { calls.writes.push(['bulk', ...args]); });
  t.mock.method(ActivityMapping, 'updateMany', async (...args) => { calls.writes.push(['unlink', ...args]); });
  return calls;
}
const user = { role: 'admin', _id: '64b000000000000000000a05' };
test('linking uses tuple upserts in a transaction and changes no task or historical log', async t => {
  const calls = setup(t); const res = response();
  await saveActivityLinks({ body: input(), user }, res);
  assert.equal(res.code, 200); assert.equal(res.body.version, 1); assert.equal(calls.ended, true);
  const bulk = calls.writes.find(call => call[0] === 'bulk');
  assert.equal(bulk[1][0].updateOne.upsert, true);
  assert.deepEqual(bulk[1][0].updateOne.filter, { project: ids.project, client: ids.client, task: ids.task });
  assert.ok(bulk[2].session);
});
test('stale concurrent client saves fail before any write', async t => {
  const calls = setup(t, { activityLinksVersion: 2 }); const res = response();
  await saveActivityLinks({ body: input(), user }, res);
  assert.equal(res.code, 409); assert.equal(calls.writes.length, 0); assert.equal(calls.ended, true);
});
test('selection enforcement is explicit and cannot be enabled without saved mappings', async t => {
  const calls = setup(t); const res = response();
  t.mock.method(ActivityMapping, 'exists', () => query(null));
  await saveActivityLinks({ body: input({ action: 'policy', enabled: true }), user }, res);
  assert.equal(res.code, 400); assert.equal(calls.writes.length, 0);
  t.mock.method(ActivityMapping, 'exists', () => query({ _id: 'mapping' }));
  const enabled = response();
  await saveActivityLinks({ body: input({ action: 'policy', enabled: true }), user }, enabled);
  assert.equal(enabled.code, 200);
  assert.equal(calls.writes.find(call => call[0] === 'project')[2].$set.activityMappingEnabled, true);
});
test('unapproved project clients cannot receive task links', async t => {
  const calls = setup(t, { clients: [] }); const res = response();
  await saveActivityLinks({ body: input(), user }, res);
  assert.equal(res.code, 400); assert.equal(calls.writes.length, 0);
});
test('unlinking retains mapping IDs and soft-disables instead of deleting', async t => {
  const calls = setup(t); const res = response();
  await saveActivityLinks({ body: input({ action: 'unlink' }), user }, res);
  assert.equal(res.code, 200);
  assert.equal(calls.writes.find(call => call[0] === 'unlink')[2].$set.isActive, false);
});
test('removing clients atomically disables their mappings without rewriting time entries', async t => {
  const calls = setup(t); const res = response();
  t.mock.method(Client, 'find', () => query([]));
  await saveActivityLinks({ body: input({ action: 'clients', clientIds: [] }), user }, res);
  assert.equal(res.code, 200);
  assert.equal(calls.writes.find(call => call[0] === 'unlink')[2].$set.isActive, false);
  const update = calls.writes.find(call => call[0] === 'project')[2];
  assert.deepEqual(update.$set.clients, []); assert.equal(update.$set.client, null);
});
