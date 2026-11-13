const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSetting, effectiveRevision, today } = require('../src/services/production/settingsValidation');
const { initializationPlan } = require('../src/services/production/initialization');
const { settingsAdmin } = require('../src/modules/production/productionSettingsController');
const { saveSetting } = require('../src/services/production/settingsService');
const { parseArguments } = require('../scripts/initializeProduction');
const team = '64b000000000000000000001', other = '64b000000000000000000002';
const base = { team, effectiveFrom: today(), expectedVersion: 0, reason: 'Initial setup', billingEnabled: true, approvalRequired: true, currency: 'USD' };

test('team billing requires explicit activation, supported currency and optimistic version', () => {
  const row = validateSetting('team-billing', base);
  assert.equal(row.key, team); assert.equal(row.values.currency, 'USD');
  assert.equal(validateSetting('team-billing', { ...base, billingEnabled: false }).values.currency, null);
  for (const invalid of [{ currency: 'ZZZ' }, { billingEnabled: 'true' }, { expectedVersion: undefined }, { expectedVersion: -1 }, { team: { $ne: null } }, { reason: 'x' }, { effectiveFrom: '2026-02-30' }]) {
    assert.throws(() => validateSetting('team-billing', { ...base, ...invalid }), { statusCode: 400 });
  }
});
test('normal settings cannot silently backdate production or rates', () => {
  assert.throws(() => validateSetting('team-billing', { ...base, effectiveFrom: '2000-01-01' }), /Historical recalculation/);
});
test('training, excluded and break activities cannot be marked billable', () => {
  const body = { ...base, targetType: 'task', target: other, billable: true };
  for (const category of ['training', 'excluded', 'break-idle']) assert.throws(() => validateSetting('classification', { ...body, category }), /Only productive/);
  const result = validateSetting('classification', { ...body, category: 'productive' });
  assert.equal(result.key, `${team}:task:${other}`);
  assert.equal(result.values.billable, true);
});
test('all four rate scopes use stable IDs and preserve integer precision', () => {
  const keys = new Set();
  for (const client of [null, other]) for (const employee of [null, team]) {
    const row = validateSetting('rate', { ...base, client, employee, enabled: true, hourlyRate: 25.15 });
    assert.equal(row.values.hourlyRateHundredths, 2515); keys.add(row.key);
  }
  assert.equal(keys.size, 4);
  for (const hourlyRate of [0, -1, '25', 1.001, Infinity, 1000001]) assert.throws(() => validateSetting('rate', { ...base, enabled: true, hourlyRate }));
});
test('optional report billing is an explicit excluded-activity option, not a billable default', () => {
  const body = { ...base, targetType: 'task', target: other, category: 'excluded', billable: false, reportOptionalBillable: true };
  const setting = validateSetting('classification', body);
  assert.equal(setting.values.billable, false);
  assert.equal(setting.values.reportOptionalBillable, true);
  for (const category of ['productive', 'training', 'break-idle']) assert.throws(() => validateSetting('classification', { ...body, category }), /Only excluded/);
  assert.throws(() => validateSetting('classification', { ...body, reportOptionalBillable: 'true' }), /must be true or false/);
});
test('effective settings ignore future dates and use latest same-day correction', () => {
  const rows = [{ version: 3, effectiveFrom: '2027-01-01' }, { version: 1, effectiveFrom: '2026-01-01' }, { version: 2, effectiveFrom: '2026-01-01' }];
  assert.equal(effectiveRevision(rows, '2026-06-01').version, 2);
  assert.equal(effectiveRevision(rows, '2025-12-31'), null);
  assert.equal(effectiveRevision(rows, '2027-01-01').version, 3);
});
test('only actual Admin roles can read configuration, including rates and audit history', () => {
  for (const role of ['admin', 'alpha', 'manager', 'hr', 'team_lead', 'employee', null]) {
    let passed = false;
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    settingsAdmin({ user: role ? { role } : null }, res, () => { passed = true; });
    assert.equal(passed, ['admin', 'alpha'].includes(role));
    if (!passed) assert.equal(res.code, role ? 403 : 401);
  }
});
test('service rejects managers even with inherited admin permissions before database access', async () => {
  await assert.rejects(saveSetting('team-billing', base, { _id: team, role: 'manager', permissions: ['view_billing_amounts'] }), { statusCode: 403 });
});
test('initialization enables only selected WCPA and never overwrites configured teams', () => {
  const teams = [{ _id: team, teamName: 'WCPA' }, { _id: other, teamName: 'Renau CPA' }];
  const options = { effectiveFrom: today(), currency: 'USD' };
  const plan = initializationPlan(teams, [{ key: other }], options);
  assert.equal(plan[0].setting.values.billingEnabled, true);
  assert.equal(plan[1].setting.values.billingEnabled, false);
  assert.equal(plan[1].disposition, 'preserve-existing');
  assert.throws(() => initializationPlan(teams.slice(1), [], options), /exactly one/);
  assert.throws(() => initializationPlan([...teams, { _id: '64b000000000000000000003', teamName: ' wcpa ' }], [], options), /exactly one/);
});
test('migration defaults to preview and requires explicit effective date, currency and actor to apply', () => {
  const args = ['--effective-from', today(), '--currency', 'USD'];
  assert.equal(parseArguments(args).apply, false);
  assert.throws(() => parseArguments([...args, '--apply']), /requires --actor/);
  assert.equal(parseArguments([...args, '--apply', '--actor', team]).apply, true);
  assert.throws(() => parseArguments(['--oops']));
});
test('billing approval is an explicit grant requiring financial visibility, and legacy grants default to no approval', () => {
  const access = { ...base, employee: other, enabled: true, canViewBilling: true };
  assert.equal(validateSetting('access', access).values.canApproveBilling, false);
  assert.equal(validateSetting('access', { ...access, canApproveBilling: true }).values.canApproveBilling, true);
  assert.throws(() => validateSetting('access', { ...access, canViewBilling: false, canApproveBilling: true }), /explicit financial visibility/);
});
