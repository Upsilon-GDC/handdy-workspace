const Batch = require('../../models/ProductionBillingBatch');
const Adjustment = require('../../models/ProductionBillingAdjustment');
const Team = require('../../models/Team');
const { productionReportData } = require('../../modules/production/productionReportController');
const { productionAccess, scopedEmployees } = require('./access');
const { monetary } = require('./billingWorkflow');
const { column, financialColumns, financialValues, liveReportTable } = require('./reportTables');
const { reportExportToken } = require('./reportTokens');
const { getBillingDateRange } = require('../../utils/billingUtils');
const { fail, objectId } = require('./settingsValidation');
const names = { daily: 'Daily production', weekly: 'Weekly production', monthly: 'Monthly production', employee: 'Employee production',
  team: 'Team production', client: 'Client and project production', task: 'Task production', details: 'Employee work details' };
const bases = { live: 'Live production estimates', approved: 'Saved approved billing', finalized: 'Original finalized billing',
  adjustments: 'Recorded historical adjustments', adjusted: 'Finalized billing after adjustments' };
const id = value => String(value?._id || value || '');
function addCurrencyTotals(records) {
  const totals = new Map();
  for (const row of records) if (row.billing?.applicable) for (const amount of row.billing.estimates || []) {
    if (amount.estimatedAmount == null) continue;
    const currency = amount.currency, digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits, factor = 10 ** digits;
    const value = (totals.get(currency)?.minor || 0n) + BigInt(Math.round(amount.estimatedAmount * factor));
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw fail('Narrow the report to keep currency totals within exact numeric precision.', 413);
    totals.set(currency, { minor: value, factor });
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, { minor, factor }]) => ({ currency, estimatedAmount: Number(minor) / factor, complete: true }));
}
async function savedReport(user, query, basis) {
  const access = await productionAccess(user), roster = await scopedEmployees(access);
  let employees = roster;
  if (query.employee && query.employee !== 'all') {
    const requested = objectId(query.employee, 'employee');
    employees = roster.filter(row => id(row) === requested);
    if (!employees.length && access.mode !== 'company') throw fail('Employee is outside your Production access.', 403);
  }
  const filter = { ...(access.mode === 'company' ? {} : { employee: { $in: employees.map(row => row._id) } }), status: basis === 'approved' ? 'Approved' : 'Finalized',
    startDate: { $gte: query.startDate }, endDate: { $lte: query.endDate } };
  if (query.employee && query.employee !== 'all') filter.employee = objectId(query.employee, 'employee');
  if (access.teamIds) filter.team = { $in: access.teamIds };
  if (query.team && query.team !== 'all') {
    const team = objectId(query.team, 'team');
    if (access.teamIds && !access.teamIds.includes(team)) throw fail('Team is outside your Production access.', 403);
    filter.team = team;
  }
  for (const key of ['client', 'project', 'task']) if (query[key] && query[key] !== 'all') throw fail('Saved billing reports use employee, team and period filters.');
  const batches = await Batch.find(filter).select('employee team startDate endDate status lastAdjustment snapshot.summary snapshot.employeeName snapshot.teamName')
    .sort({ startDate: 1, _id: 1 }).limit(5001).maxTimeMS(30000).lean();
  if (batches.length > 5000) throw fail('Narrow the report to at most 5000 saved periods.', 413);
  const references = basis === 'adjusted' ? batches.map(row => row.lastAdjustment).filter(Boolean) : [];
  const changes = basis === 'adjustments' ? await Adjustment.find({ batch: { $in: batches.map(row => row._id) } })
    .select('batch actor reason version deltas createdAt').populate('actor', 'fullName employeeId').sort({ createdAt: 1, _id: 1 }).limit(5001).maxTimeMS(30000).lean()
    : references.length ? await Adjustment.find({ _id: { $in: references } }).select('batch resultSnapshot.summary').lean() : [];
  if (changes.length > 5000) throw fail('Narrow the report to at most 5000 adjustments.', 413);
  const latest = new Map(changes.map(row => [id(row), row])), batchMap = new Map(batches.map(row => [id(row), row]));
  const records = basis === 'adjustments' ? changes.map(change => {
    const batch = batchMap.get(id(change.batch));
    return { employee: batch.snapshot.employeeName, team: batch.snapshot.teamName, start: batch.startDate, end: batch.endDate,
      changedAt: change.createdAt.toISOString(), actor: change.actor?.fullName || 'Unavailable administrator', reason: change.reason,
      billing: monetary(user, access, batch) ? { applicable: true, estimates: change.deltas.map(row => ({ currency: row.currency, estimatedAmount: row.amount, complete: true })) } : undefined };
  }) : batches.map(batch => {
    const summary = basis === 'adjusted' && batch.lastAdjustment ? latest.get(id(batch.lastAdjustment))?.resultSnapshot.summary : batch.snapshot.summary;
    if (!summary) throw fail('A saved adjustment is missing. Review this billing period before reporting.', 409);
    let billing = monetary(user, access, batch) ? summary.billing : undefined;
    if (billing && basis === 'adjusted') {
      const currencies = [...new Set([...(batch.snapshot.summary.billing?.estimates || []).map(row => row.currency), ...(billing.estimates || []).map(row => row.currency)])];
      billing = { ...billing, applicable: true, estimates: currencies.map(currency => ({ currency,
        estimatedAmount: billing.estimates?.find(row => row.currency === currency)?.estimatedAmount || 0, complete: true })) };
    }
    return { employee: batch.snapshot.employeeName, team: batch.snapshot.teamName, start: batch.startDate, end: batch.endDate, status: batch.status,
      eligibleClientWorkSeconds: summary.eligibleClientWorkSeconds, billing };
  });
  const amountLabel = basis === 'adjustments' ? 'Adjustment' : basis === 'adjusted' ? 'Adjusted' : basis === 'finalized' ? 'Finalized' : 'Approved';
  const cols = [column('employee', 'Employee'), column('team', 'Team'), column('start', 'Period from'), column('end', 'Period to'),
    ...(basis === 'adjustments' ? [column('changedAt', 'Recorded at'), column('actor', 'Recorded by'), column('reason', 'Reason')]
      : [column('status', 'Status'), column('eligibleClientWorkSeconds', 'Eligible work (h:mm:ss)', 'duration')]), ...financialColumns(records, amountLabel)];
  const totals = addCurrencyTotals(records);
  const summary = [{ label: basis === 'adjustments' ? 'Adjustments' : 'Saved periods', type: 'number', value: records.length },
    ...(basis === 'adjustments' ? [] : [{ label: 'Eligible work', type: 'duration', value: records.reduce((sum, row) => sum + row.eligibleClientWorkSeconds, 0) }]),
    ...totals.map(row => ({ label: `${amountLabel} ${row.currency}`, type: 'money', currency: row.currency, value: row.estimatedAmount }))];
  const rows = records.map(row => { const values = { ...row, ...financialValues(row, cols) }; return cols.map(col => values[col.key] ?? ''); });
  const teams = await Team.find(access.teamIds ? { _id: { $in: access.teamIds } } : access.mode === 'personal'
    ? { _id: { $in: [...new Set([...roster.map(row => id(row.team)), ...batches.map(row => id(row.team))].filter(Boolean))] } } : {}).select('teamName').sort('teamName').lean();
  return { title: bases[basis], columns: cols, rows, summary, warnings: [],
    choices: { employees: roster, teams, clients: [], projects: [], tasks: [] },
    selection: { team: query.team && query.team !== 'all' ? teams.find(row => id(row) === query.team)?.teamName || 'Selected team' : 'All available teams',
      employee: query.employee && query.employee !== 'all' ? employees[0]?.fullName || 'Archived employee' : 'All available employees' }, notes: [
    'Includes saved billing periods fully contained in the selected dates. Saved periods are not prorated.',
    basis === 'approved' ? 'Approved snapshots are provisional until finalized. Current timer or rate changes do not rewrite this saved report.'
      : basis === 'finalized' ? 'Original finalized snapshots are preserved. Historical adjustments are excluded from these original amounts.'
        : basis === 'adjustments' ? 'Shows recorded correction deltas for the selected saved periods. Original finalized amounts are not repeated.'
          : 'Uses each finalized period and its latest recorded correction. Unrecorded source changes are excluded.',
    'Currencies are reported separately. No exchange conversion is applied.' ] };
}
async function productionReport(user, query) {
  if (typeof query.startDate !== 'string' || typeof query.endDate !== 'string') throw fail('Choose valid report dates.');
  const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
  try { getBillingDateRange(query.startDate, query.endDate, timezone); } catch (error) { throw fail(error.message); }
  const basis = query.basis || 'live';
  if (!Object.hasOwn(bases, basis) || typeof basis !== 'string') throw fail('Choose a valid report basis.');
  if (query.includeOptionalWork !== undefined && !['true', 'false'].includes(query.includeOptionalWork)) throw fail('Choose whether to include optional Admin work.');
  const includeOptionalWork = query.includeOptionalWork === 'true';
  if (includeOptionalWork && basis !== 'live') throw fail('Optional Admin work applies to live reports. Saved billing uses its recorded classifications.');
  let data;
  if (basis === 'live') {
    const type = query.type || 'employee';
    if (typeof type !== 'string' || !Object.hasOwn(names, type)) throw fail('Choose a valid Production report.');
    const report = await productionReportData(user, { ...query, view: type === 'daily' ? 'overview' : type, includeChoices: 'true' }, { allRows: true, includeOptionalWork });
    data = { title: names[type], ...liveReportTable(report, type), warnings: report.warnings,
      choices: report.choices, selection: report.selectionLabels,
      asOf: report.asOf, notes: [ 'Live estimates are provisional and are separate from approved or finalized billing.',
        includeOptionalWork ? 'Optional Admin work is included in production and billing estimates using employee project rates. Training and Break / Idle remain excluded.' : 'Optional Admin work is excluded from production and billing estimates.',
        'Targets follow attendance and employee working-hour settings. Client, project and task filters narrow work, not the daily target.',
        'Remaining targets do not use one employee’s overtime to cover another employee’s shortfall.',
        'Achievement uses production against configured attendance targets. Work without an applicable quota stays in production totals but does not inflate achievement.',
        'Totals use full interval precision before currency rounding. Rounded row amounts may differ from the independently rounded report total.',
        'Missing Rate means unpriced work; partial estimates show only the known subtotal. Currencies are kept separate.' ] };
  } else data = await savedReport(user, query, basis);
  const choices = data.choices; delete data.choices;
  data = { ...data, basis, basisLabel: bases[basis], period: { startDate: query.startDate, endDate: query.endDate, timezone },
    asOf: data.asOf || new Date().toISOString(), filters: { ...Object.fromEntries(['team', 'employee', 'client', 'project', 'task'].map(key => [key, query[key] || 'all'])), includeOptionalWork } };
  if (Buffer.byteLength(JSON.stringify(data)) > 8_000_000) throw fail('Narrow the report before exporting this much data.', 413);
  return { data, choices, ...await reportExportToken(user, data) };
}
module.exports = { productionReport, savedReport, addCurrencyTotals };
