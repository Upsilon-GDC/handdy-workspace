const net = require("net");
const tls = require("tls");
const mongoose = require("mongoose");

// Phase 0 traffic measurement (docs/CRM_OPTIMIZATION_PHASE_PLAN.md). Off unless
// METRICS_ENABLED=true. It only counts: route templates, status classes, byte
// totals, MongoDB command names and collections, and connection totals per
// outside destination. It never records request bodies, query values, tokens,
// passwords or employee data.
//
// What each number means:
// - routes[].responseBytes: response body bytes as sent (after gzip), without
//   headers. Comparable to Render's "HTTP responses" once headers are added
//   (see destinations "http-clients").
// - destinations: bytes our process sent and received on each outbound
//   connection (plaintext above TLS; for MongoDB this is the compressed wire
//   protocol), plus connections opened. Each new TLS connection also costs a
//   handshake that is not in these bytes. Comparable to Render's
//   "service-initiated" traffic.
// - db[]: MongoDB commands by name and collection with approximate BSON sizes
//   before compression, to explain the "mongodb" destination total.
const LOG_INTERVAL_MS = 10 * 60 * 1000;
const TOP = 15;

// Unusual patterns in one 10-minute window, logged as "[alert] …" lines that
// Render's log search (or a log stream with alerting) can watch for.
const ALERTS = [
  { id: "server-errors", limit: 20, read: (w) => sumStatus(w, "5xx"), text: (n) => `${n} server errors (5xx)` },
  { id: "timers-closed", limit: 10, read: (w) => w.events.get("sweep.closed") || 0, text: (n) => `${n} desktop timers closed for missed heartbeats (connection or app problems)` },
  { id: "mongo-reconnects", limit: 20, read: (w) => w.events.get("mongo.connection.created") || 0, text: (n) => `${n} new MongoDB connections (reconnect storm?)` },
  { id: "mongo-monitor-failed", limit: 0, read: (w) => w.events.get("mongo.monitor.heartbeat.failed") || 0, text: (n) => `${n} failed MongoDB monitoring checks` },
  { id: "sweep-failed", limit: 0, read: (w) => w.events.get("sweep.failed") || 0, text: (n) => `${n} failed stale-timer sweeps` },
  { id: "long-poll-storm", limit: 0, read: (w) => fastLongPolls(w), text: (n) => `${n} "another device" long-polls averaging under 5 s (clients polling in a loop?)` },
];
const BYTES_ALERT = Number(process.env.METRICS_ALERT_MB_PER_WINDOW || 50) * 1_000_000;
const LONG_POLL_ROUTE = "GET /api/auth/login-requests/pending";

const sumStatus = (bucket, statusClass) => [...bucket.routes.values()]
  .reduce((sum, entry) => sum + (entry.status[statusClass] || 0), 0);

// A long-poll normally waits about 20 s. Hundreds per window that come back
// quickly mean clients re-poll without waiting (for example after an error).
function fastLongPolls(bucket) {
  const entry = bucket.routes.get(LONG_POLL_ROUTE);
  if (!entry || entry.count < 300) return 0;
  return entry.durationMs / entry.count < 5000 ? entry.count : 0;
}

const enabled = process.env.METRICS_ENABLED === "true";
const startedAt = new Date();

const newBucket = () => ({ startedAt: new Date(), routes: new Map(), db: new Map(), events: new Map() });
let totals = newBucket();
let window = newBucket();

const add = (map, key, create, update) => {
  if (!map.has(key)) map.set(key, create());
  update(map.get(key));
};

function recordRequest({ route, status, requestBytes = 0, responseBytes = 0, durationMs = 0 }) {
  const statusClass = status === 304 ? "304" : `${Math.floor(status / 100)}xx`;
  for (const bucket of [totals, window]) {
    add(bucket.routes, route, () => ({ count: 0, status: {}, requestBytes: 0, responseBytes: 0, durationMs: 0, maxDurationMs: 0 }), (entry) => {
      entry.count += 1;
      entry.status[statusClass] = (entry.status[statusClass] || 0) + 1;
      entry.requestBytes += requestBytes;
      entry.responseBytes += responseBytes;
      entry.durationMs += durationMs;
      entry.maxDurationMs = Math.max(entry.maxDurationMs, durationMs);
    });
  }
}

function recordDbCommand(key, { sentBytes = 0, replyBytes = 0, failed = false, started = false }) {
  for (const bucket of [totals, window]) {
    add(bucket.db, key, () => ({ count: 0, sentBytes: 0, replyBytes: 0, failed: 0 }), (entry) => {
      if (started) entry.count += 1;
      entry.sentBytes += sentBytes;
      entry.replyBytes += replyBytes;
      if (failed) entry.failed += 1;
    });
  }
}

