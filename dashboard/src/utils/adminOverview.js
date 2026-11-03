import { APP_TIMEZONE, addDaysToDateKey } from './appDate.js';
import { buildTimeLogTimeline } from './timeLogTimeline.js';
const id = value => String(value?._id || value || '');
const time = value => value ? new Date(value).getTime() : NaN;
const nonnegative = value => Math.max(0, Number(value) || 0);
export const overviewHours = seconds => {
  const minutes = Math.floor(nonnegative(seconds) / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
export function overviewRangeError(start, end, today) {
  const valid = key => /^\d{4}-\d{2}-\d{2}$/.test(key || '') && Number.isFinite(time(key)) && new Date(key).toISOString().slice(0, 10) === key;
  if (!valid(start) || !valid(end) || end < start) return 'Choose a valid From and To date.';
  if (end > today) return 'Choose dates up to today.';
  return '';
}
export function overviewPreset(preset, today) {
  if (preset === 'week') {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    return { startDate: addDaysToDateKey(today, -(weekday === 0 ? 6 : weekday - 1)), endDate: today };
  }
  if (preset === 'month') return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
  return { startDate: today, endDate: today };
}
export function buildAdminOverview({ teams = [], employees = [], records = [], todayRecords = [], asOf = Date.now() }) {
  const people = new Map();
  const alphaIds = new Set(employees.filter(employee => employee.role === 'alpha').map(id));
  for (const employee of employees) if (employee.role !== 'alpha') people.set(id(employee), { ...employee });
  const eligible = rows => [...new Map(rows.filter(record => !record.manualEntry?.deletedAt && record.employee?.role !== 'alpha' && !alphaIds.has(id(record.employee)))
    .map((record, index) => [id(record) || `row-${index}`, record])).values()];
  const period = eligible(records);
  const current = eligible(todayRecords);
  for (const record of [...period, ...current]) {
    const employeeId = id(record.employee) || '__removed_employee__';
    if (!people.has(employeeId)) people.set(employeeId, typeof record.employee === 'object' && record.employee
      ? { ...record.employee, _id: employeeId }
      : { _id: employeeId, fullName: 'Unavailable employee', isActive: false });
  }
  const members = new Map([...people].map(([key, person]) => [key, {
    ...person, key, workedSeconds: 0, breakSeconds: 0, idleSeconds: 0, sessions: 0, latestActivity: null,
    state: person.isActive === false ? 'Inactive account' : 'No active timer', currentProject: '', currentTask: '',
  }]));
  const intervals = new Map();
  for (const record of period) {
    const key = id(record.employee) || '__removed_employee__';
    const member = members.get(key);
    const timeline = buildTimeLogTimeline(record, asOf);
    const sum = type => timeline.filter(segment => segment.type === type).reduce((total, segment) => total + segment.durationSeconds, 0);
    const stored = key => record[key] !== undefined && record[key] !== null && Number.isFinite(Number(record[key]));
    member.workedSeconds += record.task?.taskType === 'break' ? 0 : stored('totalWorkedSeconds') ? nonnegative(record.totalWorkedSeconds) : sum('work');
    member.breakSeconds += sum('break');
    member.idleSeconds += stored('totalIdleSeconds') ? nonnegative(record.totalIdleSeconds) : sum('idle');
    member.sessions++;
    const start = time(record.startedAt), end = record.stoppedAt ? Math.min(time(record.stoppedAt), asOf) : asOf;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      if (!intervals.has(key)) intervals.set(key, []);
      intervals.get(key).push({ start, end });
      if (!member.latestActivity || end > time(member.latestActivity)) member.latestActivity = new Date(end).toISOString();
    }
  }
  // Same-day gaps between saved sessions follow the existing detailed reports.
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const [key, sessions] of intervals) {
    let previousEnd = null;
    for (const session of sessions.sort((a, b) => a.start - b.start)) {
      if (previousEnd !== null && session.start > previousEnd && date.format(previousEnd) === date.format(session.start)) members.get(key).idleSeconds += Math.floor((session.start - previousEnd) / 1000);
      previousEnd = Math.max(previousEnd ?? session.end, session.end);
    }
  }
  const active = new Map();
  for (const record of current) {
    if (!['running', 'paused'].includes(record.status) || record.isActiveTimer === false || record.stoppedAt) continue;
    const key = id(record.employee);
    const existing = active.get(key);
    if (!existing || time(record.startedAt) > time(existing.startedAt)) active.set(key, record);
  }
  for (const [key, record] of active) {
    const member = members.get(key);
    if (!member || member.isActive === false) continue;
    const pause = [...(record.pauses || [])].sort((a, b) => time(a.pausedAt) - time(b.pausedAt)).at(-1);
    member.state = record.status === 'running' ? record.task?.taskType === 'break' ? 'On break' : 'Working'
      : ['break', 'manual'].includes(pause?.reason) ? 'On break' : pause?.reason === 'idle' ? 'Idle' : 'Paused';
    member.currentProject = record.project?.projectName || 'Unavailable project';
    member.currentTask = record.task?.taskName || 'Unavailable task';
  }
  const teamById = new Map(teams.map(team => [id(team), team]));
  const grouped = new Map();
  const makeGroup = (key, definition) => ({ key, name: definition?.teamName || 'No team assigned', isActive: definition?.isActive !== false,
    members: [], workedSeconds: 0, breakSeconds: 0, idleSeconds: 0, working: 0, onBreak: 0, idle: 0, noTimer: 0, activeMembers: 0, projects: [] });
  for (const team of teams) if (team.isActive !== false) grouped.set(id(team), makeGroup(id(team), team));
  for (const member of members.values()) {
    const key = id(member.team) || '__unassigned_team__';
    if (!grouped.has(key)) grouped.set(key, makeGroup(key, teamById.get(key) || (id(member.team) ? { teamName: member.team?.teamName || 'Unavailable team' } : null)));
    const group = grouped.get(key);
    group.members.push(member);
    group.workedSeconds += member.workedSeconds; group.breakSeconds += member.breakSeconds; group.idleSeconds += member.idleSeconds;
    if (member.isActive !== false) group.activeMembers++;
    if (member.state === 'Working') group.working++;
    if (member.state === 'On break') group.onBreak++;
    if (['Idle', 'Paused'].includes(member.state)) group.idle++;
    if (member.state === 'No active timer') group.noTimer++;
  }
  const result = [...grouped.values()].sort((a, b) => b.working - a.working || b.workedSeconds - a.workedSeconds || a.name.localeCompare(b.name));
  for (const group of result) {
    group.projects = [...new Set(group.members.filter(member => member.state === 'Working').map(member => member.currentProject))].sort();
    group.members.sort((a, b) => (a.state === 'Working' ? -1 : 0) - (b.state === 'Working' ? -1 : 0) || (a.fullName || '').localeCompare(b.fullName || ''));
  }
  const totals = result.reduce((total, group) => ({ workedSeconds: total.workedSeconds + group.workedSeconds, breakSeconds: total.breakSeconds + group.breakSeconds,
    idleSeconds: total.idleSeconds + group.idleSeconds, working: total.working + group.working, onBreak: total.onBreak + group.onBreak,
    idle: total.idle + group.idle, noTimer: total.noTimer + group.noTimer, activeMembers: total.activeMembers + group.activeMembers }),
  { workedSeconds: 0, breakSeconds: 0, idleSeconds: 0, working: 0, onBreak: 0, idle: 0, noTimer: 0, activeMembers: 0 });
  return { teams: result, totals };
}
