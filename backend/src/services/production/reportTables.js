const durationColumns = [['expectedSeconds', 'Expected'], ['actualSeconds', 'Tracked'], ['productionSeconds', 'Production'],
  ['eligibleClientWorkSeconds', 'Eligible client work'], ['nonBillableProductiveSeconds', 'Non-billable production'],
  ['trainingSeconds', 'Training'], ['breakIdleSeconds', 'Break / Idle'], ['excludedSeconds', 'Other excluded'],
  ['unclassifiedSeconds', 'Unclassified'], ['unallocatedSeconds', 'Unallocated'], ['conflictSeconds', 'Conflicting work'],
  ['remainingSeconds', 'Remaining target'], ['overtimeSeconds', 'Overtime']];
const column = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
function financialColumns(records, label) {
  const currencies = [...new Set(records.flatMap(row => row.billing?.applicable ? (row.billing.estimates || []).map(value => value.currency) : []))].sort();
  if (currencies.length > 6) throw Object.assign(new Error('Select a team or shorter period to report at most six currencies.'), { statusCode: 413 });
  return currencies.map(currency => column(`amount_${currency}`, `${label} ${currency}`, 'money', { currency }));
}
function financialValues(record, columns) {
  const values = {};
  for (const col of columns.filter(row => row.type === 'money')) {
    const amount = record.billing?.applicable ? record.billing.estimates?.find(row => row.currency === col.currency) : null;
    values[col.key] = !amount ? 'Not applicable' : amount.estimatedAmount == null ? 'Missing Rate' : amount.estimatedAmount;
  }
  values.billingStatus = !record.billing?.applicable ? 'Not applicable' : record.billing.estimates?.some(row => !row.complete) ? 'Incomplete estimate' : 'Complete';
  values.billableSeconds = record.billing?.applicable ? record.billing.billableSeconds : 'Not applicable';
  return values;
}
function liveReportTable(report, type) {
  const hasTarget = ['daily', 'weekly', 'monthly', 'employee', 'team'].includes(type);
  const identities = type === 'employee' ? [column('fullName', 'Employee'), column('employeeId', 'Employee ID'), column('teamName', 'Home team')]
    : type === 'team' ? [column('teamName', 'Team'), column('employeeCount', 'Employees', 'number')]
    : type === 'client' ? [column('clientName', 'Client'), column('client', 'Client reference'), column('projectName', 'Project'), column('projectCode', 'Project code'), column('employeeCount', 'Employees', 'number')]
    : type === 'task' ? [column('taskName', 'Task'), column('taskCode', 'Task code'), column('employeeCount', 'Employees', 'number')]
    : type === 'details' ? [column('date', 'Date'), column('employeeName', 'Employee'), column('teamName', 'Team'), column('clientName', 'Client'), column('projectName', 'Project'), column('taskName', 'Task'), column('taskCode', 'Task code'), column('category', 'Activity')]
    : type === 'daily' ? [column('date', 'Date')] : [column('periodStart', 'From'), column('periodEnd', 'To')];
  const metrics = durationColumns.filter(([key]) => !['unclassifiedSeconds', 'unallocatedSeconds', 'conflictSeconds', 'excludedSeconds', 'overtimeSeconds'].includes(key)
    && (hasTarget || !['expectedSeconds', 'remainingSeconds'].includes(key)));
  // Detailed rows already distinguish categories. Keep that view readable.
  const chosen = type === 'details' ? metrics.filter(([key]) => ['actualSeconds', 'productionSeconds'].includes(key)) : metrics;
  const cols = [...identities, ...chosen.map(([key, label]) => column(key, `${label} (h:mm:ss)`, 'duration')),
    ...(hasTarget ? [column('achievementPercent', 'Achievement', 'percent')] : [])];
  const financial = report.summary.billing?.applicable;
  if (financial) {
    if (type === 'details') cols.push(column('billingState', 'Billing status'), column('rate', 'Hourly rate'), column('currency', 'Currency'));
    else cols.push(column('billableSeconds', 'Billable (h:mm:ss)', 'duration'), ...financialColumns([report.summary, ...report.rows], 'Estimated'), column('billingStatus', 'Estimate status'));
  }
  const rows = report.rows.map(row => {
    const values = { ...row, ...financialValues(row, cols), category: row.category === 'break-idle' ? 'Break / Idle' : row.category,
      billingState: row.billing?.applicable ? row.billing.status : 'Not applicable', rate: row.billing?.rateHundredths ? row.billing.rateHundredths / 100 : row.billing?.status === 'missing-rate' ? 'Missing Rate' : 'Not applicable', currency: row.billing?.currency || 'Not applicable' };
    return cols.map(col => values[col.key] ?? (col.type === 'percent' ? null : col.type === 'duration' ? 0 : ''));
  });
  const summary = [column('employeeCount', 'Employees', 'number'), ...durationColumns.map(([key, label]) => column(key, label, 'duration')),
    column('targetEligibleProductionSeconds', 'Production against configured targets', 'duration'),
    column('achievementPercent', 'Production achievement', 'percent')].map(col => ({ ...col, value: report.summary[col.key] ?? null }));
  if (financial) {
    summary.push({ label: 'Billable hours', type: 'duration', value: report.summary.billing.billableSeconds },
      { label: 'Billing utilization', type: 'percent', value: report.summary.billing.utilizationPercent });
    for (const row of report.summary.billing.estimates) summary.push({ label: `Estimated ${row.currency}${row.complete ? '' : ' (incomplete)'}`, type: 'money', currency: row.currency, value: row.estimatedAmount });
  }
  return { columns: cols, rows, summary };
}
module.exports = { column, financialColumns, financialValues, liveReportTable };