function countEvent(name, amount = 1) {
  if (!enabled) return;
  for (const bucket of [totals, window]) bucket.events.set(name, (bucket.events.get(name) || 0) + amount);
}

// ---------------------------------------------------------------- HTTP
const chunkBytes = (chunk, encoding) => {
  if (!chunk || typeof chunk === "function") return 0;
  if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) return chunk.length;
  if (typeof chunk === "string") return Buffer.byteLength(chunk, typeof encoding === "string" ? encoding : "utf8");
  return 0;
};

function routeLabel(req) {
  if (req.route?.path) {
    const path = `${req.baseUrl || ""}${req.route.path}`;
    return path === "/{*splat}" ? `${req.method} dashboard page` : `${req.method} ${path}`;
  }
  const url = req.originalUrl || req.url || "";
  if (url.startsWith("/api")) return `${req.method} /api (no route)`;
  if (url.startsWith("/assets/")) return `${req.method} dashboard /assets/*`;
  return `${req.method} dashboard file`;
}

// Install before compression(), so the counted body bytes are the gzip bytes.
function requestMetrics(req, res, next) {
  const started = process.hrtime.bigint();
  let bytes = 0;
  const write = res.write;
  const end = res.end;
  res.write = function meteredWrite(chunk, encoding, callback) {
    bytes += chunkBytes(chunk, encoding);
    return write.call(this, chunk, encoding, callback);
  };
  res.end = function meteredEnd(chunk, encoding, callback) {
    bytes += chunkBytes(chunk, encoding);
    return end.call(this, chunk, encoding, callback);
  };
  res.once("finish", () => {
    recordRequest({
      route: routeLabel(req),
      status: res.statusCode,
      requestBytes: Number(req.headers["content-length"]) || 0,
      responseBytes: bytes,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    });
  });
  next();
}

// ------------------------------------------------------- destinations
const liveSockets = new Map();
const closedTotals = new Map();
let lastLoggedDestinations = new Map();

function destinationLabel(host = "", port = "") {
  const name = String(host || "").toLowerCase();
  if (name.endsWith(".mongodb.net")) return "mongodb-atlas";
  if (Number(port) === 465 || Number(port) === 587 || Number(port) === 25) return `smtp ${name}`;
  return `${name || "unknown"}:${port || "?"}`;
}

function trackSocket(socket, label) {
  if (!socket || liveSockets.has(socket)) return socket;
  liveSockets.set(socket, label);
  add(closedTotals, label, () => ({ connections: 0, sentBytes: 0, receivedBytes: 0 }), (entry) => { entry.connections += 1; });
  socket.once("close", () => {
    const entry = closedTotals.get(label);
    entry.sentBytes += socket.bytesWritten || 0;
    entry.receivedBytes += socket.bytesRead || 0;
    liveSockets.delete(socket);
  });
  return socket;
}

function destinationTotals() {
  const result = new Map([...closedTotals].map(([label, entry]) => [label, { ...entry }]));
  for (const [socket, label] of liveSockets) {
    const entry = result.get(label);
    entry.sentBytes += socket.bytesWritten || 0;
    entry.receivedBytes += socket.bytesRead || 0;
  }
  return result;
}

const original = { tlsConnect: tls.connect, netConnect: net.connect, netCreateConnection: net.createConnection };
let meterInstalled = false;

const connectArgs = (args) => {
  if (args[0] && typeof args[0] === "object") return { host: args[0].host || args[0].servername, port: args[0].port, socket: args[0].socket };
  return { host: typeof args[1] === "string" ? args[1] : "localhost", port: args[0] };
};

// Counts every outgoing connection the process opens (MongoDB, SMTP, …).
function installOutboundMeter() {
  if (meterInstalled) return;
  meterInstalled = true;
  tls.connect = function meteredTlsConnect(...args) {
    const socket = original.tlsConnect.apply(this, args);
    const { host, port, socket: wrapped } = connectArgs(args);
    // A TLS upgrade of an already-counted socket (SMTP STARTTLS) is not new traffic.
    return wrapped ? socket : trackSocket(socket, destinationLabel(host, port));
  };
  const wrapNet = (connect) => function meteredNetConnect(...args) {
    const socket = connect.apply(this, args);
    const { host, port } = connectArgs(args);
    return trackSocket(socket, destinationLabel(host, port));
  };
  net.connect = wrapNet(original.netConnect);
  net.createConnection = wrapNet(original.netCreateConnection);
}

function uninstallOutboundMeter() {
  tls.connect = original.tlsConnect;
  net.connect = original.netConnect;
  net.createConnection = original.netCreateConnection;
  meterInstalled = false;
}

// Bytes on connections from Render's proxy to this app: response headers and
// bodies, i.e. what Render reports as "HTTP responses" before its own TLS.
function meterHttpServer(server) {
  server.on("connection", (socket) => trackSocket(socket, "http-clients"));
}

