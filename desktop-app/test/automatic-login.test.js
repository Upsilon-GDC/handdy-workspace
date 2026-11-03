const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness({ status = 200, outage = false, pending = false } = {}) {
  const nodes = new Map(), calls = [], navigation = [];
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }; };
  const localStorage = storage(), sessionStorage = storage();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', hidden: false, style: {}, dataset: {}, listeners: {}, classList: { add() {}, remove() {} }, addEventListener(name, callback) { this.listeners[name] = callback; } });
    return nodes.get(id);
  };
  const context = vm.createContext({ console: { debug() {}, error() {}, warn() {}, log() {} }, Date, Intl, AbortSignal, localStorage, sessionStorage,
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    document: { body: { dataset: { page: 'login' } }, getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    window: { electronAPI: {}, location: { replace: url => navigation.push(url) }, addEventListener() {} },
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body || '{}') });
      if (outage) throw new Error('offline');
      if (pending && url.endsWith('/auth/quick-login')) return { ok: false, status: 409, json: async () => ({ code: 'DEVICE_APPROVAL_REQUIRED', loginRequest: { requestId: 'request', requestToken: 'secret', activeDevice: { deviceName: 'Other PC' } } }) };
      if (pending && url.includes('/wait')) return { ok: false, status: 403, json: async () => ({ message: 'Request denied.' }) };
      return { ok: status === 200, status, json: async () => status === 200 ? { token: 'new-access', rememberedSessionToken: 'rotated-remembered', user: { _id: 'employee', fullName: 'Employee' } } : { message: 'Not permitted' } };
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '../renderer.js'), 'utf8').replace(/\ninitializeApp\(\);\s*$/, '');
  vm.runInContext(source, context);
  node('loginForm').elements = { email: node('email'), password: node('password') };
  return { context, calls, navigation, nodes, localStorage, sessionStorage };
}
const remember = h => { h.localStorage.setItem('rememberedSessionToken', 'remembered'); h.localStorage.setItem('rememberedUser', JSON.stringify({ fullName: 'Employee' })); };
test('saved account signs in automatically once and rotates the remembered credential', async () => {
  const h = harness(); remember(h);
  await h.context.initializeApp();
  assert.equal(h.calls.length, 1); assert.ok(h.calls[0].url.endsWith('/auth/quick-login'));
  assert.equal(Object.hasOwn(h.calls[0].body, 'password'), false);
  assert.equal(h.localStorage.getItem('rememberedSessionToken'), 'rotated-remembered');
  assert.deepEqual(h.navigation, ['./dashboard.html']);
});
test('first launch without saved credentials stays at the email/password form', async () => {
  const h = harness(); await h.context.initializeApp();
  assert.equal(h.calls.length, 0); assert.equal(h.navigation.length, 0);
});
test('manual sign-out pause and session-revocation messages prevent automatic reauthentication', async () => {
  for (const kind of ['manual', 'revoked', 'idle']) {
    const h = harness(); remember(h);
    if (kind === 'manual') h.localStorage.setItem('desktopAutoLoginPaused', 'true');
    else h.sessionStorage.setItem(kind === 'idle' ? 'inactivityLogout' : 'sessionEndedMessage', 'Session ended');
    await h.context.initializeApp(); assert.equal(h.calls.length, 0); assert.equal(h.navigation.length, 0);
  }
});
test('expired or disabled remembered accounts fall back to credential entry', async () => {
  for (const status of [401, 403]) {
    const h = harness({ status }); remember(h); await h.context.initializeApp();
    assert.equal(h.localStorage.getItem('rememberedSessionToken'), null);
    assert.equal(h.nodes.get('loginForm').hidden, false); assert.equal(h.navigation.length, 0);
  }
});
test('network/server failure preserves remembered credentials and never loops', async () => {
  for (const options of [{ outage: true }, { status: 503 }]) {
    const h = harness(options); remember(h); await h.context.initializeApp();
    assert.equal(h.calls.length, 1); assert.equal(h.localStorage.getItem('rememberedSessionToken'), 'remembered');
    assert.equal(h.navigation.length, 0); assert.ok(!h.nodes.get('message').textContent.includes('expired'));
  }
});
test('automatic login still waits for device approval and cannot bypass denial', async () => {
  const h = harness({ pending: true }); remember(h); await h.context.initializeApp();
  assert.equal(h.navigation.length, 0); assert.equal(h.localStorage.getItem('token'), null);
  assert.ok(h.calls.some(call => call.url.includes('/wait')));
});
