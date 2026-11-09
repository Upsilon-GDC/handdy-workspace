const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeTraffic, renderReport } = require('../src/monitoring/analyzeTraffic');
const window = (startedAt, count = 10) => ({ startedAt, windowMinutes: 10,
  routes: [{ key: 'GET /api/auth/me', count, responseBytes: 1000, requestBytes: 20, avgMs: 10, status: { '2xx': count - 1, '5xx': 1 } }],
  db: [{ key: 'find employees', count: 3, sentBytes: 200, replyBytes: 9000, failed: 1 }],
  destinations: { 'mongodb-atlas': { connections: 1, sentBytes: 400, receivedBytes: 12000 }, 'http-clients': { connections: 2, sentBytes: 1500, receivedBytes: 500 } },
  events: { 'mongo.connection.created': 1, 'sweep.closed': 2 } });
const first = () => window('2026-11-06T04:00:00.000Z');
const log = data => `2026-11-06T04:10:00Z instance [metrics] ${JSON.stringify(data)}`;

test('aggregates separate log windows, ranks routes, and skips duplicate exports', () => {
  const a = first(), b = window('2026-11-06T04:10:00.000Z', 30);
  b.routes[0].avgMs = 30;
  b.routes.push({ key: 'POST /api/time-logs/heartbeat', count: 100, responseBytes: 500, status: { '2xx': 100 }, avgMs: 5 });
  const report = analyzeTraffic([log(a), `${log(a)}\n${log(b)}`]);
  assert.equal(report.measurements, 2); assert.equal(report.duplicatesSkipped, 1);
  assert.equal(report.routesByBytes[0].key, 'GET /api/auth/me');
  assert.equal(report.routesByBytes[0].avgMs, 25, 'average is weighted by requests');
  assert.equal(report.routesByRequests[0].key, 'POST /api/time-logs/heartbeat');
  assert.equal(report.totals.observedRequests, 140); assert.equal(report.totals.observed5xx, 2);
  assert.equal(report.dbByCommands[0].count, 6); assert.equal(report.events['sweep.closed'], 4);
});
test('outbound totals exclude HTTP-client sockets and incoming database replies', () => {
  const report = analyzeTraffic([log(first())], { employeeHours: 160 });
  assert.equal(report.totals.externalSentBytes, 400);
  assert.equal(report.totals.externalReceivedBytes, 12000);
  assert.equal(report.externalSentMBPerEmployeeHour, 400 / 1_000_000 / 160);
  assert.match(renderReport(report), /Reply MB \(inbound\)/);
});
test('one snapshot counts cumulative totals once and excludes its current window', () => {
  const data = first();
  const snapshot = { success: true, metrics: { since: data.startedAt, total: data, currentWindow: { ...data, routes: [{ ...data.routes[0], count: 1000 }] }, destinations: data.destinations } };
  const report = analyzeTraffic([JSON.stringify(snapshot, null, 2)]);
  assert.equal(report.kind, 'snapshot'); assert.equal(report.totals.observedRequests, 10);
});
test('rejects combinations that can double-count cumulative traffic', () => {
  const data = first(), snapshot = { metrics: { total: data, since: data.startedAt, destinations: data.destinations } };
  assert.throws(() => analyzeTraffic([JSON.stringify(snapshot), log(data)]), /double-count/);
  assert.throws(() => analyzeTraffic([log(data), log({ ...data, routes: [] })]), /same start time/);
});
test('startup messages and truncated lines cannot silently become a zero-usage baseline', () => {
  assert.throws(() => analyzeTraffic(['[metrics] Traffic metrics are on.\n[metrics] {"startedAt":']), /No usable measurements/);
  const report = analyzeTraffic([`[metrics] Traffic metrics are on.\n[metrics] {bad JSON\n${log(first())}`]);
  assert.equal(report.malformedSkipped, 1); assert.equal(report.informationalSkipped, 1);
  assert.equal(report.warnings.length, 1);
  assert.match(renderReport(report), /observed lower bounds/);
});
test('malformed counters never inject NaN or negative traffic into the report', () => {
  const data = first(); data.routes.push(null, { key: 'GET /bad', count: -1, responseBytes: 'secret-value', avgMs: Infinity });
  const report = analyzeTraffic([log(data)]);
  assert.equal(report.totals.observedRequests, 10); assert.equal(report.totals.observedResponseBytes, 1000);
  assert.doesNotMatch(renderReport(report), /secret-value|NaN/);
  assert.throws(() => analyzeTraffic([log(data)], { employeeHours: 0 }), /positive/);
});
