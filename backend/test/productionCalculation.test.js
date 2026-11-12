const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateProduction, resolveWorkTeam } = require('../src/services/production/calculationEngine');
const day = '2026-11-10', tomorrow = '2026-11-11';
const at = (hour, date = day) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const employee = { _id: 'e1', fullName: 'First Employee', employeeId: '1001', role: 'employee', team: 'wcpa', projectRates: [{ project: 'p1', chargeRate: 25 }] };
const task = { _id: 'audit', teams: ['wcpa'], taskType: 'work' };
const project = { _id: 'p1', teams: ['wcpa'] };
let sequence = 0;
const revision = (kind, key, values, effectiveFrom = day, version = 1) => ({ _id: `rev-${++sequence}`, kind, key, values, effectiveFrom, version });
const config = (team = 'wcpa', enabled = true, effectiveFrom = day, currency = 'USD', version = 1) =>
  revision('team-billing', team, { billingEnabled: enabled, currency: enabled ? currency : null, approvalRequired: true }, effectiveFrom, version);
const classification = (taskId = 'audit', category = 'productive', billable = true, team = 'wcpa', date = day, version = 1) =>
  revision('classification', `${team}:task:${taskId}`, { category, billable }, date, version);
const rate = (amount = 25, team = 'wcpa', client = '*', person = '*', date = day, currency = 'USD', version = 1) =>
  revision('rate', `${team}:${client}:${person}`, { enabled: true, hourlyRateHundredths: amount * 100, currency }, date, version);
const log = (start = 9, stop = 10, overrides = {}) => ({ _id: `log-${++sequence}`, employee: 'e1', task: 'audit', project: 'p1', client: 'c1',
  status: 'stopped', startedAt: at(start), stoppedAt: at(stop), pauses: [], ...overrides });
