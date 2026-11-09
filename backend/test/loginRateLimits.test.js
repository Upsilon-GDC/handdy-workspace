const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimit } = require('../src/middleware/rateLimit');
const { createLoginRateLimits, LOGIN_WINDOW_MS, LOGIN_LIMITS } = require('../src/middleware/loginRateLimits');
const authRoutes = require('../src/modules/auth/authRoutes');

const request = (extra = {}) => ({ ip: '192.0.2.1', baseUrl: '/api/auth', path: '/login', body: { email: 'person@example.invalid' }, ...extra });
function attempt(layers, req = request()) {
  const res = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let allowed = true;
  for (const layer of layers) {
    let advanced = false;
    layer(req, res, () => { advanced = true; });
    if (!advanced) { allowed = false; break; }
  }
  return { allowed, res };
}

test('mounted login routes share an IP budget across rotating emails, tokens and trailing slashes', () => {
  const handlers = path => authRoutes.stack.find(layer => layer.route?.path === path).route.stack.slice(0, -1).map(layer => layer.handle);
  let accepted = 0;
  for (let i = 0; i < 150; i++) {
    const quick = i % 2 === 0;
    const path = quick ? '/quick-login' : '/login';
    const result = attempt(handlers(path), request({ ip: '192.0.2.200', path: path + (i % 3 ? '' : '/'),
      body: quick ? { rememberedSessionToken: `synthetic-token-${i}`, email: `ignored-${i}@example.invalid` } : { email: `spray-${i}@example.invalid` } }));
    if (result.allowed) accepted++;
    else {
      assert.equal(result.res.statusCode, 429);
      assert.ok(Number(result.res.headers['Retry-After']) > 0);
    }
  }
  assert.equal(accepted, LOGIN_LIMITS.ip);
});

test('changing IPs and email casing cannot bypass the normalized account budget', () => {
  const limits = createLoginRateLimits();
  for (let i = 0; i < LOGIN_LIMITS.account; i++) {
    assert.equal(attempt(limits.password, request({ ip: `198.51.100.${i}`, body: { email: i % 2 ? ' PERSON@example.invalid ' : 'person@EXAMPLE.invalid' } })).allowed, true);
  }
  const denied = attempt(limits.password, request({ ip: '203.0.113.99' }));
  assert.equal(denied.res.statusCode, 429);
  assert.equal(attempt(limits.password, request({ body: { email: 'another@example.invalid' } })).allowed, true);
});

test('remembered credentials have a cross-IP budget independent of any supplied email', () => {
  const limits = createLoginRateLimits();
  for (let i = 0; i <= LOGIN_LIMITS.account; i++) {
    const result = attempt(limits.quickLogin, request({ ip: `198.51.100.${i}`, path: '/quick-login',
      body: { rememberedSessionToken: 'synthetic-remembered-secret', email: `spoofed-${i}@example.invalid` } }));
    assert.equal(result.allowed, i < LOGIN_LIMITS.account);
  }
});

test('the original IP/account pair budget still applies without blocking other accounts', () => {
  const limits = createLoginRateLimits();
  for (let i = 0; i < LOGIN_LIMITS.pair; i++) assert.equal(attempt(limits.password).allowed, true);
  assert.equal(attempt(limits.password).res.statusCode, 429);
  assert.equal(attempt(limits.password, request({ body: { email: 'other@example.invalid' } })).allowed, true);
});

test('a shared office IP permits ordinary retries across fifteen employees', () => {
  const limits = createLoginRateLimits();
  for (let person = 0; person < 15; person++) {
    for (let retry = 0; retry < 3; retry++) {
      assert.equal(attempt(limits.password, request({ body: { email: `employee-${person}@example.invalid` } })).allowed, true);
    }
  }
});

test('fixed-window expiry restores access and blocked attempts do not extend lockout', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const limits = createLoginRateLimits();
  for (let i = 0; i < LOGIN_LIMITS.pair; i++) attempt(limits.password);
  assert.equal(attempt(limits.password).res.headers['Retry-After'], '900');
  t.mock.timers.tick(LOGIN_WINDOW_MS - 1);
  assert.equal(attempt(limits.password).res.headers['Retry-After'], '1');
  t.mock.timers.tick(1);
  assert.equal(attempt(limits.password).allowed, true);
});

test('full storage rejects new identities without evicting active budgets and recovers on expiry', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const limiter = createRateLimit({ windowMs: 10_000, max: 2, maxKeys: 2, message: 'Wait', keyGenerator: req => req.ip });
  const call = ip => attempt([limiter], request({ ip }));
  assert.equal(call('a').allowed, true);
  assert.equal(call('a').allowed, true);
  assert.equal(call('b').allowed, true);
  for (let i = 0; i < 100; i++) assert.equal(call(`rotating-${i}`).res.statusCode, 429);
  assert.equal(call('a').res.statusCode, 429, 'a live exhausted budget was not evicted');
  assert.equal(call('b').allowed, true, 'existing identities can still use their remaining budget');
  assert.equal(call('b').res.statusCode, 429);
  t.mock.timers.tick(10_000);
  assert.equal(call('new-after-expiry').allowed, true);
});

test('generic limiter stores are isolated and preserve route-specific reset/registration budgets', () => {
  const options = { windowMs: 60_000, max: 1, message: 'Wait' };
  const reset = createRateLimit(options);
  const registration = createRateLimit(options);
  assert.equal(attempt([reset], request({ path: '/forgot-password' })).allowed, true);
  assert.equal(attempt([reset], request({ path: '/forgot-password' })).res.statusCode, 429);
  assert.equal(attempt([reset], request({ path: '/reset-password' })).allowed, true);
  assert.equal(attempt([registration], request({ path: '/forgot-password' })).allowed, true);
});

test('malformed identity fields are handled without throwing and still consume the IP budget', () => {
  const limits = createLoginRateLimits();
  for (const body of [undefined, null, {}, { email: {} }, { rememberedSessionToken: {} }]) {
    assert.doesNotThrow(() => attempt(limits.password, request({ body })));
    assert.doesNotThrow(() => attempt(limits.quickLogin, request({ body })));
  }
});
