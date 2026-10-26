// Phase 4: the backend is grouped into business modules (src/modules). Loading
// every module here catches a broken path that no other test touches, and the
// URL list must stay exactly as the desktop app and dashboard expect.
const test = require("node:test");
const assert = require("node:assert/strict");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { apiModules } = require("../src/modules");
const { startTimerSweep, SWEEP_INTERVAL_MS } = require("../src/jobs/timerSweep");

test("every module loads and keeps its URL", () => {
  assert.deepEqual(apiModules.map(([prefix]) => prefix), [
    "/api/auth", "/api/employees", "/api/attendance", "/api/projects", "/api/tasks", "/api/time-logs",
    "/api/shifts", "/api/schedules", "/api/teams", "/api/clients", "/api/billing", "/api/settings",
    "/api/permissions", "/api/metrics",
  ]);
  for (const [prefix, router] of apiModules) {
    assert.equal(typeof router, "function", prefix);
    assert.ok(router.stack.length > 0, `${prefix} has routes`);
  }
});

test("the timer sweep job runs once at startup and then every 30 seconds", async (t) => {
  const sweeps = t.mock.method(TaskTimeLog, "find", () => ({ lean: async () => [] }));
  const timer = await startTimerSweep();
  t.after(() => clearInterval(timer));
  assert.equal(sweeps.mock.callCount(), 1, "timers left open while the server was down are closed at once");
  assert.equal(SWEEP_INTERVAL_MS, 30_000);
  assert.equal(timer.hasRef(), false, "does not keep the process alive on its own");
});
