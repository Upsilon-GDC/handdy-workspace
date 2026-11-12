const Batch = require('../../models/ProductionBillingBatch');
const Team = require('../../models/Team');
const Revision = require('../../models/ProductionSettingsRevision');
const { productionAccess, scopedEmployees } = require('./access');
const { createBilling, transaction, assertScope, publicBatch } = require('./billingWorkflow');
const { reportExportToken } = require('./reportTokens');
const { column } = require('./reportTables');
const { operation } = require('./billingRules');
const { objectId, fail, effectiveRevision } = require('./settingsValidation');
const { getBillingDateRange, addDateKeyDays } = require('../../utils/billingUtils');
const id = value => String(value?._id || value || '');
const issueLabels = { 'hours-only-team': 'Team billing is disabled', 'no-billable-work': 'No eligible billable work',
  'missing-or-mismatched-rate': 'Employee project rate is missing', 'billing-configuration-needs-review': 'Billing configuration needs review',
  'running-timer': 'Timer is still running', 'unverified-team-allocation': 'Verify team assignments', 'needs-team-allocation': 'Assign the correct team',
  'needs-activity-classification': 'Classify the activity', 'overlapping-work-needs-review': 'Review overlapping work', 'future-period': 'Period is in the future',
  'invalid-pause': 'Review pause records', 'invalid-or-empty-interval': 'Review recorded time' };

async function prepareReview(user, body) {
  const access = await productionAccess(user), team = objectId(body.team, 'team');
  const input = operation({ ...body, expectedVersion: 1 });
  try { getBillingDateRange(body.startDate, body.endDate, process.env.APP_TIMEZONE || 'Asia/Kolkata'); } catch (error) { throw fail(error.message); }
  if (access.teamIds && !access.teamIds.includes(team)) throw fail('Team is outside your billing access.', 403);
  if (!await Team.exists({ _id: team, isActive: true })) throw fail('Choose an active team.', 404);
  const billingSettings = await Revision.find({ kind: 'team-billing', key: team, effectiveFrom: { $lte: body.endDate } }).select('effectiveFrom version values.billingEnabled').lean();
  let enabled = false;
  for (let date = body.startDate; date <= body.endDate; date = addDateKeyDays(date, 1)) {
    if (effectiveRevision(billingSettings, date)?.values.billingEnabled === true) { enabled = true; break; }
  }
  if (!enabled) throw fail('Billing is disabled for this team in the selected dates. Enable it in Production settings before preparing billing.');
  const roster = await scopedEmployees(access, body.employee);
  const selected = body.employee === 'all' ? roster.filter(row => row.isActive && id(row.team) === team) : roster;
  if (!selected.length) throw fail('No active employees are available in this team.');
  if (selected.length > 100) throw fail('Prepare at most 100 employees in one report. Choose an individual employee.', 413);
  if (body.employee === 'all' && !['admin', 'alpha'].includes(user.role) && !access.reviewTeamIds.includes(team)) throw fail('Team billing preparation requires an authorized reviewer.', 403);
  // One transaction: an unavailable employee or failed audit cannot leave a
  // partly prepared team report. Existing periods retain their saved state.
  const ids = await transaction(async session => {
    const result = [];
    for (const employee of selected) {
      const batch = await createBilling(user, { ...body, employee: id(employee), reason: input.reason,
        requestId: `${input.requestId.slice(0, 70)}-${id(employee)}` }, { session, access });
      result.push(id(batch));
    }
    return result;
  });
  return { ids };
}

