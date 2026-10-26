const test = require("node:test");
const assert = require("node:assert/strict");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { heartbeatTimer, getAllTimeLogs } = require("../src/modules/timers/taskTimeLogController");
const { HEARTBEAT_TIMEOUT_MS } = require("../src/services/desktopTimerLease");

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const withEnv = (t, name, value) => {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
};
const isSweep = (filter) => Boolean(filter?.desktopHeartbeatAt?.$lte);

test("1.4 a live heartbeat is one conditional update that never extends an expired lease", async (t) => {
  const sweeps = t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
  let filter;
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (query, update, options) => {
    filter = query;
    assert.ok(update.$set.desktopHeartbeatAt instanceof Date);
    assert.deepEqual(options.projection, { _id: 1 });
    return { _id: "timer" };
  });
  const before = Date.now();
  const res = response();
  await heartbeatTimer({ user: { _id: "employee" } }, res);
  assert.deepEqual(res.body, { success: true, timeLogId: "timer" }, "same acknowledgement as before");
  assert.equal(sweeps.mock.callCount(), 0, "no separate stale-timer query");
  const cutoff = filter.desktopHeartbeatAt.$gt.getTime();
  assert.ok(cutoff >= before - HEARTBEAT_TIMEOUT_MS && cutoff <= Date.now() - HEARTBEAT_TIMEOUT_MS, "only leases younger than 90 s");
  assert.equal(filter.desktopHeartbeatAt.$type, "date");
  assert.equal(filter.isActiveTimer, true);
});

test("1.4 an expired lease is closed by the sweep and the desktop is told it is gone", async (t) => {
  const stale = { _id: "stale", employee: "employee", status: "running", isActiveTimer: true,
    startedAt: new Date(Date.now() - 600_000), desktopHeartbeatAt: new Date(Date.now() - 120_000), pauses: [] };
  t.mock.method(TaskTimeLog, "find", (query) => ({ lean: async () => (isSweep(query) ? [stale] : []) }));
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async () => null);
  let closedAt;
  t.mock.method(TaskTimeLog, "updateOne", async (_query, update) => { closedAt = update.$set.stoppedAt; return { modifiedCount: 1 }; });
  t.mock.method(console, "warn", () => {});
  const res = response();
  await heartbeatTimer({ user: { _id: "employee" } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(closedAt.getTime(), stale.desktopHeartbeatAt.getTime(), "closed at its last heartbeat");
});

test("1.4 with OPT_HEARTBEAT_SINGLE_WRITE=false the previous query + update runs", async (t) => {
  withEnv(t, "OPT_HEARTBEAT_SINGLE_WRITE", "false");
  const sweeps = t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
  t.mock.method(TaskTimeLog, "findOneAndUpdate", async (query) => {
    assert.equal(query.desktopHeartbeatAt.$gt, undefined);
    return { _id: "timer" };
  });
  const res = response();
  await heartbeatTimer({ user: { _id: "employee" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sweeps.mock.callCount(), 1);
});

test("1.5 reports skip their own stale-timer sweep by default and run it when switched off", async (t) => {
  let sweeps = 0;
  t.mock.method(TaskTimeLog, "find", (query) => {
    if (isSweep(query)) { sweeps += 1; return { lean: async () => [] }; }
    return { populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] };
  });
  t.mock.method(TaskTimeLog, "countDocuments", async () => 0);
  const run = async () => {
    const res = response();
    await getAllTimeLogs({ query: { startDate: "2026-10-01", endDate: "2026-10-01" }, user: { _id: "admin", role: "admin" } }, res);
    assert.equal(res.statusCode, 200);
  };
  await run();
  assert.equal(sweeps, 0, "default: rely on the 30 s background sweep (D1)");
  withEnv(t, "OPT_REPORTS_SKIP_SWEEP", "false");
  await run();
  assert.equal(sweeps, 1);
});
