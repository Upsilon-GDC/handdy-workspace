process.env.METRICS_ENABLED = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const compression = require('compression');
const metrics = require('../src/monitoring/trafficMetrics');
const { requestEmployee } = require('../src/monitoring/employeeTraffic');
const metricsRoutes = require('../src/monitoring/metricsRoutes');
test.beforeEach(() => metrics.resetForTests());
const context = (id, version, clientType = 'desktop') => ({ method: 'POST', originalUrl: '/api/time-logs/heartbeat',
  headers: {}, body: { appVersion: version, token: 'secret', employeeName: 'Spoofed' },
  user: { _id: id, employeeId: `EMP-${id}`, fullName: `Employee ${id}`, email: 'private@example.invalid' },
  authSession: { _id: `session-${id}`, employee: id, clientType } });

test('employee/version cohorts remain separate and unauthenticated identity claims are ignored', () => {
  const row = requestEmployee(context('one', '2.0.12'));
  metrics.recordRequest({ route: 'GET /api/time-logs/history', status: 200, responseBytes: 2000, employee: row });
  metrics.recordRequest({ route: 'GET /api/projects/', status: 200, responseBytes: 1000, employee: requestEmployee(context('two', '2.0.6')) });
  metrics.recordRequest({ route: 'GET /api/projects/', status: 200, responseBytes: 3000, employee: requestEmployee(context('one', '2.0.13')) });
  metrics.recordRequest({ route: 'GET dashboard file', status: 200, responseBytes: 20 });
  const invalid = context('three', '2.0.12'); invalid.authSession.employee = 'different';
  assert.equal(requestEmployee(invalid), null);
  assert.equal(requestEmployee({ ...context('three', '2.0.12'), authSession: null }), null);
  const report = metrics.snapshot().employeesSinceStartup;
  assert.equal(report.attributedRequests, 3); assert.equal(report.unattributedRequests, 1);
  assert.equal(report.rows.length, 3);
  assert.deepEqual(report.rows.map(row => row.appVersion), ['2.0.13', '2.0.12', '2.0.6']);
  assert.equal(report.rows[0].responseBodyMB, 0.003);
  assert.equal(report.rows[0].averageResponseKB, 3);
  assert.equal(JSON.stringify(report).includes('private@example.invalid'), false);
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(JSON.stringify(report).includes('Spoofed'), false);
});

test('version discovery uses existing desktop user-agent/heartbeat and leaves unreported versions unknown', () => {
  const req = context('one', undefined); req.method = 'GET'; req.originalUrl = '/api/auth/me';
  assert.equal(requestEmployee(req).appVersion, 'unknown');
  req.headers['user-agent'] = 'Mozilla/5.0 CRM/2.0.6 Electron/38.0.0';
  assert.equal(requestEmployee(req).appVersion, '2.0.6');
  delete req.headers['user-agent'];
  assert.equal(requestEmployee(req).appVersion, '2.0.6');
  const heartbeat = context('one', '2.0.12');
  assert.equal(requestEmployee(heartbeat).appVersion, '2.0.12');
  assert.equal(requestEmployee(req).appVersion, '2.0.12');
  req.authSession = { ...req.authSession, _id: 'new-session' };
  assert.equal(requestEmployee(req).appVersion, 'unknown', 'Version cannot leak from a previous session');
  assert.equal(requestEmployee(context('one', 'bad-version')).appVersion, '2.0.12');
  assert.equal(requestEmployee(context('one', '2.0.12', 'web')).appVersion, 'web');
});

test('named employee metrics are returned only to actual administrators', () => {
  metrics.recordRequest({ route: 'GET /api/auth/me', status: 200, employee: requestEmployee(context('one', '2.0.12')) });
  const handler = metricsRoutes.stack.find(layer => layer.route?.path === '/').route.stack.at(-1).handle;
  for (const role of ['admin', 'alpha', 'manager']) {
    const res = { status() { return this; }, json(body) { this.body = body; return this; } };
    handler({ user: { role } }, res);
    assert.equal(!!res.body.metrics.employeesSinceStartup, role !== 'manager');
    assert.ok(res.body.metrics.total, 'Existing aggregate metrics remain available');
  }
});

test('real compressed response bytes are attributed and employee log windows do not double-count', async t => {
  const app = express(); app.use(metrics.requestMetrics); app.use(compression());
  app.get('/api/items/:id', (req, res) => {
    Object.assign(req, { user: context('one').user, authSession: context('one').authSession });
    res.json({ rows: Array(500).fill('sample payload') });
  });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => server.close());
  const bytes = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port,
    path: '/api/items/private-id', headers: { 'accept-encoding': 'gzip', 'user-agent': 'CRM/2.0.12' } }, res => {
      let size = 0; res.on('data', value => { size += value.length; }); res.on('end', () => resolve(size));
    }).on('error', reject));
  await new Promise(resolve => setImmediate(resolve));
  const logs = []; t.mock.method(console, 'log', line => logs.push(line)); metrics.logWindow();
  const line = logs.find(line => line.startsWith('[employee-traffic] '));
  assert.ok(line); const row = JSON.parse(line.slice('[employee-traffic] '.length));
  assert.equal(row.employeeName, 'Employee one'); assert.equal(row.appVersion, '2.0.12');
  assert.equal(row.responseBodyMB, Number((bytes / 1_000_000).toFixed(4)));
  assert.equal(row.topRoutes[0].route, 'GET /api/items/:id');
  assert.equal(line.includes('private-id'), false);
  assert.equal(metrics.snapshot().employeesCurrentWindow.rows.length, 0);
  assert.equal(metrics.snapshot().employeesSinceStartup.rows[0].requests, 1);
  metrics.logWindow();
  assert.equal(logs.filter(line => line.startsWith('[employee-traffic] ')).length, 1);
});
