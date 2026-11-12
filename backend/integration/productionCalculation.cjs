// Temporary loopback MongoDB only. Does not load environment credentials.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Employee = require('../src/models/Employee');
const Team = require('../src/models/Team');
const Task = require('../src/models/Task');
const Project = require('../src/models/Project');
const Log = require('../src/models/TaskTimeLog');
const Attendance = require('../src/models/Attendance');
const Policy = require('../src/models/WorkingHoursPolicy');
const Revision = require('../src/models/ProductionSettingsRevision');
const Allocation = require('../src/models/ProductionWorkAllocation');
const { ensureProductionSettingsIndexes } = require('../src/services/production/settingsService');
const { loadProductionCalculation } = require('../src/services/production/calculationService');
const reports = require('../src/modules/production/productionReportController');
const date = '2026-11-10', actor = new mongoose.Types.ObjectId();
let replica, first, second, wcpa, renau, task, project;
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  const uri = replica.getUri(`production_calculation_${crypto.randomUUID().replaceAll('-', '')}`);
  assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  for (const Model of [Employee, Team, Task, Project, Log, Attendance, Policy]) { await Model.createCollection(); await Model.createIndexes(); }
  await ensureProductionSettingsIndexes();
  wcpa = await Team.create({ teamName: 'Synthetic WCPA', createdBy: actor });
  renau = await Team.create({ teamName: 'Synthetic Renau', createdBy: actor });
  [first, second] = [wcpa, renau].map((team, index) => ({ _id: new mongoose.Types.ObjectId(), fullName: `Synthetic Employee ${index}`, employeeId: `E${index}`,
    email: `production-${index}@example.invalid`, team: team._id, role: 'employee', isActive: true }));
  await Employee.collection.insertMany([first, second]);
  project = await Project.create({ projectName: 'Shared Project', projectCode: crypto.randomUUID(), teams: [wcpa._id, renau._id], createdBy: actor });
  await Employee.updateMany({}, { $set: { projectRates: [{ project: project._id, chargeRate: 25 }] } });
  task = await Task.create({ taskName: 'Shared Work', taskCode: crypto.randomUUID(), teams: [wcpa._id, renau._id], createdBy: actor });
  for (const person of [first, second]) {
    await Attendance.create({ employee: person._id, date, status: 'Present' });
    await Policy.create({ employee: person._id, revisions: [{ effectiveFrom: date, requiredSeconds: 28080, halfDayPercent: 50, changedBy: actor, changedAt: new Date() }] });
    const log = await Log.create({ employee: person._id, task: task._id, project: project._id, startedAt: `${date}T09:00:00Z`, stoppedAt: `${date}T11:00:00Z`,
      totalWorkedSeconds: 3600, pauses: [{ pausedAt: `${date}T10:00:00Z`, resumedAt: `${date}T11:00:00Z`, reason: 'idle' }], status: 'stopped', isActiveTimer: false });
    await Allocation.create({ timeLog: log._id, team: person.team, version: 1, changedBy: actor, reason: 'Verified allocation' });
    const team = String(person.team);
    await Revision.create([
      { kind: 'team-billing', key: team, team, version: 1, effectiveFrom: date,
        values: { billingEnabled: String(person.team) === String(wcpa._id), currency: 'USD', approvalRequired: true }, changedBy: actor, reason: 'Synthetic config' },
      { kind: 'classification', key: `${team}:task:${task._id}`, team, version: 1, effectiveFrom: date,
        values: { category: 'productive', billable: true }, changedBy: actor, reason: 'Synthetic classification' },
      { kind: 'rate', key: `${team}:*:*`, team, version: 1, effectiveFrom: date,
        values: { enabled: true, currency: 'USD', hourlyRateHundredths: 2500 }, changedBy: actor, reason: 'Synthetic rate' },
    ]);
  }
}, { timeout: 180000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
const options = overrides => ({ employeeIds: [String(first._id), String(second._id)], startDate: date, endDate: date, timezone: 'UTC',
  now: `${date}T23:00:00Z`, includeBilling: true, ...overrides });
test('database-backed calculation uses existing logs, targets, configuration and allocations', async () => {
  const result = await loadProductionCalculation(options());
  assert.equal(result.totals.actualSeconds, 14400); assert.equal(result.totals.productionSeconds, 7200);
  assert.equal(result.totals.breakIdleSeconds, 7200); assert.equal(result.totals.expectedSeconds, 56160);
  assert.equal(result.totals.billing.estimates[0].estimatedAmount, 25);
  assert.deepEqual(result.teams.find(row => row.team === String(renau._id)).billing, { applicable: false });
});
test('loader requires an explicit valid employee scope and never fetches company-wide by default', async () => {
  await assert.rejects(loadProductionCalculation(options({ employeeIds: undefined })), { statusCode: 400 });
  await assert.rejects(loadProductionCalculation(options({ employeeIds: [{ $ne: null }] })), { statusCode: 400 });
  const result = await loadProductionCalculation(options({ employeeIds: [String(second._id)] }));
  assert.equal(result.members.length, 1); assert.equal(result.members[0].employee, String(second._id));
  assert.equal(result.totals.actualSeconds, 7200); assert.deepEqual(result.totals.billing, { applicable: false });
  const empty = await loadProductionCalculation(options({ employeeIds: [] })); assert.equal(empty.totals.actualSeconds, 0);
});
test('hours-only loader reads billing activation for scoped notices without financial fields', async t => {
  const original = Revision.find; let kinds;
  t.mock.method(Revision, 'find', function (filter) { kinds = filter.kind.$in; return original.call(this, filter); });
  const result = await loadProductionCalculation(options({ includeBilling: false, includeSources: true }));
  assert.deepEqual(kinds, ['classification', 'team-billing']); assert.equal(result.totals.billing, undefined);
  assert.ok(result.sources.settings.filter(row => row.kind === 'team-billing').every(row => row.values.currency === undefined && row.values.approvalRequired === undefined));
  assert.equal(JSON.stringify(result).includes('rateHundredths'), false);
});
test('latest explicit allocation wins, and filters restrict credited work without duplicating targets', async () => {
  const log = await Log.findOne({ employee: first._id }).lean();
  await Allocation.create({ timeLog: log._id, team: renau._id, version: 2, changedBy: actor, reason: 'Verified reassignment' });
  const result = await loadProductionCalculation(options({ filters: { team: String(renau._id) } }));
  assert.equal(result.totals.productionSeconds, 7200); assert.equal(result.totals.expectedSeconds, 28080);
  assert.deepEqual(result.totals.billing, { applicable: false });
  assert.ok(result.details.every(row => row.team === String(renau._id)));
});
test('calculating does not mutate original time logs, attendance or policies', async () => {
  const before = await Log.find({}).sort('_id').lean(), beforeAttendance = await Attendance.find({}).sort('_id').lean();
  await loadProductionCalculation(options());
  assert.deepEqual(await Log.find({}).sort('_id').lean(), before);
  assert.deepEqual(await Attendance.find({}).sort('_id').lean(), beforeAttendance);
  assert.equal(await Policy.countDocuments(), 2);
});
async function report(user, query = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await reports.getReport({ user, query: { startDate: date, endDate: date, view: 'employee', ...query } }, res);
  return res;
}
test('Production API paginates and returns labeled real records without exposing raw datasets', async () => {
  const overview = await report({ _id: actor, role: 'admin' }, { view: 'overview' });
  assert.equal(overview.body.report.teamHighlights.length, 2);
  assert.ok(overview.body.report.teamHighlights.every(row => row.teamName && Number.isFinite(row.productionSeconds)));
  const personalOverview = await report(second, { view: 'overview' });
  assert.ok(personalOverview.body.report.teamHighlights.every(row => row.billing === undefined));
  assert.ok(personalOverview.body.report.teamHighlights.every(row => row.team === String(renau._id)));
  const res = await report({ _id: actor, role: 'admin' }, { limit: '1' });
  assert.equal(res.code, 200); assert.equal(res.body.report.total, 2); assert.equal(res.body.report.rows.length, 1);
  assert.equal(res.body.report.rows[0].fullName, first.fullName);
  assert.equal(res.body.report.details, undefined); assert.equal(res.body.report.scope.canConfigure, true);
  assert.ok(res.body.report.warnings.every(row => row.timeLogIds === undefined));
  const details = await report({ _id: actor, role: 'admin' }, { view: 'details', employee: String(first._id) });
  assert.equal(details.code, 200); assert.equal(details.body.report.rows[0].taskName, 'Shared Work');
  const compact = await report({ _id: actor, role: 'admin' }, { limit: '1', includeChoices: 'false' });
  assert.equal(compact.code, 200); assert.equal(compact.body.report.choices, undefined); assert.equal(compact.body.report.rows[0].teamName, wcpa.teamName);
});
test('employee and HR Billing permissions do not automatically expose Production money', async () => {
  const personal = await report({ ...second, permissions: ['view_all_reports', 'view_billing_amounts'] });
  assert.equal(personal.code, 200); assert.equal(personal.body.report.total, 1);
  assert.equal(personal.body.report.scope.mode, 'personal'); assert.equal(personal.body.report.summary.billing, undefined);
  const injected = await report(second, { includeBilling: 'true', billingTeamIds: [String(wcpa._id)] });
  assert.equal(injected.code, 200); assert.equal(injected.body.report.summary.billing, undefined);
  const denied = await report(second, { employee: String(first._id) }); assert.equal(denied.code, 403);
  const hr = await report({ _id: actor, role: 'hr' });
  assert.equal(hr.code, 200); assert.equal(hr.body.report.scope.mode, 'company'); assert.equal(hr.body.report.summary.billing, undefined);
  assert.equal(JSON.stringify(hr.body).includes('rateHundredths'), false);
});
test('managers need assigned teams and explicit financial grants; admin inheritance cannot bypass scope', async () => {
  const manager = { _id: new mongoose.Types.ObjectId(), role: 'manager' };
  const blank = await report(manager); assert.equal(blank.code, 200); assert.equal(blank.body.report.total, 0);
  const key = `${manager._id}:${renau._id}`;
  await Revision.create({ kind: 'access', key, team: renau._id, version: 1, effectiveFrom: '2000-01-01',
    values: { employee: String(manager._id), enabled: true, canViewBilling: false }, changedBy: actor, reason: 'Scoped manager' });
  const scoped = await report(manager);
  assert.equal(scoped.code, 200); assert.equal(scoped.body.report.total, 1); assert.equal(scoped.body.report.rows[0].employee, String(second._id));
  assert.equal(scoped.body.report.summary.billing, undefined);
  assert.equal((await report(manager, { employee: String(first._id) })).code, 403);
  assert.equal((await report(manager, { team: String(wcpa._id) })).code, 403);
  await Revision.create({ kind: 'access', key, team: renau._id, version: 2, effectiveFrom: '2000-01-01',
    values: { employee: String(manager._id), enabled: true, canViewBilling: true }, changedBy: actor, reason: 'Scoped finance grant' });
  await Revision.create({ kind: 'team-billing', key: String(renau._id), team: renau._id, version: 2, effectiveFrom: date,
    values: { billingEnabled: true, currency: 'USD', approvalRequired: true }, changedBy: actor, reason: 'Enable Renau estimate' });
  const financial = await report(manager);
  assert.equal(financial.code, 200); assert.equal(financial.body.report.summary.billing.estimates[0].estimatedAmount, 25);
  assert.equal(financial.body.report.scope.canConfigure, false);
});
test('team leads see only assigned employees in their led teams and revocation reduces access to personal', async () => {
  const lead = { _id: new mongoose.Types.ObjectId(), role: 'team_lead' };
  await Team.updateOne({ _id: renau._id }, { $set: { teamLead: lead._id } });
  // Foreign employee has the same lead but belongs to a team the lead does not lead.
  await Employee.updateMany({ _id: { $in: [first._id, second._id] } }, { $set: { teamLead: lead._id } });
  const scoped = await report(lead); assert.equal(scoped.code, 200); assert.equal(scoped.body.report.total, 1);
  assert.equal(scoped.body.report.rows[0].employee, String(second._id));
  assert.equal((await report(lead, { employee: String(first._id) })).code, 403);
  const revoked = await report({ ...lead, permissionOverrides: { revoked: ['view_team_timesheets'] } });
  assert.equal(revoked.code, 200); assert.equal(revoked.body.report.total, 0);
});
