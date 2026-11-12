// Financial workflow tests use an isolated loopback replica set, never .env.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
const Employee = require('../src/models/Employee');
const Team = require('../src/models/Team');
const Task = require('../src/models/Task');
const Project = require('../src/models/Project');
const Client = require('../src/models/Client');
const Log = require('../src/models/TaskTimeLog');
const Policy = require('../src/models/WorkingHoursPolicy');
const Attendance = require('../src/models/Attendance');
const Revision = require('../src/models/ProductionSettingsRevision');
const Allocation = require('../src/models/ProductionWorkAllocation');
const Batch = require('../src/models/ProductionBillingBatch');
const Event = require('../src/models/ProductionBillingEvent');
const Claim = require('../src/models/ProductionBillingClaim');
const Adjustment = require('../src/models/ProductionBillingAdjustment');
const workflow = require('../src/services/production/billingWorkflow');
const { productionReport } = require('../src/services/production/reportsService');
const { authorizeReportExport } = require('../src/services/production/reportTokens');
const { productionReportData } = require('../src/modules/production/productionReportController');
const { ensureProductionSettingsIndexes } = require('../src/services/production/settingsService');
const { today } = require('../src/services/production/settingsValidation');
const { addDateKeyDays } = require('../src/utils/billingUtils');
const date = addDateKeyDays(today(), -2), admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
let replica;
before(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', spawn: { windowsHide: true } } });
  const uri = replica.getUri(`production_billing_${crypto.randomUUID().replaceAll('-', '')}`);
  assert.ok(uri.startsWith('mongodb://127.0.0.1:'));
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  for (const Model of [Employee, Team, Task, Project, Client, Log, Policy, Attendance]) { await Model.createCollection(); await Model.createIndexes(); }
  await ensureProductionSettingsIndexes();
}, { timeout: 180000 });
after(async () => { try { await mongoose.disconnect(); } finally { await replica?.stop(); } });
async function fixture({ verified = true, rate = true, approvalRequired = true, running = false } = {}) {
  const token = crypto.randomUUID(), team = await Team.create({ teamName: token, createdBy: admin._id });
  const employee = { _id: new mongoose.Types.ObjectId(), employeeId: token, fullName: 'Synthetic Employee', email: `${token}@example.invalid`, role: 'employee', team: team._id, isActive: true };
  await Employee.collection.insertOne(employee);
  const project = await Project.create({ projectCode: token, projectName: 'Audit', teams: [team._id], createdBy: admin._id });
  if (rate) await Employee.updateOne({ _id: employee._id }, { $set: { projectRates: [{ project: project._id, chargeRate: 25 }] } });
  const task = await Task.create({ taskCode: token, taskName: 'Review', teams: [team._id], createdBy: admin._id });
  const log = await Log.create({ employee: employee._id, project: project._id, task: task._id, startedAt: `${date}T09:00:00Z`, stoppedAt: running ? null : `${date}T10:00:00Z`,
    status: running ? 'running' : 'stopped', isActiveTimer: running, pauses: [] });
  if (verified) await Allocation.create({ timeLog: log._id, team: team._id, version: 1, changedBy: admin._id, reason: 'Verified team' });
  const setting = (kind, key, values) => ({ kind, key, values, team: team._id, effectiveFrom: date, version: 1, changedBy: admin._id, reason: 'Synthetic configuration' });
  await Revision.create([setting('team-billing', String(team._id), { billingEnabled: true, currency: 'USD', approvalRequired }),
    setting('classification', `${team._id}:task:${task._id}`, { category: 'productive', billable: true }),
    ...(rate ? [setting('rate', `${team._id}:*:*`, { enabled: true, hourlyRateHundredths: 2500, currency: 'USD' })] : [])]);
  return { team, employee, project, task, log, setting };
}
const create = (f, overrides = {}, actor = admin) => workflow.createBilling(actor, { employee: String(f.employee._id), team: String(f.team._id), startDate: date, endDate: date,
  reason: 'Prepare billing', requestId: crypto.randomUUID(), ...overrides });
