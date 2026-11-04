const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hoursToSeconds, policyOnDate, productiveSeconds, buildWorkingHoursOverview, validDate } = require('../src/services/workingHours');
const routes = require('../src/modules/settings/workingHoursRoutes');
const day = '2026-11-03', start = Date.parse(`${day}T00:00:00Z`), end = start + 86400000;
const log = (from, to, extra = {}) => ({ employee: 'a', startedAt: new Date(start + from * 3600000), stoppedAt: new Date(start + to * 3600000), status: 'stopped', task: { taskType: 'work' }, ...extra });
const person = key => ({ _id: key, fullName: key, isActive: true, role: 'employee', team: { _id: 'team', teamName: 'Tax' } });
const policy = (employee, hours = 8) => ({ employee, revisions: [{ effectiveFrom: day, requiredSeconds: hoursToSeconds(hours), halfDayPercent: 50 }] });
function overview(overrides = {}) {
  return buildWorkingHoursOverview({ date: day, start, end, now: end, employees: [person('a')], policies: [policy('a')], attendance: [{ employee: 'a', status: 'Present' }], logs: [], ...overrides });
}
test('decimal hours use exact seconds and reject ambiguous, negative or oversized values', () => {
  for (const [value, seconds] of [['7.5', 27000], ['7.8', 28080], [8.5, 30600], ['7.83', 28188], [0, 0], [24, 86400]]) assert.equal(hoursToSeconds(value), seconds);
  for (const value of ['', null, [], true, '7:48', '8.000', '1e1', -1, 24.01, NaN, Infinity]) assert.throws(() => hoursToSeconds(value));
  assert.throws(() => validDate('2026-02-30')); assert.throws(() => validDate({}));
  assert.equal(validDate(day), day);
});
test('effective dated revisions preserve earlier requirements and choose the last same-day revision', () => {
  const data = { revisions: [{ effectiveFrom: '2026-11-01', requiredSeconds: 28800 }, { effectiveFrom: '2026-11-05', requiredSeconds: 27000 }, { effectiveFrom: '2026-11-03', requiredSeconds: 28080 }, { effectiveFrom: '2026-11-03', requiredSeconds: 30000 }] };
  assert.equal(policyOnDate(data, '2026-10-31'), null);
  assert.equal(policyOnDate(data, '2026-11-02').requiredSeconds, 28800);
  assert.equal(policyOnDate(data, day).requiredSeconds, 30000);
  assert.equal(policyOnDate(data, '2026-11-06').requiredSeconds, 27000);
});
test('five present employees require 40 hours, complete 27, and have 13 pending at 67.5%', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const result = overview({ employees: keys.map(person), policies: keys.map(key => policy(key)), attendance: keys.map(employee => ({ employee, status: 'Present' })), logs: keys.map((employee, index) => log(0, [8, 6, 5, 4, 4][index], { employee })) });
  assert.equal(result.totals.presentCount, 5); assert.equal(result.totals.requiredSeconds, 40 * 3600);
  assert.equal(result.totals.completedSeconds, 27 * 3600); assert.equal(result.totals.pendingSeconds, 13 * 3600);
  assert.equal(result.totals.completionPercent, 67.5);
});
test('individual targets, absent employees, unconfigured staff and Alpha never inflate target totals', () => {
  const result = overview({ employees: [person('a'), person('b'), person('c'), person('d'), { ...person('alpha'), role: 'alpha' }], policies: [policy('a', 7.8), policy('b', 7.5)], attendance: ['a', 'c', 'alpha'].map(employee => ({ employee, status: 'Present' })), logs: [log(0, 5), log(0, 8, { employee: 'b' }), log(0, 3, { employee: 'c' })] });
  assert.equal(result.totals.requiredSeconds, 28080); assert.equal(result.totals.completedSeconds, 18000);
  assert.equal(result.totals.presentCount, 2); assert.equal(result.totals.unconfiguredCount, 1);
  assert.equal(result.teams[0].members.length, 4); assert.equal(result.teams[0].members.find(row => row.employee === 'c').trackedSeconds, 10800);
});
test('exact requirements complete and overtime is retained with a capped progress indicator', () => {
  const exact = overview({ logs: [log(0, 8)] }).teams[0].members[0];
  assert.equal(exact.status, 'Completed'); assert.equal(exact.pendingSeconds, 0); assert.equal(exact.completionPercent, 100);
  const overtime = overview({ logs: [log(0, 10)] }).totals;
  assert.equal(overtime.completedSeconds, 36000); assert.equal(overtime.overtimeSeconds, 7200); assert.equal(overtime.completionPercent, 100);
});
test('approved leave excludes targets while configurable half-day fractions require actual presence', () => {
  const result = overview({ employees: [person('a'), person('b'), person('c')], policies: [policy('a'), { employee: 'b', revisions: [{ effectiveFrom: day, requiredSeconds: 28800, halfDayPercent: 60 }] }, policy('c')],
    attendance: [{ employee: 'a', status: 'Present', workingHoursAdjustments: [{ type: 'leave' }] }, { employee: 'b', status: 'Present', workingHoursAdjustments: [{ type: 'half_day' }] }, { employee: 'c', status: 'Absent', workingHoursAdjustments: [{ type: 'half_day' }] }], logs: [log(0, 8), log(0, 3, { employee: 'b' })] });
  assert.equal(result.totals.presentCount, 1); assert.equal(result.totals.requiredSeconds, 17280); assert.equal(result.totals.completedSeconds, 10800);
  assert.equal(result.teams[0].members[0].attendance, 'Approved leave');
});
test('overlaps and duplicate logs count once; overlapping breaks, idle pauses and deleted time are excluded', () => {
  const a = log(1, 5, { pauses: [{ pausedAt: new Date(start + 2 * 3600000), resumedAt: new Date(start + 3 * 3600000), reason: 'idle' }] });
  assert.equal(productiveSeconds([a, a, log(3, 6), log(4, 4.5, { task: { taskType: 'break' } }), log(6, 8, { manualEntry: { deletedAt: new Date() } })], start, end, end), 3.5 * 3600);
});
test('daily clipping, live refresh and expired desktop heartbeats use actual work intervals', () => {
  assert.equal(productiveSeconds([log(-2, 2)], start, end, end), 7200);
  const active = log(1, 2, { stoppedAt: null, status: 'running' });
  assert.equal(productiveSeconds([active], start, end, start + 3 * 3600000), 7200);
  assert.equal(productiveSeconds([active], start, end, start + 4 * 3600000), 10800);
  assert.equal(productiveSeconds([{ ...active, desktopHeartbeatAt: new Date(start + 2 * 3600000) }], start, end, start + 4 * 3600000), 3600);
});
test('new attendance changes target totals without changing time records', () => {
  assert.equal(overview().totals.requiredSeconds, 28800);
  assert.equal(overview({ attendance: [{ employee: 'a', status: 'Absent' }] }).totals.requiredSeconds, 0);
  assert.equal(overview({ attendance: [{ employee: 'a', status: 'Present', workingHoursAdjustments: [{ type: 'leave' }, { type: 'normal' }] }] }).totals.requiredSeconds, 28800);
});
test('working-hours configuration uses exact admin roles even though managers normally inherit admin', () => {
  for (const path of ['/settings', '/adjustments']) {
    for (const route of routes.stack.filter(layer => layer.route?.path === path)) {
      for (const role of ['employee', 'team_lead', 'hr', 'manager', 'admin', 'alpha']) {
        let passed = false, code;
        route.route.stack[0].handle({ user: { role } }, { status(value) { code = value; return this; }, json() {} }, () => { passed = true; });
        assert.equal(passed, ['admin', 'alpha'].includes(role)); if (!passed) assert.equal(code, 403);
      }
    }
  }
  const report = routes.stack.find(layer => layer.route?.path === '/overview').route;
  for (const role of ['employee', 'team_lead', 'hr', 'manager', 'admin', 'alpha']) {
    let passed = false;
    report.stack[0].handle({ user: { role } }, { status() { return this; }, json() {} }, () => { passed = true; });
    assert.equal(passed, ['admin', 'alpha', 'manager'].includes(role));
  }
});
