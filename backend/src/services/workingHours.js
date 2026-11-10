const { addDateKeyDays } = require('../utils/billingUtils');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const id = value => String(value?._id || value || '');
const TARGET_EXCLUDED_ROLES = ['alpha', 'manager'];

function validDate(value) {
  if (typeof value !== 'string') throw fail('Choose a valid date.');
  try { addDateKeyDays(value, 0); } catch { throw fail('Choose a valid date in YYYY-MM-DD format.'); }
  return value;
}
function hoursToSeconds(value) {
  if (!['string', 'number'].includes(typeof value) || !/^\d{1,2}(\.\d{1,2})?$/.test(String(value))) throw fail('Enter 0–24 hours, with up to two decimal places.');
  const [hours, fraction = ''] = String(value).split('.');
  const hundredths = Number(hours) * 100 + Number(fraction.padEnd(2, '0'));
  if (hundredths > 2400) throw fail('Daily working hours cannot exceed 24.');
  return hundredths * 36;
}
function policyOnDate(policy, date) {
  // Equal effective dates resolve to the last appended revision. Future
  // revisions never leak into earlier dates, even if saved out of order.
  return (policy?.revisions || []).reduce((chosen, revision) => revision.effectiveFrom <= date
    && (!chosen || revision.effectiveFrom >= chosen.effectiveFrom) ? revision : chosen, null);
}
function union(intervals) {
  const result = [];
  for (const [start, end] of intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a, b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}
function productiveSeconds(logs, start, end, now = Date.now()) {
  const work = [], excluded = [];
  const dayStart = +new Date(start), dayEnd = Math.min(+new Date(end), +now);
  for (const log of logs) {
    if (log.manualEntry?.deletedAt) continue;
    const from = Math.max(dayStart, +new Date(log.startedAt));
    let until = log.stoppedAt ? +new Date(log.stoppedAt) : log.status === 'stopped' ? NaN : +now;
    if (!log.stoppedAt && log.desktopHeartbeatAt && +now - +new Date(log.desktopHeartbeatAt) >= 90000) until = Math.min(until, +new Date(log.desktopHeartbeatAt));
    until = Math.min(dayEnd, until);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) continue;
    (log.task?.taskType === 'break' ? excluded : work).push([from, until]);
    for (const pause of log.pauses || []) {
      if (pause.pausedAt) excluded.push([Math.max(from, +new Date(pause.pausedAt)), Math.min(until, pause.resumedAt ? +new Date(pause.resumedAt) : until)]);
    }
  }
  const exclusions = union(excluded);
  const milliseconds = union(work).reduce((sum, [a, b]) => sum + b - a - exclusions.reduce((paused, [c, d]) => paused + Math.max(0, Math.min(b, d) - Math.max(a, c)), 0), 0);
  return Math.max(0, Math.floor(milliseconds / 1000));
}
function metrics(requiredSeconds, completedSeconds) {
  return { requiredSeconds, completedSeconds, pendingSeconds: Math.max(requiredSeconds - completedSeconds, 0),
    overtimeSeconds: Math.max(completedSeconds - requiredSeconds, 0),
    completionPercent: requiredSeconds ? Math.min(100, Math.round(completedSeconds / requiredSeconds * 1000) / 10) : 0 };
}
function buildWorkingHoursOverview({ employees, policies, attendance, logs, date, start, end, now }) {
  const policyMap = new Map(policies.map(row => [id(row.employee), row]));
  const attendanceMap = new Map(attendance.map(row => [id(row.employee), row]));
  const logMap = new Map();
  for (const log of logs) { const key = id(log.employee); if (!logMap.has(key)) logMap.set(key, []); logMap.get(key).push(log); }
  const teams = new Map();
  for (const employee of employees) {
    if (TARGET_EXCLUDED_ROLES.includes(employee.role)) continue;
    const key = id(employee), att = attendanceMap.get(key);
    if (!employee.isActive && !att && !logMap.has(key)) continue;
    const adjustment = att?.workingHoursAdjustments?.at(-1);
    const present = att?.status === 'Present' && !['leave', 'absent'].includes(adjustment?.type);
    const policy = policyOnDate(policyMap.get(key), date);
    const required = present && policy ? Math.round(policy.requiredSeconds * (adjustment?.type === 'half_day' ? policy.halfDayPercent / 100 : 1)) : 0;
    const trackedSeconds = productiveSeconds(logMap.get(key) || [], start, end, now);
    const completed = present && policy ? trackedSeconds : 0;
    const progress = metrics(required, completed);
    const teamKey = id(employee.team) || 'unassigned', teamName = employee.team?.teamName || 'No team assigned';
    if (!teams.has(teamKey)) teams.set(teamKey, { key: teamKey, name: teamName, members: [] });
    teams.get(teamKey).members.push({ employee: key, fullName: employee.fullName, employeeId: employee.employeeId, isActive: employee.isActive,
      team: teamKey, teamName, present, configured: Boolean(policy), dailyRequiredSeconds: policy?.requiredSeconds ?? null,
      effectiveFrom: policy?.effectiveFrom || null, halfDayPercent: policy?.halfDayPercent ?? null,
      attendance: adjustment?.type === 'leave' ? 'Approved leave' : adjustment?.type === 'absent' ? 'Absent' : !present ? 'Absent' : adjustment?.type === 'half_day' ? 'Half day' : 'Present',
      adjustmentReason: adjustment?.reason || '', trackedSeconds, ...progress,
      status: !present ? 'Not required' : !policy ? 'Not configured' : !required ? 'No requirement' : completed >= required ? 'Completed' : 'In Progress' });
  }
  const summarize = members => {
    const required = members.reduce((sum, row) => sum + row.requiredSeconds, 0), completed = members.reduce((sum, row) => sum + row.completedSeconds, 0);
    return { ...metrics(required, completed), presentCount: members.filter(row => row.present).length,
      unconfiguredCount: members.filter(row => row.present && !row.configured).length,
      // Overtime is employee-specific; it does not erase another person's gap.
      overtimeSeconds: members.reduce((sum, row) => sum + row.overtimeSeconds, 0),
      employeePendingSeconds: members.reduce((sum, row) => sum + row.pendingSeconds, 0) };
  };
  const result = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)).map(team => ({ ...team, ...summarize(team.members) }));
  return { date, asOf: new Date(now).toISOString(), totals: summarize(result.flatMap(team => team.members)), teams: result };
}
module.exports = { fail, id, TARGET_EXCLUDED_ROLES, validDate, hoursToSeconds, policyOnDate, productiveSeconds, metrics, buildWorkingHoursOverview };
