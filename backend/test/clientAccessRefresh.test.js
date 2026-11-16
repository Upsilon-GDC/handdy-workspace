const test = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../src/models/ClientAccessPolicy');
const { replacePolicies, rememberPolicy, refreshClientAccessIfStale, workProjectIds } = require('../src/services/clientAccess');
const person = { _id: 'person', team: 'software' };
const row = (projects, version = 1) => ({ subjectType: 'employee', subjectId: 'person', version, workProjects: projects });

test('another server removing extra projects is observed within 30 seconds, sharing concurrent refresh reads', async t => {
  let time = 100_000;
  t.mock.method(Date, 'now', () => time);
  replacePolicies([row(['audit', 'bookkeeping'])]);
  t.after(() => replacePolicies([]));
  let reads = 0;
  t.mock.method(Policy, 'find', () => { reads += 1; return { lean: async () => [row([], 2)] }; });
  await refreshClientAccessIfStale();
  assert.deepEqual(workProjectIds(person), ['audit', 'bookkeeping']);
  assert.equal(reads, 0);
  time += 30_001;
  await Promise.all(Array.from({ length: 10 }, () => refreshClientAccessIfStale()));
  assert.equal(reads, 1);
  assert.deepEqual(workProjectIds(person), []);
  await refreshClientAccessIfStale();
  assert.equal(reads, 1);
});

test('an old database refresh cannot overwrite a concurrent newer local save', async t => {
  let time = 100_000;
  t.mock.method(Date, 'now', () => time);
  replacePolicies([row(['audit']), { ...row(['audit']), subjectId: 'other' }]);
  t.after(() => replacePolicies([]));
  time += 30_001;
  let release, reads = 0;
  t.mock.method(Policy, 'find', () => ({ lean: () => ++reads === 1 ? new Promise(resolve => { release = resolve; })
    : Promise.resolve([row([], 3), { ...row([], 2), subjectId: 'other' }]) }));
  const pending = refreshClientAccessIfStale();
  await Promise.resolve();
  rememberPolicy(row([], 3));
  release([row(['audit'], 2), { ...row(['audit']), subjectId: 'other' }]);
  await pending;
  assert.deepEqual(workProjectIds(person), []);
  assert.deepEqual(workProjectIds({ _id: 'other' }), [], 'The request must also see another employee\'s revoked grant');
  assert.equal(reads, 2);
});

test('repeated concurrent saves cannot cause an expired grant snapshot to be served', async t => {
  let time = 100_000, version = 1, reads = 0;
  t.mock.method(Date, 'now', () => time);
  replacePolicies([row(['audit'])]);
  t.after(() => replacePolicies([]));
  time += 30_001;
  const mock = t.mock.method(Policy, 'find', () => ({ lean: async () => {
    reads += 1; rememberPolicy(row([], ++version)); return [row(['audit'])];
  } }));
  await assert.rejects(refreshClientAccessIfStale(), /changed repeatedly/);
  assert.equal(reads, 3);
  mock.mock.restore();
  t.mock.method(Policy, 'find', () => ({ lean: async () => [row([], version)] }));
  await refreshClientAccessIfStale();
  assert.deepEqual(workProjectIds(person), []);
});

test('expired snapshot refresh failure rejects access and can be retried', async t => {
  let time = 100_000;
  t.mock.method(Date, 'now', () => time);
  replacePolicies([row(['audit'])]);
  t.after(() => replacePolicies([]));
  time += 30_001;
  let fail = true;
  t.mock.method(Policy, 'find', () => ({ lean: async () => {
    if (fail) throw new Error('database unavailable');
    return [row([], 2)];
  } }));
  await assert.rejects(refreshClientAccessIfStale(), /database unavailable/);
  fail = false;
  await refreshClientAccessIfStale();
  assert.deepEqual(workProjectIds(person), []);
});