const action = (batch, name, overrides = {}, actor = admin) => workflow.actOnBilling(actor, batch._id, { action: name, expectedVersion: batch.version,
  reason: `Review action ${name}`, requestId: crypto.randomUUID(), ...overrides });
const amount = batch => batch.snapshot.summary.billing.estimates[0].estimatedAmount;
async function newRate(f, value = 4000) {
  await Employee.updateOne({ _id: f.employee._id }, { $set: { projectRates: [{ project: f.project._id, chargeRate: value / 100 }] } });
}
test('Draft → Submitted → Approved → Finalized freezes the original amount; historical correction is separate and previewed', async () => {
  const f = await fixture(); let batch = await create(f); assert.equal(amount(batch), 25);
  batch = await action(batch, 'submit'); batch = await action(batch, 'approve'); batch = await action(batch, 'finalize');
  const original = await Batch.findById(batch._id).lean();
  await newRate(f);
  assert.equal(amount((await workflow.getBilling(admin, batch._id)).batch), 25);
  await assert.rejects(action(batch, 'refresh'), { statusCode: 409 });
  await assert.rejects(action(batch, 'recalculate'), { statusCode: 409 });
  const preview = await workflow.previewRecalculation(admin, batch._id);
  assert.deepEqual(preview.deltas, [{ currency: 'USD', amount: 15 }]);
  const requestId = crypto.randomUUID(), request = { previewHash: preview.previewHash, requestId };
  const adjusted = await action(batch, 'recalculate', request);
  await action(batch, 'recalculate', request); // Lost-response retry: no second adjustment.
  assert.equal(await Adjustment.countDocuments({ batch: batch._id }), 1);
  const saved = await Batch.findById(batch._id).lean();
  assert.deepEqual(saved.snapshot, original.snapshot); assert.equal(saved.sourceHash, original.sourceHash); assert.equal(saved.status, 'Finalized');
  const read = await workflow.getBilling(admin, adjusted._id);
  assert.deepEqual(read.adjustedTotals, [{ currency: 'USD', amount: 40 }]);
  assert.equal(read.adjustments[0].reason, 'Review action recalculate');
});
test('missing rates and running timers block submission; refresh is explicit when sources change', async () => {
  const f = await fixture({ rate: false }); let batch = await create(f);
  assert.ok(batch.snapshot.blockers.includes('missing-or-mismatched-rate'));
  await assert.rejects(action(batch, 'submit'), { statusCode: 409 });
  await newRate(f, 2500, 1);
  await assert.rejects(action(batch, 'submit'), /configuration changed/);
  batch = await action(batch, 'refresh'); batch = await action(batch, 'submit'); assert.equal(batch.status, 'Submitted');
  const running = await fixture({ running: true }), draft = await create(running);
  assert.ok(draft.snapshot.blockers.includes('running-timer')); await assert.rejects(action(draft, 'submit'), { statusCode: 409 });
});
test('team assignment verification is versioned, audited and required before submission', async () => {
  const f = await fixture({ verified: false }); let batch = await create(f);
  assert.ok(batch.snapshot.blockers.includes('unverified-team-allocation'));
  await assert.rejects(action(batch, 'submit'), { statusCode: 409 });
  batch = await action(batch, 'verify-allocations', { verificationHash: batch.verificationHash, allocations: [{ timeLog: String(f.log._id), expectedVersion: 0 }] });
  assert.equal(batch.snapshot.entries[0].verified, true); assert.equal(batch.snapshot.blockers.length, 0);
  const allocation = await Allocation.findOne({ timeLog: f.log._id }).lean(); assert.equal(String(allocation.changedBy), String(admin._id));
  assert.equal((await action(batch, 'submit')).status, 'Submitted');
});
test('overlapping billing periods cannot claim the same employee/team/day', async () => {
  const f = await fixture(); let first = await create(f); first = await action(first, 'submit');
  assert.equal((await create(f))._id, first._id, 'Exact duplicate create returns the existing period');
  const second = await create(f, { endDate: addDateKeyDays(date, 1) });
  await assert.rejects(action(second, 'submit'), { statusCode: 409 });
  assert.equal((await Batch.findById(second._id).lean()).status, 'Draft');
  assert.equal(await Claim.countDocuments({ batch: second._id }), 0);
});
test('rejection releases claims; changed approved work requires rejection and a new draft estimate', async () => {
  const f = await fixture(); let batch = await create(f); batch = await action(batch, 'submit'); batch = await action(batch, 'approve');
  await newRate(f);
  await assert.rejects(action(batch, 'finalize'), /configuration changed/);
  batch = await action(batch, 'reject'); assert.equal(await Claim.countDocuments({ batch: batch._id }), 0);
  batch = await action(batch, 'refresh'); assert.equal(batch.status, 'Draft'); assert.equal(amount(batch), 40);
  batch = await action(batch, 'submit'); batch = await action(batch, 'approve'); batch = await action(batch, 'finalize');
  assert.equal(await Claim.countDocuments({ batch: batch._id }), 1);
});
test('billing reviewers require explicit scope and approval grants; inherited manager permissions are insufficient', async () => {
  const f = await fixture(); let batch = await create(f); batch = await action(batch, 'submit');
  const manager = { _id: new mongoose.Types.ObjectId(), role: 'manager' };
  await assert.rejects(action(batch, 'approve', {}, manager), { statusCode: 403 });
  const grant = { kind: 'access', key: `${manager._id}:${f.team._id}`, team: f.team._id, effectiveFrom: date, version: 1, changedBy: admin._id, reason: 'Explicit financial access',
    values: { employee: String(manager._id), enabled: true, canViewBilling: true, canApproveBilling: false } };
  await Revision.create(grant); await assert.rejects(action(batch, 'approve', {}, manager), { statusCode: 403 });
  await Revision.create({ ...grant, version: 2, values: { ...grant.values, canApproveBilling: true } });
  batch = await action(batch, 'approve', {}, manager); assert.equal(batch.status, 'Approved');
  await assert.rejects(action(batch, 'finalize', {}, manager), { statusCode: 403 });
  await assert.rejects(workflow.previewRecalculation(manager, batch._id), { statusCode: 403 });
});
test('employees submit their own eligible work without receiving confidential amounts or rates', async () => {
  const f = await fixture(); let batch = await create(f, {}, f.employee);
  assert.equal(batch.financialAccess, false); assert.equal(batch.snapshot.summary.billing, undefined);
  batch = await action(batch, 'submit', {}, f.employee); assert.equal(batch.status, 'Submitted');
  await assert.rejects(action(batch, 'approve', {}, f.employee), { statusCode: 403 });
  const read = await workflow.getBilling(f.employee, batch._id), json = JSON.stringify(read);
  for (const secret of ['estimatedAmount', 'rateHundredths', 'sourceHash', '"currency"']) assert.equal(json.includes(secret), false);
  const foreign = await fixture(); await assert.rejects(workflow.getBilling(foreign.employee, batch._id), { statusCode: 403 });
});
test('concurrent approval and lost-response retries cannot duplicate a workflow event', async () => {
  const f = await fixture(); let batch = await create(f); batch = await action(batch, 'submit');
  const request = { action: 'approve', expectedVersion: batch.version, requestId: crypto.randomUUID(), reason: 'Approve reviewed work' };
  const results = await Promise.allSettled([workflow.actOnBilling(admin, batch._id, request), action(batch, 'approve')]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(results.find(row => row.status === 'rejected').reason.statusCode, 409);
  assert.equal(await Event.countDocuments({ batch: batch._id, action: 'approve' }), 1);
});
test('an audit failure rolls back status, claims and financial changes atomically', async t => {
  const f = await fixture(), batch = await create(f);
  t.mock.method(Event, 'create', async () => { throw new Error('Synthetic billing audit outage'); });
  await assert.rejects(action(batch, 'submit'), /Synthetic billing audit outage/);
  assert.equal((await Batch.findById(batch._id).lean()).status, 'Draft'); assert.equal(await Claim.countDocuments({ batch: batch._id }), 0);
});
test('optional approval allows Admin finalization of Submitted work, and corrections can credit work removed from billing', async () => {
  const f = await fixture({ approvalRequired: false }); let batch = await create(f); batch = await action(batch, 'submit'); batch = await action(batch, 'finalize');
  await Revision.create({ ...f.setting('classification', `${f.team._id}:task:${f.task._id}`, { category: 'productive', billable: false }), version: 2 });
  const preview = await workflow.previewRecalculation(admin, batch._id); assert.deepEqual(preview.deltas, [{ currency: 'USD', amount: -25 }]);
  batch = await action(batch, 'recalculate', { previewHash: preview.previewHash });
  const read = await workflow.getBilling(admin, batch._id); assert.deepEqual(read.adjustedTotals, [{ currency: 'USD', amount: 0 }]);
  assert.equal(amount(read.batch), 25, 'Original finalized amount is unchanged');
});
test('stale historical previews cannot record adjustments, and adjustment audit failures roll back everything', async t => {
  const f = await fixture(); let batch = await create(f); batch = await action(batch, 'submit'); batch = await action(batch, 'approve'); batch = await action(batch, 'finalize');
  await newRate(f, 3000); const stale = await workflow.previewRecalculation(admin, batch._id); await newRate(f, 3500, 3);
  await assert.rejects(action(batch, 'recalculate', { previewHash: stale.previewHash }), /Preview the historical adjustment again/);
  const preview = await workflow.previewRecalculation(admin, batch._id);
  t.mock.method(Event, 'create', async () => { throw new Error('Synthetic adjustment audit failure'); });
  await assert.rejects(action(batch, 'recalculate', { previewHash: preview.previewHash }), /Synthetic adjustment audit failure/);
  assert.equal(await Adjustment.countDocuments({ batch: batch._id }), 0); assert.equal((await Batch.findById(batch._id).lean()).lastAdjustment, null);
});
test('a team reviewer cannot verify conflicting foreign-team links or read their private source labels', async () => {
  const f = await fixture({ verified: false });
  const foreign = await Team.create({ teamName: crypto.randomUUID(), createdBy: admin._id });
  await Project.updateOne({ _id: f.project._id }, { $set: { teams: [foreign._id], projectName: 'Foreign confidential project' } });
  const batch = await create(f), manager = { _id: new mongoose.Types.ObjectId(), role: 'manager' };
  await Revision.create({ kind: 'access', key: `${manager._id}:${f.team._id}`, team: f.team._id, effectiveFrom: date, version: 1, changedBy: admin._id, reason: 'Scoped reviewer',
    values: { employee: String(manager._id), enabled: true, canViewBilling: true, canApproveBilling: true } });
  const read = await workflow.getBilling(manager, batch._id);
  assert.equal(read.batch.snapshot.entries.length, 0); assert.equal(JSON.stringify(read).includes('Foreign confidential project'), false);
  await assert.rejects(action(batch, 'verify-allocations', { verificationHash: batch.verificationHash, allocations: [{ timeLog: String(f.log._id), expectedVersion: 0 }] }, manager), { statusCode: 403 });
});
test('malformed action types and date values reject before changing billing state', async () => {
  const f = await fixture(), batch = await create(f);
  await assert.rejects(action(batch, ['submit']), { statusCode: 400 });
  await assert.rejects(action(batch, 'constructor'), { statusCode: 400 });
  await assert.rejects(create(f, { startDate: [date] }), { statusCode: 400 });
  assert.equal((await Batch.findById(batch._id).lean()).status, 'Draft'); assert.equal(await Claim.countDocuments({ batch: batch._id }), 0);
});
test('daily, weekly, monthly and employee reports reconcile to the same dashboard seconds and currency total', async () => {
  const f = await fixture();
  await Attendance.create({ employee: f.employee._id, date, status: 'Present' });
  await Policy.create({ employee: f.employee._id, revisions: [{ effectiveFrom: date, requiredSeconds: 28080, halfDayPercent: 50, changedBy: admin._id, changedAt: new Date() }] });
  const query = { startDate: date, endDate: date, employee: String(f.employee._id), team: String(f.team._id) };
  const normal = await productionReportData(admin, { ...query, view: 'employee' });
  for (const type of ['daily', 'weekly', 'monthly', 'employee', 'team', 'client', 'task', 'details']) {
    const report = await productionReport(admin, { ...query, basis: 'live', type });
    assert.equal(report.data.summary.find(row => row.label === 'Production').value, normal.summary.productionSeconds);
    assert.equal(report.data.summary.find(row => row.label === 'Expected').value, 28080);
    assert.equal(report.data.summary.find(row => row.label === 'Estimated USD').value, 25);
    assert.equal(report.data.rows.length, 1); assert.ok(report.exportToken);
  }
});
test('saved reports separate original finalized amounts, corrected totals and adjustment deltas', async () => {
  const f = await fixture(); let batch = await create(f); batch = await action(batch, 'submit'); batch = await action(batch, 'approve');
  const query = { startDate: date, endDate: date, employee: String(f.employee._id) };
  assert.equal((await productionReport(admin, { ...query, basis: 'approved' })).data.summary.find(row => row.type === 'money').value, 25);
  batch = await action(batch, 'finalize'); await newRate(f);
  const preview = await workflow.previewRecalculation(admin, batch._id); await action(batch, 'recalculate', { previewHash: preview.previewHash });
  const original = await productionReport(admin, { ...query, basis: 'finalized' }), adjusted = await productionReport(admin, { ...query, basis: 'adjusted' }), deltas = await productionReport(admin, { ...query, basis: 'adjustments' });
  assert.equal(original.data.summary.find(row => row.type === 'money').value, 25);
  assert.equal(adjusted.data.summary.find(row => row.type === 'money').value, 40);
  assert.equal(deltas.data.summary.find(row => row.type === 'money').value, 15);
  const employee = await productionReport(f.employee, { ...query, basis: 'finalized' });
  assert.equal(employee.data.columns.some(row => row.type === 'money'), false); assert.equal(employee.data.summary.some(row => row.type === 'money'), false);
});
test('optional Admin inclusion changes only opted-in live estimates and their signed downloads', async () => {
  const f = await fixture();
  await Revision.create({ ...f.setting('classification', `${f.team._id}:task:${f.task._id}`, { category: 'excluded', billable: false, reportOptionalBillable: true }), version: 2 });
  const query = { startDate: date, endDate: date, employee: String(f.employee._id), team: String(f.team._id), basis: 'live', type: 'employee' };
  const normal = await productionReport(admin, query), included = await productionReport(admin, { ...query, includeOptionalWork: 'true' });
  assert.equal(normal.data.summary.find(row => row.label === 'Production').value, 0);
  assert.equal(included.data.summary.find(row => row.label === 'Production').value, 3600);
  assert.equal(included.data.summary.find(row => row.label === 'Estimated USD').value, 25);
  assert.equal(included.data.filters.includeOptionalWork, true);
  assert.notEqual(included.dataHash, normal.dataHash);
  assert.equal((await authorizeReportExport(admin, included.exportToken, 'excel')).dataHash, included.dataHash);
  const unchanged = await productionReportData(admin, { ...query, includeOptionalWork: 'true' });
  assert.equal(unchanged.summary.productionSeconds, 0, 'Normal dashboards do not accept the report-only override');
  assert.equal((await Revision.findOne({ kind: 'classification', key: `${f.team._id}:task:${f.task._id}`, version: 2 }).lean()).values.category, 'excluded');
  await assert.rejects(productionReport(admin, { ...query, includeOptionalWork: 'yes' }), { statusCode: 400 });
  await assert.rejects(productionReport(admin, { ...query, basis: 'finalized', includeOptionalWork: 'true' }), { statusCode: 400 });
});

test('billing preparation rejects hours-only teams before creating periods', async () => {
  const f = await fixture();
  await Revision.create({ ...f.setting('team-billing', String(f.team._id), { billingEnabled: false, currency: null, approvalRequired: true }), version: 2 });
  const { prepareReview } = require('../src/services/production/billingReview');
  await assert.rejects(prepareReview(admin, { team: String(f.team._id), employee: 'all', startDate: date, endDate: date, reason: 'Verify disabled team', requestId: crypto.randomUUID() }), /Billing is disabled/);
  assert.equal(await Batch.countDocuments({ team: f.team._id }), 0);
});
test('hours-only reports omit monetary columns instead of reporting zero revenue', async () => {
  const f = await fixture(); await Revision.create({ ...f.setting('team-billing', String(f.team._id), { billingEnabled: false, currency: null, approvalRequired: true }), version: 2 });
  const report = await productionReport(admin, { startDate: date, endDate: date, employee: String(f.employee._id), basis: 'live', type: 'employee' });
  assert.equal(report.data.columns.some(row => row.type === 'money'), false); assert.equal(report.data.summary.some(row => row.type === 'money'), false);
  assert.equal(report.data.summary.find(row => row.label === 'Production').value, 3600);
});
test('saved billing periods are fully contained and never silently prorated', async () => {
  const f = await fixture(); let batch = await create(f, { endDate: addDateKeyDays(date, 1) }); batch = await action(batch, 'submit'); batch = await action(batch, 'approve'); await action(batch, 'finalize');
  const query = { startDate: date, employee: String(f.employee._id), basis: 'finalized' };
  assert.equal((await productionReport(admin, { ...query, endDate: date })).data.rows.length, 0);
  assert.equal((await productionReport(admin, { ...query, endDate: addDateKeyDays(date, 1) })).data.rows.length, 1);
});
test('export authorization is bound to the user, current financial scope and Export Reports permission', async () => {
  const f = await fixture(), query = { startDate: date, endDate: date, basis: 'live', type: 'employee' };
  const report = await productionReport(f.employee, query);
  assert.equal((await authorizeReportExport(f.employee, report.exportToken, 'excel')).dataHash, report.dataHash);
  await assert.rejects(authorizeReportExport({ ...f.employee, _id: admin._id }, report.exportToken, 'excel'), { statusCode: 403 });
  await assert.rejects(authorizeReportExport(f.employee, `${report.exportToken}x`, 'pdf'), { statusCode: 403 });
  await assert.rejects(authorizeReportExport({ ...f.employee, permissionOverrides: { revoked: ['export_reports'] } }, report.exportToken, 'pdf'), { statusCode: 403 });
  await Revision.create({ ...f.setting('access', `${f.employee._id}:${f.team._id}`, { employee: String(f.employee._id), enabled: true, canViewBilling: true }), version: 1 });
  await assert.rejects(authorizeReportExport(f.employee, report.exportToken, 'excel'), /access changed/);
});
test('obsolete rate API rejects duplicate configuration and finalized billing uses explicit adjustment', async () => {
  const f = await fixture(); let batch = await create(f); batch = await action(batch, 'submit'); batch = await action(batch, 'approve'); batch = await action(batch, 'finalize');
  const controller = require('../src/modules/production/productionSettingsController');
  for (const handler of [controller.save, controller.historicalSave]) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { kind: 'rate' }, body: {}, user: admin }, res);
    assert.equal(res.code, 409); assert.match(res.body.message, /employee project rates/);
  }
  await newRate(f);
  assert.equal(amount((await workflow.getBilling(admin, batch._id)).batch), 25);
  assert.deepEqual((await workflow.previewRecalculation(admin, batch._id)).deltas, [{ currency: 'USD', amount: 15 }]);
});

