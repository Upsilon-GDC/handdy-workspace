const { dependencyRevision, digest } = require("../services/readRevisions");
const { getEffectivePermissionsSync } = require("../services/permissionService");
const entries = new Map();
const MAX_ENTRIES = 64;
const MAX_BYTES = 8 * 1024 * 1024;
// A client may keep reusing an unchanged list for at most this long before it
// must download a fresh copy, even if no revision change was detected.
const ETAG_WINDOW_MS = 5 * 60_000;
let bytes = 0;

function remove(key) {
  bytes -= entries.get(key)?.bytes || 0;
  entries.delete(key);
}

// Must run AFTER authentication/authorization. Private results stay scoped.
function catalogCache(models, { shared = false } = {}) {
  return async (req, res, next) => {
    try {
      const references = await dependencyRevision(models);
      const key = digest([req.baseUrl, req.path, req.query,
        shared ? null : String(req.user._id), req.user.role, String(req.user.team || ""),
        // Effective permissions: some lists widen with a duty (every project for
        // "Create/edit projects"), so a change of grants must change the key.
        String(req.user.teamLead || ""), [...getEffectivePermissionsSync(req.user)].sort(), references]);
      // The key already encodes the caller's scope and every dependency's
      // revision, so an identical key means an identical list. Answering
      // "304 Not Modified" skips the body entirely.
      const etag = `"${key}-${Math.floor(Date.now() / ETAG_WINDOW_MS)}"`;
      const cacheHeaders = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Authorization" };
      if (req.headers?.["if-none-match"] === etag) {
        res.set(cacheHeaders);
        return res.status(304).end();
      }
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        res.set(cacheHeaders);
        return res.status(200).json(JSON.parse(hit.body));
      }
      if (hit) remove(key);
      const json = res.json;
      res.json = function (body) {
        if (res.statusCode === 200 && body?.success === true) {
          res.set(cacheHeaders);
          const serialized = JSON.stringify(body);
          const size = Buffer.byteLength(serialized);
          if (size <= MAX_BYTES) {
            remove(key);
            while (entries.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) remove(entries.keys().next().value);
            entries.set(key, { body: serialized, bytes: size, expiresAt: Date.now() + 60_000 });
            bytes += size;
          }
        }
        return json.call(this, body);
      };
      next();
    } catch {
      // Cache/revision failure must never prevent normal application loading.
      next();
    }
  };
}

module.exports = catalogCache;
