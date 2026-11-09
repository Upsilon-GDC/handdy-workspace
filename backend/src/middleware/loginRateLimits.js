const { createRateLimit } = require('./rateLimit');

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LIMITS = Object.freeze({ ip: 100, account: 20, pair: 10 });
const emailIdentity = req => ['email', typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''];
const credentialIdentity = req => ['remembered', typeof req.body?.rememberedSessionToken === 'string' ? req.body.rememberedSessionToken : ''];

function createLoginRateLimits({ maxKeys = 10_000 } = {}) {
  const budget = (max, keyGenerator) => createRateLimit({
    windowMs: LOGIN_WINDOW_MS, max, maxKeys, keyGenerator, sharedAcrossRoutes: true,
    message: 'Too many login attempts. Please try again later.',
  });
  // Shared IP budget is first: rotating emails/credentials cannot allocate
  // unlimited downstream buckets. Endpoint paths never form these keys.
  const ip = budget(LOGIN_LIMITS.ip, req => req.ip);
  const layers = identity => [
    ip,
    budget(LOGIN_LIMITS.account, identity),
    budget(LOGIN_LIMITS.pair, req => [req.ip, identity(req)]),
  ];
  return { password: layers(emailIdentity), quickLogin: layers(credentialIdentity) };
}

module.exports = { createLoginRateLimits, LOGIN_LIMITS, LOGIN_WINDOW_MS };
