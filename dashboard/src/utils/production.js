import { todayDateKey, addDaysToDateKey, dayOfWeekOfDateKey } from './appDate.js';
export function productionTaskChoices(rows = []) {
  const unique = [...new Map(rows.map(row => [String(row._id), row])).values()];
  const name = row => row.taskName.trim().replace(/\s+/g, ' ').toLowerCase();
  const counts = new Map();
  for (const row of unique) counts.set(name(row), (counts.get(name(row)) || 0) + 1);
  return unique.map(row => ({ ...row, optionLabel: `${row.taskName}${row.deletedAt || row.isActive === false ? ' (Archived)' : ''}${counts.get(name(row)) > 1 ? ` · ${row.project?.projectName || 'Shared task'} · ${row.taskCode || String(row._id).slice(-6)}` : ''}` }));
}
export function productionClientChoices(rows = []) {
  const unique = [...new Map(rows.map(row => [String(row._id), row])).values()];
  const key = row => `${row.status || 'Active'}:${row.clientName.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  const counts = new Map();
  for (const row of unique) counts.set(key(row), (counts.get(key(row)) || 0) + 1);
  return unique.map(row => ({ ...row, optionLabel: `${row.clientName}${row.status === 'Inactive' ? ' (Inactive)' : ''}${row.historicalOnly ? ' (Previous team rate)' : ''}${counts.get(key(row)) > 1 ? ` · ${row.company ? `${row.company} · ` : ''}Record ${String(row._id).slice(-6)}` : ''}` }));
}
export function productionTeamEmployees(employees = [], team = 'all') {
  if (!team || team === 'all') return employees;
  return employees.filter(employee => String(employee.team?._id || employee.team || '') === String(team));
}
export function productionDates(period, today = todayDateKey()) {
  if (period === 'week') return [addDaysToDateKey(today, -((dayOfWeekOfDateKey(today) + 6) % 7)), today];
  if (period === 'month') return [`${today.slice(0, 8)}01`, today];
  if (period === 'yesterday') { const date = addDaysToDateKey(today, -1); return [date, date]; }
  return [today, today];
}
export const productionDuration = (seconds = 0) => `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}m`;
export const productionPercent = value => value == null ? 'Not applicable' : `${value}%`;
export const productionMoney = (amount, currency) => amount == null ? 'Missing Rate' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
export const productionWarnings = {
  'needs-team-allocation': 'Some work needs a team assignment before it can count toward production.',
  'team-inferred-from-current-relationships': 'Some team assignments use current project and task links. Verify them before billing approval.',
  'needs-activity-classification': 'Some tracked work needs an activity classification before it can count toward production.',
  'overlapping-work-needs-review': 'Overlapping work needs review. Conflicting time is counted once and excluded from production.',
  'missing-working-hours-target': 'Some present employees have no working-hour target.',
  'missing-rate': 'Some eligible billing work has no applicable rate. Estimates are incomplete.',
  'currency-mismatch': 'Some rates use a different currency. Those amounts were not calculated.',
  'invalid-pause': 'Some pause records need review.',
  'invalid-or-empty-interval': 'Some time records have invalid or empty intervals.',
};