// ------------------------------------------------------------- MongoDB
const pendingCommands = new Map();
const bsonSize = (document) => {
  try {
    return document ? mongoose.mongo.BSON.calculateObjectSize(document) : 0;
  } catch {
    return 0;
  }
};

function commandKey(event) {
  const target = event.command?.[event.commandName];
  const collection = typeof target === "string" ? target : event.command?.collection || "";
  return collection ? `${event.commandName} ${collection}` : event.commandName;
}

// Needs the connection opened with monitorCommands: true (config/db.js).
function attachMongo(client) {
  if (!client) return;
  client.on("commandStarted", (event) => {
    const key = commandKey(event);
    if (pendingCommands.size < 10_000) pendingCommands.set(event.requestId, key);
    recordDbCommand(key, { started: true, sentBytes: bsonSize(event.command) });
  });
  client.on("commandSucceeded", (event) => {
    const key = pendingCommands.get(event.requestId) || event.commandName;
    pendingCommands.delete(event.requestId);
    recordDbCommand(key, { replyBytes: bsonSize(event.reply) });
  });
  client.on("commandFailed", (event) => {
    const key = pendingCommands.get(event.requestId) || event.commandName;
    pendingCommands.delete(event.requestId);
    recordDbCommand(key, { failed: true });
  });
  client.on("connectionCreated", () => countEvent("mongo.connection.created"));
  client.on("connectionClosed", () => countEvent("mongo.connection.closed"));
  client.on("serverHeartbeatSucceeded", () => countEvent("mongo.monitor.heartbeat"));
  client.on("serverHeartbeatFailed", () => countEvent("mongo.monitor.heartbeat.failed"));
}

// ------------------------------------------------------------- reports
const sortedTop = (map, field, limit) => [...map]
  .map(([key, entry]) => ({ key, ...entry }))
  .sort((a, b) => b[field] - a[field])
  .slice(0, limit);

function describeBucket(bucket, limit) {
  return {
    startedAt: bucket.startedAt,
    routes: sortedTop(bucket.routes, "responseBytes", limit).map(({ durationMs, ...entry }) => ({
      ...entry,
      avgMs: entry.count ? Math.round(durationMs / entry.count) : 0,
      maxDurationMs: Math.round(entry.maxDurationMs),
    })),
    db: sortedTop(bucket.db, "count", limit),
    events: Object.fromEntries(bucket.events),
  };
}

function snapshot({ limit = 50 } = {}) {
  return {
    enabled,
    since: startedAt,
    uptimeMinutes: Math.round((Date.now() - startedAt.getTime()) / 60000),
    destinations: Object.fromEntries(destinationTotals()),
    total: describeBucket(totals, limit),
    currentWindow: describeBucket(window, limit),
  };
}

// One log line per window so Render's logs keep a usage history.
function logWindow() {
  const current = destinationTotals();
  const destinations = {};
  for (const [label, entry] of current) {
    const before = lastLoggedDestinations.get(label) || { connections: 0, sentBytes: 0, receivedBytes: 0 };
    destinations[label] = {
      connections: entry.connections - before.connections,
      sentBytes: entry.sentBytes - before.sentBytes,
      receivedBytes: entry.receivedBytes - before.receivedBytes,
    };
  }
  lastLoggedDestinations = current;
  console.log(`[metrics] ${JSON.stringify({ windowMinutes: Math.round((Date.now() - window.startedAt.getTime()) / 60000), destinations, ...describeBucket(window, TOP) })}`);
  for (const alert of windowAlerts(window, destinations)) console.warn(`[alert] ${alert}`);
  window = newBucket();
}

function windowAlerts(bucket, destinations = {}) {
  const alerts = [];
  for (const rule of ALERTS) {
    const value = rule.read(bucket);
    if (value > rule.limit) alerts.push(rule.text(value));
  }
  for (const [label, entry] of Object.entries(destinations)) {
    const bytes = entry.sentBytes + entry.receivedBytes;
    if (bytes > BYTES_ALERT) alerts.push(`${Math.round(bytes / 1_000_000)} MB to/from ${label} in one window`);
  }
  return alerts;
}

function startPeriodicLog(intervalMs = LOG_INTERVAL_MS) {
  if (!enabled) return null;
  const timer = setInterval(logWindow, intervalMs);
  timer.unref();
  return timer;
}

function resetForTests() {
  totals = newBucket();
  window = newBucket();
  liveSockets.clear();
  closedTotals.clear();
  pendingCommands.clear();
  lastLoggedDestinations = new Map();
}

module.exports = {
  enabled,
  attachMongo,
  countEvent,
  installOutboundMeter,
  logWindow,
  meterHttpServer,
  recordRequest,
  requestMetrics,
  resetForTests,
  snapshot,
  startPeriodicLog,
  uninstallOutboundMeter,
  windowAlerts,
};
