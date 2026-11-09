import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay, waitForRetry, monitorLoginRequests } from '../src/utils/backgroundRetry.js';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('approval retry delays grow to 30 seconds', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 20].map(retryDelay), [2000, 4000, 8000, 16000, 30000, 30000]);
});

test('retry waits finish on abort, including an already aborted signal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const waiting = waitForRetry(30000, controller.signal);
  controller.abort(); await waiting;
  await waitForRetry(30000, controller.signal);
});

test('web outage retries back off, reset on success, and stop after an approval arrives', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let calls = 0; const shown = [];
  const monitor = monitorLoginRequests({ signal: controller.signal, hidden: () => false, onRequest: row => shown.push(row), read: async () => {
    calls++;
    if ([1, 2, 4].includes(calls)) throw new Error('offline');
    return calls === 5 ? { loginRequest: { requestId: 'request' } } : {};
  } });
  await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(1999); await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 2);
  t.mock.timers.tick(4000); await flush(); assert.equal(calls, 3);
  t.mock.timers.tick(1000); await flush(); assert.equal(calls, 4);
  t.mock.timers.tick(2000); await monitor;
  assert.equal(calls, 5); assert.equal(shown[0].requestId, 'request');
});

test('hidden web polls retain their cadence, cancellation and authorization failures stop polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let calls = 0;
  const monitor = monitorLoginRequests({ signal: controller.signal, hidden: () => true, onRequest: () => assert.fail(), read: async () => { calls++; return {}; } });
  await flush(); t.mock.timers.tick(14999); await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 2);
  controller.abort(); await monitor;
  for (const status of [401, 403]) {
    let rejected = 0;
    await monitorLoginRequests({ signal: new AbortController().signal, hidden: () => false, onRequest: () => assert.fail(), read: async () => { rejected++; throw { response: { status } }; } });
    assert.equal(rejected, 1);
  }
});
