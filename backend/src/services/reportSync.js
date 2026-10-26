const { dependencyRevision, digest } = require("./readRevisions");
const { isOn } = require("../config/optimizations");

// Opt-in protocol: older apps continue receiving the original paginated JSON.
async function beginReportSync(req, filter, dependencies) {
  if (req.query.sync !== "true") return null;
  const since = new Date(); // Capture BEFORE reads, so concurrent writes are replayed.
  let references;
  try { references = await dependencyRevision(dependencies); } catch { return null; }
  const scope = digest([String(req.user._id), req.user.role, filter, process.env.APP_TIMEZONE || "Asia/Kolkata"]);
  const previous = new Date(req.query.syncSince);
  const delta = Number.isFinite(previous.getTime()) && previous <= since
    && since - previous < 5 * 60_000
    && req.query.syncScope === scope && req.query.syncReferences === references;
  return { marker: { since: since.toISOString(), scope, references }, delta, previous };
}

function changedTimeLogFilter(filter, previous) {
  // Include recently deleted manual entries in deltas so clients receive
  // their removedIds, while complete reports exclude the retained audit row.
  const { startedAt: _startedAt, $or: _overlap, status: _status, "manualEntry.deletedAt": _deletedAt, ...scope } = filter;
  return { ...scope, $or: [
    { updatedAt: { $gte: new Date(previous.getTime() - 1_000) } },
    { status: { $in: ["running", "paused"] } },
  ] };
}

function deltaRows(rows, transform = (row) => row) {
  const records = [];
  const removedIds = [];
  for (const row of rows) {
    const record = transform(row);
    if (record) records.push(record);
    else removedIds.push(String(row._id));
  }
  return { records, removedIds };
}

// Fingerprint of a complete report: how many rows it has and the sum of their
// last-change times in whole seconds. A client that merged deltas into its copy
// computes the same numbers (dashboard utils/reportLoader.js); if they match,
// nothing was missed and it can skip the periodic full reload.
// For time logs, active timers change at every heartbeat and every delta
// resends them, so they are listed by ID and left out of the sums. With a date
// range, zero-length sessions are left out because reports drop them
// (clipTimeLogToRange).
const wantsChecksum = (req) => req.query.checksum === "true" && isOn("reportChecksum");

async function reportChecksum(Model, filter, { timeLogs = false, dropZeroLength = false, now = new Date() } = {}) {
  const match = dropZeroLength
    ? { $and: [filter, { $expr: { $gt: [{ $ifNull: ["$stoppedAt", now] }, "$startedAt"] } }] }
    : filter;
  const active = { $eq: ["$isActiveTimer", true] };
  const groups = await Model.aggregate([
    { $match: match },
    { $group: {
      _id: timeLogs ? active : null,
      count: { $sum: 1 },
      seconds: { $sum: { $floor: { $divide: [{ $toLong: "$updatedAt" }, 1000] } } },
      ...(timeLogs ? { activeIds: { $push: { $cond: [active, "$_id", "$$REMOVE"] } } } : {}),
    } },
  ]);
  const settled = groups.find((group) => group._id !== true) || { count: 0, seconds: 0 };
  return {
    count: settled.count,
    seconds: settled.seconds,
    ...(timeLogs ? { activeIds: (groups.find((group) => group._id === true)?.activeIds || []).map(String) } : {}),
  };
}

module.exports = { beginReportSync, changedTimeLogFilter, deltaRows, reportChecksum, wantsChecksum };
