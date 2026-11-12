import { todayDateKey, addDaysToDateKey, dayOfWeekOfDateKey } from './appDate.js';

export function billingPeriodDates(period, today = todayDateKey()) {
  if (period === 'yesterday') { const date = addDaysToDateKey(today, -1); return [date, date]; }
  if (period === 'this-week' || period === 'last-week') {
    const monday = addDaysToDateKey(today, -((dayOfWeekOfDateKey(today) + 6) % 7));
    return period === 'last-week' ? [addDaysToDateKey(monday, -7), addDaysToDateKey(monday, -1)] : [monday, today];
  }
  if (period === 'this-month') return [`${today.slice(0, 8)}01`, today];
  if (period === 'last-month') { const end = addDaysToDateKey(`${today.slice(0, 8)}01`, -1); return [`${end.slice(0, 8)}01`, end]; }
  return [today, today];
}

export function billingLineTotals(lines) {
  const currencies = new Map();
  for (const line of lines) {
    const billing = line.billing;
    if (!billing?.applicable || !billing.currency) continue;
    const bucket = currencies.get(billing.currency) || { numerator: 0n, missing: false, known: false };
    if (billing.status === 'estimated' && Number.isSafeInteger(billing.rateHundredths)) {
      bucket.numerator += BigInt(Math.round(line.actualSeconds * 1000)) * BigInt(billing.rateHundredths); bucket.known = true;
    } else bucket.missing = true;
    currencies.set(billing.currency, bucket);
  }
  return [...currencies].map(([currency, bucket]) => {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    const factor = 10n ** BigInt(digits), divisor = 360000000n;
    return { currency, complete: !bucket.missing, amount: bucket.known ? Number((bucket.numerator * factor + divisor / 2n) / divisor) / Number(factor) : null };
  });
}

export function billingReviewGroups(lines = []) {
  const projects = new Map(), days = new Map();
  for (const line of lines) {
    const projectKey = JSON.stringify([line.project, line.client]);
    if (!projects.has(projectKey)) projects.set(projectKey, { key: projectKey, name: line.projectName, clientName: line.clientName, lines: [], tasks: new Map() });
    const project = projects.get(projectKey); project.lines.push(line);
    const taskKey = JSON.stringify([line.employee, line.task, line.billing?.rateHundredths, line.billing?.currency]);
    if (!project.tasks.has(taskKey)) project.tasks.set(taskKey, { ...line, key: taskKey, lines: [] });
    project.tasks.get(taskKey).lines.push(line);
    if (!days.has(line.date)) days.set(line.date, { date: line.date, lines: [] });
    days.get(line.date).lines.push(line);
  }
  const total = rows => ({ seconds: rows.reduce((sum, row) => sum + row.actualSeconds, 0), amounts: billingLineTotals(rows) });
  return {
    projects: [...projects.values()].map(project => ({ ...project, ...total(project.lines), tasks: [...project.tasks.values()].map(task => ({ ...task, ...total(task.lines) })) })),
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).map(day => ({ ...day, ...total(day.lines) })),
  };
}

export function billingProjectTable(lines = []) {
  const { projects } = billingReviewGroups(lines), financial = lines.some(line => line.billing);
  const currencies = [...new Set(lines.map(line => line.billing?.currency).filter(Boolean))].sort();
  return { columns: [{ key: 'employee', label: 'Employee', type: 'text' }, { key: 'project', label: 'Project', type: 'text' },
    { key: 'client', label: 'Client', type: 'text' }, { key: 'task', label: 'Task', type: 'text' }, { key: 'hours', label: 'Eligible work (h:mm:ss)', type: 'duration' },
    ...(financial ? [{ key: 'rate', label: 'Hourly rate', type: 'number' }, { key: 'currency', label: 'Currency', type: 'text' },
      ...currencies.map(currency => ({ key: `amount_${currency}`, label: `Billable ${currency}`, type: 'money', currency }))] : [])],
    rows: projects.flatMap(project => project.tasks.map(task => [task.employeeName, project.name, project.clientName || '', task.taskName, task.seconds,
      ...(financial ? [task.billing?.rateHundredths ? task.billing.rateHundredths / 100 : 'Missing Rate', task.billing?.currency || '',
        ...currencies.map(currency => task.amounts.find(row => row.currency === currency)?.amount ?? 'Missing Rate')] : [])])) };
}
