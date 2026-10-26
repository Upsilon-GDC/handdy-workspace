const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installGracefulShutdown } = require("../src/services/gracefulShutdown");

const quietLogger = { log() {}, warn() {}, error() {} };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("SIGTERM waits for open requests, stops background jobs, then closes MongoDB and exits", async () => {
  const processRef = new EventEmitter();
  const order = [];
  let finishOpenRequests;
  const server = { close(callback) { order.push("close"); finishOpenRequests = callback; }, closeIdleConnections() { order.push("idle"); } };
  const interval = setInterval(() => assert.fail("background job kept running"), 5);
  const exits = [];
  installGracefulShutdown({
    server,
    intervals: [interval, null],
    beforeExit: async () => order.push("final metrics"),
    disconnect: async () => order.push("mongo closed"),
    processRef,
    exit: (code) => exits.push(code),
    logger: quietLogger,
  });
  processRef.emit("SIGTERM");
  processRef.emit("SIGTERM");
  await flush();
  assert.deepEqual(order, ["close", "idle"], "nothing closes while requests are still open");
  assert.deepEqual(exits, []);
  finishOpenRequests();
  await flush();
  assert.deepEqual(order, ["close", "idle", "final metrics", "mongo closed"]);
  assert.deepEqual(exits, [0], "exits once");
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("requests that never finish are cut off after the time limit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const processRef = new EventEmitter();
  const exits = [];
  installGracefulShutdown({
    server: { close() {} },
    processRef,
    timeoutMs: 25_000,
    exit: (code) => exits.push(code),
    logger: quietLogger,
  });
  processRef.emit("SIGINT");
  t.mock.timers.tick(24_999);
  assert.deepEqual(exits, []);
  t.mock.timers.tick(1);
  assert.deepEqual(exits, [0]);
});
