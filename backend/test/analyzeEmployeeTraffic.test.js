const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeEmployeeTraffic, renderEmployeeReport } = require('../src/monitoring/analyzeEmployeeTraffic');
const row = (extra = {}) => ({ employeeId: '10054', employeeName: 'Sample employee', client: 'desktop', appVersion: '2.0.12',
  from: '2026-11-13T10:00:00Z', to: '2026-11-13T10:10:00Z', requests: 100, responseBodyBytes: 100000, ...extra });
const log = value => `time instance [employee-traffic] ${JSON.stringify(value)}`;

test('comparison groups the same employee by version and normalizes unequal logging durations', () => {
  const old = row({ appVersion: '2.0.6', requests: 200, responseBodyBytes: 200000 });
  const newer = row({ from: '2026-11-13T11:00:00Z', to: '2026-11-13T11:20:00Z' });
  const report = analyzeEmployeeTraffic([`${log(old)}\n${log(newer)}`]);
  assert.equal(report.rows.length, 2);
  const a = report.rows.find(row => row.appVersion === '2.0.6'), b = report.rows.find(row => row.appVersion === '2.0.12');
  assert.equal(a.requestsPerMinute, 20); assert.equal(b.requestsPerMinute, 5);
  assert.equal(a.responseBodyMB, 0.2); assert.equal(b.responseBodyMB, 0.1);
  assert.equal(b.responseMBPerMinute, 0.005);
  assert.match(renderEmployeeReport(report), /not employee work time/);
});

test('duplicate exports do not inflate counts and conflicting or overlapping intervals are rejected', () => {
  const value = log(row());
  const result = analyzeEmployeeTraffic([value, value]);
  assert.equal(result.duplicatesSkipped, 1); assert.equal(result.rows[0].requests, 100);
  assert.throws(() => analyzeEmployeeTraffic([value, log(row({ requests: 101 }))]), /Conflicting/);
  assert.throws(() => analyzeEmployeeTraffic([value, log(row({ from: '2026-11-13T10:05:00Z', to: '2026-11-13T10:15:00Z' }))]), /Overlapping/);
});

test('unknown versions, other employees and web traffic stay separate; legacy rounded inputs are labelled', () => {
  const rounded = row({ appVersion: 'unknown', responseBodyBytes: undefined, responseBodyMB: 0.1234 });
  const report = analyzeEmployeeTraffic([log(rounded), log(row({ employeeId: '10030' })), log(row({ client: 'web', appVersion: 'web' }))]);
  assert.equal(report.rows.length, 3); assert.equal(report.roundedInputs, 1);
  assert.equal(report.rows.find(row => row.appVersion === 'unknown').responseBodyBytes, 123400);
});

test('older aggregate logs cannot be reconstructed as employee measurements; malformed records are reported', () => {
  assert.throws(() => analyzeEmployeeTraffic(['[metrics] {"routes":[]}']), /older \[metrics\] logs cannot/);
  const report = analyzeEmployeeTraffic(['[employee-traffic] null\n[employee-traffic] {bad', log(row({ requests: -1 })), log(row())]);
  assert.equal(report.malformedSkipped, 3); assert.equal(report.measurements, 1);
  assert.match(renderEmployeeReport({ ...report, rows: [row({ employeeName: '<script>|name', measuredMinutes: 10, windows: 1,
    responseBodyMB: 0.1, requestsPerMinute: 10, responseMBPerMinute: 0.01, averageResponseKB: 1 })] }), /&lt;script&gt; name/);
});
