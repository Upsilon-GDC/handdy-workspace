const crypto = require('node:crypto');

// Each limiter owns a bounded store. Fixed windows are inserted in expiry
// order, so expired entries can be removed without scanning live buckets.
const createRateLimit = ({ windowMs, max, message, keyGenerator = req => req.ip,
  sharedAcrossRoutes = false, maxKeys = 10_000 }) => {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(max) || max <= 0
    || !Number.isSafeInteger(maxKeys) || maxKeys <= 0) throw new Error('Invalid rate-limit configuration.');
  const buckets = new Map();
  let lastNow = 0;
  return (req, res, next) => {
    // Keep insertion/expiry order even if the wall clock moves backwards.
    const now = lastNow = Math.max(lastNow, Date.now());
    while (buckets.size) {
      const [oldestKey, oldest] = buckets.entries().next().value;
      if (oldest.resetAt > now) break;
      buckets.delete(oldestKey);
    }
    const identity = keyGenerator(req);
    // Fixed-size hashes avoid retaining emails, remembered secrets, or
    // attacker-controlled long strings in the in-memory keys.
    const key = crypto.createHash('sha256').update(JSON.stringify([
      identity, ...(sharedAcrossRoutes ? [] : [req.baseUrl, req.path]),
    ])).digest('hex');
    const reject = resetAt => {
      res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
      return res.status(429).json({ success: false, message });
    };
    const current = buckets.get(key);
    if (current) {
      current.count = Math.min(current.count + 1, max + 1);
      if (current.count > max) return reject(current.resetAt);
      return next();
    }
    // Do not evict a live budget: rotating identities must not reset limits.
    if (buckets.size >= maxKeys) return reject(buckets.values().next().value.resetAt);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  };
};

module.exports = { createRateLimit };