const policy = (seconds = 28800) => ({ employee: 'e1', revisions: [{ effectiveFrom: day, requiredSeconds: seconds, halfDayPercent: 50 }] });
const present = (date = day, adjustments = []) => ({ employee: 'e1', date, status: 'Present', workingHoursAdjustments: adjustments });
function calc(overrides = {}) {
  return calculateProduction({ employees: [employee], tasks: [task], projects: [project], logs: [log()],
    settings: [config(), classification(), rate()], policies: [policy()], attendance: [present()],
    startDate: day, endDate: day, timezone: 'UTC', now: at(23, tomorrow), includeBilling: true, ...overrides });
}
test('example: 8 tracked hours gives 6 production hours, 1 training, 1 Break / Idle and $150', () => {
  const result = calc({ logs: [log(8, 14), log(14, 15, { task: 'training' }), log(15, 16, { task: 'break' })],
    tasks: [task, { _id: 'training', teams: ['wcpa'] }, { _id: 'break', taskType: 'break', teams: ['wcpa'] }],
    settings: [config(), classification(), classification('training', 'training', false), rate()] });
  assert.equal(result.totals.actualSeconds, 28800); assert.equal(result.totals.productionSeconds, 21600);
  assert.equal(result.totals.trainingSeconds, 3600); assert.equal(result.totals.breakIdleSeconds, 3600);
  assert.equal(result.totals.remainingSeconds, 7200); assert.equal(result.totals.achievementPercent, 75);
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 150);
});
test('disabled and absent team configurations produce hours with no monetary columns', () => {
  for (const settings of [[classification(), rate(), config('wcpa', false)], [classification(), rate()]]) {
    const result = calc({ settings });
    assert.equal(result.totals.productionSeconds, 3600); assert.equal(result.totals.eligibleClientWorkSeconds, 3600);
    assert.deepEqual(result.totals.billing, { applicable: false });
    assert.deepEqual(result.details[0].billing, { applicable: false });
  }
});
test('activation effective dates split billing without changing production hours', () => {
  const settings = [config('wcpa', false), config('wcpa', true, tomorrow, 'USD', 2), classification(), rate()];
  const result = calc({ startDate: day, endDate: tomorrow, logs: [log(23, 1, { stoppedAt: at(1, tomorrow) })], settings });
  assert.equal(result.totals.productionSeconds, 7200); assert.equal(result.totals.billing.billableSeconds, 3600);
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 25);
});
test('disabling billing preserves earlier estimated intervals', () => {
  const result = calc({ endDate: tomorrow, logs: [log(23, 1, { stoppedAt: at(1, tomorrow) })],
    settings: [config(), config('wcpa', false, tomorrow, 'USD', 2), classification(), rate()] });
  assert.equal(result.totals.billing.billableSeconds, 3600); assert.equal(result.totals.billing.estimates[0].estimatedAmount, 25);
});
test('training, excluded work and explicit breaks cannot produce billing', () => {
  for (const category of ['training', 'excluded', 'break-idle']) {
    const result = calc({ settings: [config(), classification('audit', category, false), rate()] });
    assert.equal(result.totals.productionSeconds, 0); assert.equal(result.totals.billing.billableSeconds, 0);
  }
  const result = calc({ tasks: [{ ...task, taskType: 'break' }] });
  assert.equal(result.totals.productionSeconds, 0); assert.equal(result.totals.breakIdleSeconds, 3600);
});
test('task names never activate billing or classify production', () => {
  const result = calc({ tasks: [{ ...task, taskName: 'Billable Billing Training' }], settings: [config(), rate()] });
  assert.equal(result.totals.productionSeconds, 0); assert.equal(result.totals.unclassifiedSeconds, 3600);
  assert.ok(result.warnings.some(row => row.code === 'needs-activity-classification'));
});
test('shared Break and Lunch tasks stay excluded without production team-assignment warnings', () => {
  for (const teams of [['wcpa'], ['wcpa', 'renau']]) {
    const result = calc({ tasks: [{ ...task, taskName: 'Lunch', taskType: 'break', teams }], projects: [{ ...project, teams }] });
    assert.equal(result.totals.breakIdleSeconds, 3600);
    assert.equal(result.totals.productionSeconds, 0);
    assert.equal(result.totals.eligibleClientWorkSeconds, 0);
    assert.ok(!result.warnings.some(row => ['needs-team-allocation', 'team-inferred-from-current-relationships', 'needs-activity-classification', 'missing-rate'].includes(row.code)));
  }
});
test('suppressing break assignment warnings still flags ambiguous work in the same period', () => {
  const work = log(9, 10), lunch = log(10, 11, { task: 'lunch' });
  const result = calc({ logs: [work, lunch], tasks: [{ ...task, teams: ['wcpa', 'renau'] }, { _id: 'lunch', taskType: 'break', teams: ['wcpa', 'renau'] }],
    projects: [{ ...project, teams: ['wcpa', 'renau'] }] });
  assert.equal(result.totals.breakIdleSeconds, 3600);
  assert.equal(result.totals.unallocatedSeconds, 3600);
  assert.equal(result.totals.productionSeconds, 0);
  const warning = result.warnings.find(row => row.code === 'needs-team-allocation');
  assert.equal(warning.count, 1);
  assert.deepEqual(warning.timeLogIds, [work._id]);
});
test('productive nonbillable work stays production and does not require rates', () => {
  const result = calc({ settings: [config(), classification('audit', 'productive', false)] });
  assert.equal(result.totals.productionSeconds, 3600); assert.equal(result.totals.nonBillableProductiveSeconds, 3600);
  assert.equal(result.totals.billing.billableSeconds, 0); assert.equal(result.warnings.some(row => row.code === 'missing-rate'), false);
});
test('optional excluded Admin work contributes to production and billing only in an opted-in report', () => {
  const settings = [config(), revision('classification', 'wcpa:task:audit', { category: 'excluded', billable: false, reportOptionalBillable: true })];
  const excluded = calc({ settings }), included = calc({ settings, includeOptionalWork: true });
  assert.equal(excluded.totals.excludedSeconds, 3600);
  assert.equal(excluded.totals.productionSeconds, 0);
  assert.equal(excluded.totals.billing.billableSeconds, 0);
  assert.equal(included.totals.productionSeconds, 3600);
  assert.equal(included.totals.billing.billableSeconds, 3600);
  assert.equal(included.totals.billing.estimates[0].estimatedAmount, 25);
  assert.equal(calc({ settings }).totals.productionSeconds, 0, 'The option never mutates saved classifications');
  const paused = calc({ settings, includeOptionalWork: true, logs: [log(9, 10, { pauses: [{ pausedAt: `${day}T09:30:00Z`, resumedAt: at(10) }] })] });
  assert.equal(paused.totals.productionSeconds, 1800);
  assert.equal(paused.totals.breakIdleSeconds, 1800);
  assert.equal(paused.totals.billing.estimates[0].estimatedAmount, 12.5);
});
test('optional report inclusion never enables Training, Break or ordinary excluded work', () => {
  for (const category of ['training', 'break-idle', 'excluded']) {
    const result = calc({ includeOptionalWork: true, settings: [config(), classification('audit', category, false)] });
    assert.equal(result.totals.productionSeconds, 0);
    assert.equal(result.totals.billing.billableSeconds, 0);
  }
  const result = calc({ includeOptionalWork: true, tasks: [{ ...task, taskType: 'break' }],
    settings: [config(), revision('classification', 'wcpa:task:audit', { category: 'excluded', billable: false, reportOptionalBillable: true })] });
  assert.equal(result.totals.breakIdleSeconds, 3600);
  assert.equal(result.totals.productionSeconds, 0);
});
test('review alerts are limited to billing-enabled teams and the selected work filters', () => {
  const first = log(9, 10), second = log(10, 11, { task: 'renau-work', project: 'renau-project' });
  const input = { logs: [first, second], tasks: [task, { _id: 'renau-work', teams: ['renau'] }], projects: [project, { _id: 'renau-project', teams: ['renau'] }],
    settings: [config(), config('renau', false)] };
  const all = calc(input);
  assert.deepEqual(all.warnings.map(row => row.count), [1, 1]);
  assert.ok(all.warnings.every(row => row.timeLogIds.every(value => value === first._id)));
  assert.deepEqual(calc({ ...input, filters: { team: 'renau' } }).warnings, []);
  assert.deepEqual(calc({ ...input, filters: { task: 'renau-work' } }).warnings, []);
  assert.deepEqual(calc({ ...input, allowedTeamIds: ['renau'] }).warnings, []);
  assert.equal(calc({ ...input, includeBilling: false }).warnings.length, 2, 'Hours-only users get scoped notices without money');
});
test('unallocated work alerts use home team only for review routing and never credit its hours', () => {
  const result = calc({ tasks: [{ ...task, teams: ['wcpa', 'renau'] }], projects: [{ ...project, teams: ['wcpa', 'renau'] }], filters: { team: 'wcpa' } });
  assert.equal(result.warnings.find(row => row.code === 'needs-team-allocation').count, 1);
  assert.equal(result.totals.productionSeconds, 0);
  assert.equal(result.details.length, 0);
});
test('classification notices honor the billing effective date of the actual work interval', () => {
  const result = calc({ endDate: tomorrow, logs: [log(23, 1, { stoppedAt: at(1, tomorrow) })],
    settings: [config(), config('wcpa', false, tomorrow), classification('audit', 'productive', true),
      classification('audit', 'excluded', false, 'wcpa', tomorrow)] });
  assert.equal(result.warnings.some(row => row.code === 'needs-activity-classification'), false);
  assert.equal(result.totals.productionSeconds, 3600);
});
test('employee project rates are authoritative; old client and team rates never override them', () => {
  const result = calc({ settings: [config(), classification(), rate(999, 'wcpa', 'c1', 'e1')] });
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 25);
  assert.equal(result.details[0].billing.rateSource, 'employee-project');
  const missing = calc({ employees: [{ ...employee, projectRates: [] }] });
  assert.equal(missing.totals.billing.estimates[0].estimatedAmount, null);
  assert.equal(missing.totals.billing.estimates[0].missingRateSeconds, 3600);
  const mixed = calc({ logs: [log(9, 10), log(10, 11, { project: 'p2' })] });
  assert.equal(mixed.totals.billing.estimates[0].estimatedAmount, 25);
  assert.equal(mixed.totals.billing.estimates[0].complete, false);
});
test('different employees and projects use their own rates, independent of client', () => {
  const result = calc({ employees: [employee, { ...employee, _id: 'e2', projectRates: [{ project: 'p1', chargeRate: 40 }] }],
    logs: [log(9, 10), log(10, 11, { client: 'c2' }), log(9, 10, { employee: 'e2' })] });
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 90);
});
test('classification changes split at reporting-timezone midnight while current employee rates apply', () => {
  const result = calc({ endDate: tomorrow, logs: [log(23, 1, { stoppedAt: at(1, tomorrow) })],
    settings: [config(), classification(), classification('audit', 'training', false, 'wcpa', tomorrow, 2)] });
  assert.equal(result.totals.productionSeconds, 3600); assert.equal(result.totals.trainingSeconds, 3600);
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 25);
});
test('duplicate sessions and overlapping pauses count once across all categories', () => {
  const original = log(9, 12, { pauses: [{ pausedAt: at(10), resumedAt: at(11) }, { pausedAt: at(10), resumedAt: at(11) }] });
  const result = calc({ logs: [original, { ...original, _id: 'duplicate' }] });
  assert.equal(result.totals.actualSeconds, 10800); assert.equal(result.totals.productionSeconds, 7200);
  assert.equal(result.totals.breakIdleSeconds, 3600); assert.equal(result.totals.billing.estimates[0].estimatedAmount, 50);
});
test('simultaneous different work is held for review instead of double-counting', () => {
  const result = calc({ logs: [log(9, 11), log(10, 12, { client: 'c2' })] });
  assert.equal(result.totals.actualSeconds, 10800); assert.equal(result.totals.productionSeconds, 7200);
  assert.equal(result.totals.conflictSeconds, 3600); assert.equal(result.totals.billing.estimates[0].estimatedAmount, 50);
});
test('filters apply after exclusions so selecting a work task cannot restore overlapping break time', () => {
  const result = calc({ logs: [log(9, 11), log(10, 11, { task: 'break' })],
    tasks: [task, { _id: 'break', teams: ['wcpa'], taskType: 'break' }], filters: { task: 'audit' } });
  assert.equal(result.totals.productionSeconds, 3600); assert.equal(result.totals.billing.estimates[0].estimatedAmount, 25);
});
test('ambiguous team assignments are flagged; employee home team does not guess work allocation', () => {
  const result = calc({ tasks: [{ ...task, teams: ['wcpa', 'renau'] }], projects: [{ ...project, teams: ['wcpa', 'renau'] }] });
  assert.equal(result.totals.actualSeconds, 3600); assert.equal(result.totals.productionSeconds, 0);
  assert.equal(result.totals.unallocatedSeconds, 3600); assert.ok(result.warnings.some(row => row.code === 'needs-team-allocation'));
  assert.deepEqual(resolveWorkTeam({}, {}, {}, null), { team: null, source: 'needs-allocation' });
});
test('explicit allocation takes latest version and cross-team work retains a single daily target', () => {
  const first = log(9, 10), second = log(10, 11);
  const result = calc({ logs: [first, second], allocations: [
    { timeLog: first._id, team: 'wcpa', version: 1 },
    { timeLog: second._id, team: 'renau', version: 2 }, { timeLog: second._id, team: 'wcpa', version: 1 },
  ], settings: [config(), classification(), classification('audit', 'productive', true, 'renau'), rate()] });
  assert.equal(result.totals.productionSeconds, 7200); assert.equal(result.totals.expectedSeconds, 28800);
  assert.equal(result.teams.reduce((sum, team) => sum + team.expectedSeconds, 0), 28800);
  assert.equal(result.teams.find(team => team.team === 'renau').productionSeconds, 3600);
  assert.deepEqual(result.teams.find(team => team.team === 'renau').billing, { applicable: false });
});
test('7.8-hour targets, approved leave, half day and overtime reuse attendance policy', () => {
  assert.equal(calc({ policies: [policy(28080)] }).totals.expectedSeconds, 28080);
  assert.equal(calc({ attendance: [present(day, [{ type: 'leave' }])] }).totals.expectedSeconds, 0);
  assert.equal(calc({ attendance: [present(day, [{ type: 'half_day' }])] }).totals.expectedSeconds, 14400);
  assert.equal(calc({ attendance: [] }).totals.expectedSeconds, 0);
  const overtime = calc({ logs: [log(8, 18)] });
  assert.equal(overtime.totals.overtimeSeconds, 7200); assert.equal(overtime.totals.achievementPercent, 125);
  assert.equal(calc({ policies: [] }).totals.achievementPercent, null);
});
test('manager accounts remain excluded from targets', () => {
  assert.equal(calc({ employees: [{ ...employee, role: 'manager' }] }).totals.expectedSeconds, 0);
});
test('employee rates use the effective team currency and currencies stay separate', () => {
  const result = calc({ endDate: tomorrow, logs: [log(23, 1, { stoppedAt: at(1, tomorrow) })],
    settings: [config(), config('wcpa', true, tomorrow, 'EUR', 2), classification()] });
  assert.deepEqual(result.totals.billing.estimates.map(row => [row.currency, row.estimatedAmount]), [['EUR', 25], ['USD', 25]]);
});
test('hours-only access contains no rates, configuration identifiers or monetary fields', () => {
  const result = calc({ includeBilling: false });
  const json = JSON.stringify(result);
  for (const forbidden of ['"billing"', 'rateHundredths', 'rateRevision', 'configRevision', 'estimatedAmount', '"currency"']) assert.equal(json.includes(forbidden), false);
  assert.equal(result.totals.productionSeconds, 3600);
});
test('deleted logs and stale desktop timer tails do not inflate production', () => {
  const deleted = log(9, 10, { manualEntry: { deletedAt: at(11) } });
  const running = log(9, 10, { stoppedAt: null, status: 'running', desktopHeartbeatAt: at(10) });
  const result = calc({ logs: [deleted, running], now: at(12) });
  assert.equal(result.totals.productionSeconds, 3600);
});
test('summary, daily, employee and team totals reconcile without mutating source records', () => {
  const logs = [log(9, 10), log(11, 12)], before = JSON.stringify(logs);
  const result = calc({ logs });
  for (const key of ['actualSeconds', 'productionSeconds', 'expectedSeconds']) {
    for (const rows of [result.members, result.teams, result.daily]) assert.equal(rows.reduce((sum, row) => sum + row[key], 0), result.totals[key]);
  }
  assert.equal(JSON.stringify(logs), before); assert.equal(result.provisional, true);
});
test('precise hours are used before monetary rounding', () => {
  const result = calc({ employees: [{ ...employee, projectRates: [{ project: 'p1', chargeRate: 30 }] }], logs: [log(8, 16, { stoppedAt: '2026-11-10T15:56:00.000Z' })], settings: [config(), classification(), rate(30)] });
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 238);
});
test('currency rounding respects zero and three decimal currency units', () => {
  for (const [currency, expected] of [['JPY', 1], ['KWD', 1.234]]) {
    const result = calc({ employees: [{ ...employee, projectRates: [{ project: 'p1', chargeRate: 1 }] }], logs: [log(9, 10, { stoppedAt: '2026-11-10T10:14:02.400Z' })],
      settings: [config('wcpa', true, day, currency), classification(), rate(1, 'wcpa', '*', '*', day, currency)] });
    assert.equal(result.totals.billing.estimates[0].estimatedAmount, expected);
  }
});
test('overtime never cancels another employee target gap', () => {
  const result = calc({ employees: [employee, { ...employee, _id: 'e2', employeeId: '1002' }],
    logs: [log(8, 18), log(8, 14, { employee: 'e2' })],
    attendance: [present(), { ...present(), employee: 'e2' }], policies: [policy(), { ...policy(), employee: 'e2' }] });
  assert.equal(result.totals.expectedSeconds, 57600); assert.equal(result.totals.productionSeconds, 57600);
  assert.equal(result.totals.remainingSeconds, 7200); assert.equal(result.totals.overtimeSeconds, 7200);
});
test('activity classification overrides task classification and mixed activities cannot duplicate billing', () => {
  const result = calc({ logs: [log(9, 10, { activityMapping: 'mapping' })],
    settings: [config(), classification(), revision('classification', 'wcpa:activity:mapping', { category: 'training', billable: false }), rate()] });
  assert.equal(result.totals.trainingSeconds, 3600); assert.equal(result.totals.productionSeconds, 0);
});
test('financial grants are team-specific even when the same employee works across teams', () => {
  const first = log(9, 10), second = log(10, 11);
  const result = calc({ logs: [first, second], billingTeamIds: ['renau'],
    allocations: [{ timeLog: first._id, team: 'wcpa', version: 1 }, { timeLog: second._id, team: 'renau', version: 1 }],
    settings: [config(), config('renau'), classification(), classification('audit', 'productive', true, 'renau'), rate(25), rate(40, 'renau')] });
  assert.equal(result.totals.productionSeconds, 7200); assert.equal(result.totals.billing.estimates[0].estimatedAmount, 25);
  assert.deepEqual(result.details.find(row => row.team === 'wcpa').billing, { applicable: false });
});
test('weekly and monthly billing use unrounded intervals instead of summing rounded daily amounts', () => {
  const result = calc({ endDate: tomorrow, logs: [log(9, 10, { stoppedAt: `${day}T09:00:01Z` }), log(9, 10, { startedAt: `${tomorrow}T09:00:00Z`, stoppedAt: `${tomorrow}T09:00:01Z` })] });
  assert.equal(result.daily.reduce((sum, row) => sum + row.billing.estimates[0].estimatedAmount, 0), 0.02);
  assert.equal(result.weekly[0].billing.estimates[0].estimatedAmount, 0.01);
  assert.equal(result.monthly[0].billing.estimates[0].estimatedAmount, 0.01);
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 0.01);
});
test('production without an applicable target does not inflate another employee target achievement', () => {
  const result = calc({ employees: [employee, { ...employee, _id: 'e2' }, { ...employee, _id: 'manager', role: 'manager' }],
    logs: [log(9, 10), log(9, 12, { employee: 'e2' }), log(9, 12, { employee: 'manager' })],
    attendance: [present(), { ...present(), employee: 'e2' }], policies: [policy()] });
  assert.equal(result.totals.productionSeconds, 25200);
  assert.equal(result.totals.targetEligibleProductionSeconds, 3600);
  assert.equal(result.totals.achievementPercent, 12.5);
});