test('team review prepares only active home-team employees and exports saved work with scoped money', async () => {
  const { prepareReview, reviewReport } = require('../src/services/production/billingReview');
  const f = await fixture(), foreign = await fixture();
  const second = { _id: new mongoose.Types.ObjectId(), employeeId: crypto.randomUUID(), fullName: 'Second review member', email: `${crypto.randomUUID()}@example.invalid`, role: 'employee', team: f.team._id, isActive: true, projectRates: [{ project: f.project._id, chargeRate: 35 }] };
  await Employee.collection.insertOne(second);
  const log = await Log.create({ employee: second._id, project: f.project._id, task: f.task._id, startedAt: `${date}T11:00:00Z`, stoppedAt: `${date}T12:00:00Z`, status: 'stopped', isActiveTimer: false });
  await Allocation.create({ timeLog: log._id, team: f.team._id, version: 1, changedBy: admin._id, reason: 'Verified second employee work' });
  const request = { team: String(f.team._id), employee: 'all', startDate: date, endDate: date, reason: 'Prepare team for review', requestId: crypto.randomUUID() };
  const before = await Batch.countDocuments();
  const result = await prepareReview(admin, request); assert.equal(result.ids.length, 2);
  assert.equal(await Batch.countDocuments(), before + 2);
  assert.deepEqual((await prepareReview(admin, request)).ids.sort(), result.ids.slice().sort());
  const report = await reviewReport(admin, result.ids);
  assert.equal(report.items.length, 2); assert.ok(report.items.every(row => row.status === 'Draft'));
  assert.equal(report.data.summary.find(row => row.label === 'Eligible work').value, 7200);
  assert.equal(report.data.summary.find(row => row.label === 'Saved estimate USD').value, 60);
  assert.ok(report.data.columns.some(row => row.label === 'Hourly rate'));
  assert.equal(report.data.rows.length, 2); assert.equal(report.canExport, true);
  assert.equal((await authorizeReportExport(admin, report.exportToken, 'excel')).dataHash, report.dataHash);
  await assert.rejects(prepareReview(f.employee, request), { statusCode: 403 });
  await assert.rejects(reviewReport(foreign.employee, result.ids), { statusCode: 403 });
  const own = await reviewReport(f.employee, [String(report.items.find(row => String(row.employee) === String(f.employee._id))._id)]);
  assert.equal(own.data.columns.some(row => row.label === 'Hourly rate'), false);
  assert.equal(JSON.stringify(own).includes('estimatedAmount'), false);
  const old = report.data.summary.find(row => row.label === 'Saved estimate USD').value;
  await newRate(f, 9900);
  assert.equal((await reviewReport(admin, result.ids)).data.summary.find(row => row.label === 'Saved estimate USD').value, old, 'Review export retains the saved estimate until explicit refresh');
});
test('team preparation rolls back every draft when a later employee audit fails', async t => {
  const { prepareReview } = require('../src/services/production/billingReview');
  const f = await fixture();
  await Employee.collection.insertOne({ _id: new mongoose.Types.ObjectId(), employeeId: crypto.randomUUID(), fullName: 'Rollback member', role: 'employee', team: f.team._id, isActive: true });
  const original = Event.create; let calls = 0;
  t.mock.method(Event, 'create', function (...args) { if (++calls === 2) throw new Error('Synthetic second audit failure'); return original.apply(this, args); });
  await assert.rejects(prepareReview(admin, { team: String(f.team._id), employee: 'all', startDate: date, endDate: date, reason: 'Atomic review preparation', requestId: crypto.randomUUID() }), /Synthetic second audit failure/);
  assert.equal(await Batch.countDocuments({ team: f.team._id }), 0);
});
