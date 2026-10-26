// Traffic fixes from docs/CRM_OPTIMIZATION_PHASE_PLAN.md (Phase 1). Each is on
// by default; setting its environment variable to "false" in Render turns it
// off again without a code change. Read on every use, so tests can flip them.
const FLAGS = {
  // 1.1 Long-polls wait for a change notification instead of re-reading
  // MongoDB every 5 s (one server instance, see render.yaml).
  longPollEvents: "OPT_LONGPOLL_EVENTS",
  // 1.4 A heartbeat extends a live lease in one conditional update; the
  // stale-timer sweep runs only when that update finds nothing.
  heartbeatSingleWrite: "OPT_HEARTBEAT_SINGLE_WRITE",
  // 1.5 Report and history reads rely on the 30 s background sweep instead of
  // running their own (decision D1, 2026-10-26).
  reportsSkipSweep: "OPT_REPORTS_SKIP_SWEEP",
  // 1.6 Hashed dashboard files are cached by browsers for a year.
  staticAssetCache: "OPT_STATIC_ASSET_CACHE",
  // 2.2 Report deltas carry a fingerprint of the complete report when the
  // client asks (checksum=true), so open reports skip the 5-minute full reload.
  reportChecksum: "OPT_REPORT_CHECKSUM",
};

const isOn = (name) => process.env[FLAGS[name]] !== "false";

module.exports = { FLAGS, isOn };
