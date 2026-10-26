export function mergeReportRows(previous, changed, removedIds = [], sortField = "startedAt") {
  const records = new Map(previous.map((row) => [String(row._id), row]));
  for (const id of removedIds) records.delete(String(id));
  for (const row of changed) records.set(String(row._id), row);
  return [...records.values()].sort((a, b) =>
    (new Date(b[sortField] || 0) - new Date(a[sortField] || 0)) || String(b._id).localeCompare(String(a._id)));
}

// Fingerprint of a merged report copy; matches reportChecksum on the server
// (backend services/reportSync.js): row count and the sum of last-change
// times in whole seconds, leaving out active timers listed by the server.
export function reportChecksum(rows, activeIds = []) {
  const active = new Set(activeIds.map(String));
  let count = 0;
  let seconds = 0;
  for (const row of rows) {
    if (active.has(String(row._id))) continue;
    count += 1;
    const changedAt = Date.parse(row.updatedAt);
    if (Number.isFinite(changedAt)) seconds += Math.floor(changedAt / 1000);
  }
  return { count, seconds };
}

const sameChecksum = (local, remote) => local.count === remote.count && local.seconds === remote.seconds;

// A delta copy is trusted while a recent delta proved it complete (matching
// fingerprint). Without that proof it is fully reloaded after 5 minutes, as
// before; with it, at the latest after an hour.
const UNVERIFIED_RELOAD_MS = 5 * 60_000;
const FULL_RELOAD_MS = 60 * 60_000;

export function createReportLoader(fetchPage, getSessionKey = () => "") {
  const cache = new Map();
  const inFlight = new Map();
  async function load(path, collectionKey, params = {}, { force = true } = {}) {
    const session = getSessionKey();
    const key = JSON.stringify([session, path, collectionKey, params]);
    const pending = inFlight.get(key);
    if (pending) {
      if (!force) return pending;
      try { await pending; } catch { /* A manual refresh gets a fresh attempt. */ }
      return load(path, collectionKey, params, { force: true });
    }
    const previous = cache.get(key);
    const now = Date.now();
    const marker = !force && previous && now - previous.verifiedAt < UNVERIFIED_RELOAD_MS && now - previous.fullAt < FULL_RELOAD_MS
      ? previous.data.sync : null;
    const syncParams = marker ? { syncSince: marker.since, syncScope: marker.scope, syncReferences: marker.references } : {};
    const operation = (async () => {
      const first = await fetchPage(path, { ...params, ...syncParams, sync: "true", checksum: "true", page: 1, limit: 100 });
      let records;
      if (first.delta && previous && marker) {
        records = mergeReportRows(previous.data[collectionKey], first[collectionKey] || [], first.removedIds,
          collectionKey === "attendance" ? "date" : "startedAt");
      } else {
        records = [...(first[collectionKey] || [])];
        for (let page = 2; page <= Math.max(Number(first.totalPages) || 1, 1); page += 1) {
          const data = await fetchPage(path, { ...params, sync: "true", page, limit: 100 });
          records.push(...(data[collectionKey] || []));
        }
        records = [...new Map(records.map((row) => [String(row._id), row])).values()];
      }
      if (getSessionKey() !== session) throw new Error("The signed-in session changed during report loading.");
      const data = { ...(first.delta ? previous.data : first), ...first, delta: false,
        page: 1, count: records.length, totalRecords: records.length, [collectionKey]: records };
      if (first.sync && records.length <= 50_000) {
        const loadedAt = Date.now();
        const verified = !first.delta
          || (first.checksum && sameChecksum(reportChecksum(records, first.checksum.activeIds), first.checksum));
        cache.delete(key);
        while (cache.size >= 12) cache.delete(cache.keys().next().value);
        cache.set(key, {
          data,
          verifiedAt: verified ? loadedAt : previous.verifiedAt,
          fullAt: first.delta ? previous.fullAt : loadedAt,
        });
      } else cache.delete(key);
      return data;
    })();
    inFlight.set(key, operation);
    try { return await operation; } finally { if (inFlight.get(key) === operation) inFlight.delete(key); }
  }
  return load;
}