async function reviewReport(user, requestedIds) {
  if (!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.length > 100) throw fail('Choose 1 to 100 prepared billing periods.');
  const ids = [...new Set(requestedIds.map(value => objectId(value, 'billing period')))];
  const access = await productionAccess(user);
  const batches = await Batch.find({ _id: { $in: ids } }).sort({ 'snapshot.employeeName': 1, _id: 1 }).lean();
  if (batches.length !== ids.length) throw fail('Some billing periods are unavailable. Refresh the report.', 404);
  for (const batch of batches) await assertScope(user, access, batch);
  if (new Set(batches.map(row => [id(row.team), row.startDate, row.endDate, row.timezone].join(':'))).size !== 1) throw fail('Choose periods for the same team and dates.');
  const items = batches.map(batch => publicBatch(batch, user, access));
  if (items.reduce((sum, row) => sum + Math.max(1, row.snapshot.lines.length), 0) > 5000) throw fail('Use a shorter period to review at most 5000 work rows.', 413);
  const financial = items.some(row => row.financialAccess);
  const columns = [column('employee', 'Employee'), column('team', 'Team'), column('status', 'Review status'), column('date', 'Work date'),
    column('startedAt', 'Start'), column('stoppedAt', 'End'), column('client', 'Client'), column('project', 'Project'), column('task', 'Task'), column('hours', 'Eligible work (h:mm:ss)', 'duration'),
    ...(financial ? [column('rate', 'Hourly rate', 'number'), column('currency', 'Currency')] : []), column('issues', 'Review items')];
  const rows = [], totals = new Map(), workDetails = [];
  for (const batch of items) {
    workDetails.push(...batch.snapshot.lines.map(line => ({ employee: id(batch.employee), employeeName: batch.snapshot.employeeName,
      client: line.client, clientName: line.clientName, project: line.project, projectName: line.projectName, task: line.task, taskName: line.taskName,
      date: line.date, startedAt: line.startedAt, stoppedAt: line.stoppedAt, actualSeconds: line.actualSeconds,
      ...(line.billing ? { billing: line.billing } : {}) })));
    const issues = batch.snapshot.blockers.map(code => issueLabels[code] || code).join('; ') || 'Ready for review';
    for (const line of batch.snapshot.lines.length ? batch.snapshot.lines : [null]) rows.push([
      batch.snapshot.employeeName, batch.snapshot.teamName, batch.status, line?.date || '', line?.startedAt || '', line?.stoppedAt || '', line?.clientName || '', line?.projectName || '', line?.taskName || 'No eligible billable work', line?.actualSeconds || 0,
      ...(financial ? [line?.billing?.rateHundredths ? line.billing.rateHundredths / 100 : batch.financialAccess && line ? 'Missing Rate' : 'Not applicable', line?.billing?.currency || ''] : []), issues,
    ]);
    for (const estimate of batch.snapshot.summary.billing?.estimates || []) {
      const total = totals.get(estimate.currency) || { amount: 0, known: false, complete: true };
      if (estimate.estimatedAmount !== null) { total.amount += estimate.estimatedAmount; total.known = true; }
      total.complete &&= estimate.complete;
      totals.set(estimate.currency, total);
    }
  }
  const first = items[0];
  const currencies = [...totals.keys()].sort();
  const employeeSummary = { columns: [column('employee', 'Employee'), column('team', 'Team'), column('status', 'Review status'),
    column('hours', 'Eligible work (h:mm:ss)', 'duration'), ...currencies.map(currency => column(`amount_${currency}`, `Saved estimate ${currency}`, 'money', { currency })), column('issues', 'Review items')],
    rows: items.map(batch => [batch.snapshot.employeeName, batch.snapshot.teamName, batch.status, batch.snapshot.summary.eligibleClientWorkSeconds,
      ...currencies.map(currency => { const estimate = batch.snapshot.summary.billing?.estimates?.find(row => row.currency === currency); return estimate ? estimate.estimatedAmount : 'Not applicable'; }),
      batch.snapshot.blockers.map(code => issueLabels[code] || code).join('; ') || 'Ready for review']) };
  const data = { title: 'Billing review report', basis: 'billing-review', basisLabel: 'Saved billing estimates for review',
    period: { startDate: first.startDate, endDate: first.endDate, timezone: first.timezone }, asOf: new Date().toISOString(),
    filters: { team: id(first.team), employee: items.length === 1 ? id(first.employee) : 'all' },
    selection: { team: first.snapshot.teamName, employee: items.length === 1 ? first.snapshot.employeeName : `${items.length} team employees` },
    columns, rows, employeeSummary, workDetails, summary: [{ label: 'Employees', type: 'number', value: items.length },
      { label: 'Eligible work', type: 'duration', value: items.reduce((sum, row) => sum + row.snapshot.summary.eligibleClientWorkSeconds, 0) },
      { label: 'Periods needing attention', type: 'number', value: items.filter(row => row.snapshot.blockers.length).length },
      ...[...totals].map(([currency, total]) => ({ label: `Saved estimate ${currency}${total.complete ? '' : ' (incomplete)'}`, type: 'money', currency, value: total.known ? Number(total.amount.toFixed(new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits)) : null }))], warnings: [],
    notes: ['This report uses saved employee billing periods, including Draft and Submitted work. Preparation does not approve or finalize billing.',
      'Review missing rates, classifications and team assignments before submission. Training and Break / Idle are excluded.',
      'Totals sum saved employee estimates. Missing-rate subtotals are incomplete. Currencies stay separate.',
      'For finalized periods this report shows the original saved billing; historical adjustments are reported separately.'] };
  if (Buffer.byteLength(JSON.stringify(data)) > 8000000) throw fail('Use a shorter billing review period.', 413);
  return { items: items.map(row => { delete row.snapshot.lines; delete row.snapshot.entries; return row; }), data, ...await reportExportToken(user, data) };
}
module.exports = { prepareReview, reviewReport };
