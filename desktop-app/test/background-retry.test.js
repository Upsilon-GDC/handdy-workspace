const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function fixture(responses) {
  const delays = [], shown = [], revoked = [];
  let calls = 0;
  const context = vm.createContext({
    AbortController, AbortSignal, API_BASE_URL: 'https://test.invalid/api',
    deviceApprovalMonitorActive: false, deviceApprovalAbortController: null,
    isLoginPage: false, logoutPending: false, getToken: () => 'test-token',
    showDeviceLoginRequest: request => shown.push(request),
    endRevokedDeviceSession: message => revoked.push(message),
    fetch: async () => {
      const row = responses[calls++];
      assert.ok(row, 'unexpected extra request');
      if (row instanceof Error) throw row;
      return { ok: row.status === 200, status: row.status, json: async () => row.body || {} };
    },
    waitForRetry: async ms => delays.push(ms),
  });
  vm.runInContext(section('function retryDelay(', '// Resolves on cancellation'), context);
  vm.runInContext(section('async function monitorDeviceLoginRequests()', 'async function decideDeviceLogin('), context);
  return { context, delays, shown, revoked, calls: () => calls };
}

test('desktop approval failures back off, cap at 30 seconds, and reset after a healthy poll', async () => {
  const h = fixture([
    ...Array.from({ length: 6 }, () => ({ status: 503 })),
    { status: 200 }, new TypeError('offline'),
    { status: 200, body: { loginRequest: { requestId: 'new-device' } } },
  ]);
  await h.context.monitorDeviceLoginRequests();
  assert.deepEqual(h.delays, [2000, 4000, 8000, 16000, 30000, 30000, 1000, 2000]);
  assert.equal(h.shown[0].requestId, 'new-device');
});

test('desktop healthy approval polls keep checking while minimized and revocation stops retries', async () => {
  for (const status of [401, 403]) {
    const h = fixture([{ status: 200 }, { status, body: { message: 'Revoked' } }]);
    h.context.document = { visibilityState: 'hidden' };
    await h.context.monitorDeviceLoginRequests();
    assert.equal(h.calls(), 2);
    assert.deepEqual(h.delays, [1000]);
    assert.deepEqual(h.revoked, ['Revoked']);
  }
});

test('desktop logout cancels the retry wait without another pending request', async () => {
  const h = fixture([{ status: 500 }]);
  h.context.waitForRetry = async () => h.context.deviceApprovalAbortController.abort();
  await h.context.monitorDeviceLoginRequests();
  assert.equal(h.calls(), 1);
});

test('desktop retry sleep clears its timer when aborted', async () => {
  let callback, cleared = 0;
  const context = vm.createContext({ setTimeout: fn => { callback = fn; return 42; }, clearTimeout: id => { assert.equal(id, 42); cleared++; } });
  vm.runInContext(section('function waitForRetry(', 'const showTimerView'), context);
  const controller = new AbortController();
  const pending = context.waitForRetry(30000, controller.signal);
  controller.abort(); await pending;
  assert.equal(cleared, 1);
  assert.equal(typeof callback, 'function');
});
