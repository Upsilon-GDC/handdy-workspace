// Phase 5: health check, alert lines and token signing method.
process.env.METRICS_ENABLED = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { healthCheck } = require("../src/monitoring/health");
const metrics = require("../src/monitoring/trafficMetrics");
const { startTimerSweep } = require("../src/jobs/timerSweep");
const generateToken = require("../src/utils/generateToken");
const { protect } = require("../src/middleware/authMiddleware");

const response = () => ({
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const withReadyState = (t, state) => {
  const previous = mongoose.connection._readyState;
  mongoose.connection._readyState = state;
  t.after(() => { mongoose.connection._readyState = previous; });
};
const withEnv = (t, name, value) => {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
};

test("/health is 200 with the database and 503 without it, unless switched off", (t) => {
  withReadyState(t, 1);
  const up = response();
  healthCheck({}, up);
  assert.equal(up.statusCode, 200);
  assert.equal(up.body.database, "connected");
  mongoose.connection._readyState = 0;
  const down = response();
  healthCheck({}, down);
  assert.equal(down.statusCode, 503);
  assert.deepEqual(Object.keys(down.body).sort(), ["database", "message", "success"], "nothing else, no secrets");
  withEnv(t, "HEALTH_CHECK_DATABASE", "false");
  const legacy = response();
  healthCheck({}, legacy);
  assert.equal(legacy.statusCode, 200);
});

test("alert rules: server errors, mass timer closures, reconnects, sweep failures and traffic spikes", (t) => {
  metrics.resetForTests();
  const warnings = [];
  t.mock.method(console, "warn", (line) => warnings.push(line));
  t.mock.method(console, "log", () => {});
  for (let i = 0; i < 2; i += 1) metrics.recordRequest({ route: "GET /api/time-logs/admin", status: 500 });
  metrics.countEvent("sweep.closed", 2);
  metrics.logWindow();
  assert.deepEqual(warnings, [], "a few errors or closures are normal");

  for (let i = 0; i < 21; i += 1) metrics.recordRequest({ route: "GET /api/time-logs/admin", status: 500 });
  metrics.countEvent("sweep.closed", 11);
  metrics.countEvent("mongo.connection.created", 25);
  metrics.countEvent("sweep.failed", 1);
  metrics.logWindow();
  assert.equal(warnings.length, 4);
  assert.ok(warnings.every((line) => line.startsWith("[alert] ")));
  assert.match(warnings.join("\n"), /21 server errors/);
  assert.match(warnings.join("\n"), /11 desktop timers closed/);
  assert.match(warnings.join("\n"), /25 new MongoDB connections/);
  assert.match(warnings.join("\n"), /failed stale-timer sweeps/);

  const spike = metrics.windowAlerts({ routes: new Map(), events: new Map() }, { "mongodb-atlas": { sentBytes: 40_000_000, receivedBytes: 20_000_000 } });
  assert.deepEqual(spike, ["60 MB to/from mongodb-atlas in one window"]);
});

test("alert when long-polls stop waiting (clients polling in a loop)", (t) => {
  metrics.resetForTests();
  const warnings = [];
  t.mock.method(console, "warn", (line) => warnings.push(line));
  t.mock.method(console, "log", () => {});
  const route = "GET /api/auth/login-requests/pending";
  for (let i = 0; i < 400; i += 1) metrics.recordRequest({ route, status: 200, durationMs: 20_000 });
  metrics.logWindow();
  assert.deepEqual(warnings, [], "many clients waiting the normal 20 s is fine");

  for (let i = 0; i < 400; i += 1) metrics.recordRequest({ route, status: 200, durationMs: 40 });
  metrics.logWindow();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /400 "another device" long-polls averaging under 5 s/);
});

test("the sweep job alerts once after three failures in a row and recovers", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const warnings = [];
  const logger = { error() {}, warn: (line) => warnings.push(line) };
  let fail = false;
  const timer = await startTimerSweep({ logger, sweep: async () => { if (fail) throw new Error("db down"); } });
  t.after(() => clearInterval(timer));
  fail = true;
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 4; i += 1) { t.mock.timers.tick(30_000); await settle(); }
  assert.equal(warnings.length, 1, "one alert, not one per failure");
  assert.match(warnings[0], /failed 3 times in a row/);
  fail = false;
  t.mock.timers.tick(30_000); await settle();
  fail = true;
  for (let i = 0; i < 3; i += 1) { t.mock.timers.tick(30_000); await settle(); }
  assert.equal(warnings.length, 2, "alerts again after a recovery and three new failures");
});

test("tokens are issued with HS256 and tokens signed any other way are refused", async (t) => {
  withEnv(t, "JWT_SECRET", "operations-test-secret-0123456789abcdef");
  const token = generateToken("employee", 0, { sessionId: "session", deviceId: "device" });
  assert.equal(jwt.decode(token, { complete: true }).header.alg, "HS256");
  const forged = jwt.sign({ employeeId: "employee", tokenVersion: 0, sessionId: "session", deviceId: "device" }, process.env.JWT_SECRET, { algorithm: "HS512" });
  const res = response();
  await protect({ headers: { authorization: `Bearer ${forged}` } }, res, () => assert.fail("HS512 token accepted"));
  assert.equal(res.statusCode, 401);
});
