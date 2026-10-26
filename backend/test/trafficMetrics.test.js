// Runs in its own process (node --test), so the switch is set before loading.
process.env.METRICS_ENABLED = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { EventEmitter } = require("node:events");
const express = require("express");
const compression = require("compression");
const metrics = require("../src/monitoring/trafficMetrics");
const metricsRoutes = require("../src/monitoring/metricsRoutes");

test.beforeEach(() => metrics.resetForTests());

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, "127.0.0.1", () => resolve(server));
});

const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
  }).on("error", reject);
});

// Lets res "finish" handlers run before reading the counters.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("requests are counted per route template with the gzip bytes actually sent", async (t) => {
  const app = express();
  app.use(metrics.requestMetrics);
  app.use(compression());
  const router = express.Router();
  const big = { rows: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Employee ${i}`, project: "Audit" })) };
  router.get("/items/:id", (req, res) => res.json(big));
  router.get("/same", (req, res) => res.status(304).end());
  app.use("/api/test", router);
  app.use("/api", (req, res) => res.status(404).json({ success: false }));
  app.use(express.static(__dirname, { index: false }));
  const server = await listen(app);
  t.after(() => server.close());
  const { port } = server.address();

  const first = await get(port, "/api/test/items/1", { "accept-encoding": "gzip" });
  await get(port, "/api/test/items/2", { "accept-encoding": "gzip", authorization: "Bearer secret-token-value" });
  await get(port, "/api/test/same");
  await get(port, "/api/missing");
  await settle();

  const { routes } = metrics.snapshot().total;
  const items = routes.find((route) => route.key === "GET /api/test/items/:id");
  assert.equal(items.count, 2, "both ids share one route template");
  assert.equal(items.status["2xx"], 2);
  assert.equal(first.headers["content-encoding"], "gzip");
  assert.ok(items.responseBytes > 0 && items.responseBytes < JSON.stringify(big).length, "counts compressed, not raw, bytes");
  assert.equal(items.responseBytes, first.body.length * 2);
  assert.equal(routes.find((route) => route.key === "GET /api/test/same").status["304"], 1);
  assert.ok(routes.some((route) => route.key === "GET /api (no route)"));
  assert.equal(JSON.stringify(metrics.snapshot()).includes("secret-token-value"), false, "never records headers or tokens");
});

test("MongoDB commands are counted by name and collection, with reply sizes", () => {
  const client = new EventEmitter();
  metrics.attachMongo(client);
  client.emit("commandStarted", { requestId: 1, commandName: "find", command: { find: "task_time_logs", filter: { employee: "x" } } });
  client.emit("commandSucceeded", { requestId: 1, commandName: "find", reply: { cursor: { firstBatch: [{ a: 1 }, { a: 2 }] } } });
  client.emit("commandStarted", { requestId: 2, commandName: "update", command: { update: "task_time_logs", updates: [{}] } });
  client.emit("commandFailed", { requestId: 2, commandName: "update" });
  client.emit("commandStarted", { requestId: 3, commandName: "getMore", command: { getMore: 5, collection: "employees" } });
  client.emit("connectionCreated", {});
  client.emit("serverHeartbeatSucceeded", {});

  const { db, events } = metrics.snapshot().total;
  const find = db.find((entry) => entry.key === "find task_time_logs");
  assert.equal(find.count, 1);
  assert.ok(find.sentBytes > 20 && find.replyBytes > 20);
  assert.equal(db.find((entry) => entry.key === "update task_time_logs").failed, 1);
  assert.ok(db.some((entry) => entry.key === "getMore employees"));
  assert.equal(events["mongo.connection.created"], 1);
  assert.equal(events["mongo.monitor.heartbeat"], 1);
  assert.equal(JSON.stringify(db).includes("filter"), false, "never records query values");
});

test("outgoing connections are totalled per destination, live and closed", async (t) => {
  const target = net.createServer((socket) => {
    socket.on("data", () => socket.end("pong-pong"));
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  t.after(() => target.close());
  metrics.installOutboundMeter();
  t.after(() => metrics.uninstallOutboundMeter());

  const { port } = target.address();
  await new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write("ping"));
    socket.on("close", resolve);
    socket.resume();
  });
  const destination = metrics.snapshot().destinations[`127.0.0.1:${port}`];
  assert.deepEqual(destination, { connections: 1, sentBytes: 4, receivedBytes: 9 });
});

test("the 10-minute log line covers the window and then starts a new one", async (t) => {
  metrics.recordRequest({ route: "POST /api/time-logs/heartbeat", status: 200, responseBytes: 120, durationMs: 4 });
  metrics.countEvent("longpoll.pending.check.desktop", 3);
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  metrics.logWindow();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[metrics\] /);
  const logged = JSON.parse(lines[0].slice("[metrics] ".length));
  assert.equal(logged.routes[0].key, "POST /api/time-logs/heartbeat");
  assert.equal(logged.events["longpoll.pending.check.desktop"], 3);
  const after = metrics.snapshot();
  assert.equal(after.currentWindow.routes.length, 0, "a new window starts empty");
  assert.equal(after.total.routes[0].count, 1, "totals since start are kept");
});

test("the metrics endpoint is admin-only", () => {
  const stack = metricsRoutes.stack.find((layer) => layer.route?.path === "/").route.stack;
  const gate = stack[1].handle;
  const deny = { status(code) { this.code = code; return this; }, json() { return this; } };
  gate({ user: { role: "hr" } }, deny, () => assert.fail("hr reached the metrics"));
  assert.equal(deny.code, 403);
  let allowed = false;
  gate({ user: { role: "admin" } }, deny, () => { allowed = true; });
  assert.equal(allowed, true);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  stack.at(-1).handle({ user: { role: "admin" } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.metrics.enabled, true);
});
