const { getBillingDateRange, addDateKeyDays, dateKeyToUtc, getDateKeyInTimezone, getEmployeeChargeRate } = require('../../utils/billingUtils');
const { policyOnDate, TARGET_EXCLUDED_ROLES } = require('../workingHours');
const { effectiveRevision, fail } = require('./settingsValidation');

const id = value => String(value?._id || value || '');
const percent = (part, total) => total > 0 ? Math.round(part / total * 10000) / 100 : null;
const fields = ['actualSeconds', 'productionSeconds', 'eligibleClientWorkSeconds', 'nonBillableProductiveSeconds',
  'trainingSeconds', 'breakIdleSeconds', 'excludedSeconds', 'unclassifiedSeconds', 'unallocatedSeconds', 'conflictSeconds', 'expectedSeconds'];
const empty = () => Object.fromEntries(fields.map(key => [key, 0]));
function estimatedAmount(bucket) {
  if (!bucket.ratedSeconds) return bucket.missingRateSeconds + bucket.currencyMismatchSeconds > 0 ? null : 0;
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: bucket.currency }).resolvedOptions().maximumFractionDigits;
  const factor = 10n ** BigInt(digits), divisor = 360000000n;
  return Number((bucket.numerator * factor + divisor / 2n) / divisor) / Number(factor);
}
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) { const value = key(row); if (!map.has(value)) map.set(value, []); map.get(value).push(row); }
  return map;
}
function resolveWorkTeam(log, task, project, allocation) {
  if (allocation) return { team: id(allocation.team) || null, source: 'explicit' };
  const taskTeams = [...new Set([...(task?.teams || []), task?.team].filter(Boolean).map(id))];
  const projectTeams = [...new Set((project?.teams || []).map(id))];
  const candidates = taskTeams.length && projectTeams.length ? taskTeams.filter(team => projectTeams.includes(team))
    : taskTeams.length ? taskTeams : projectTeams;
  return { team: candidates.length === 1 ? candidates[0] : null,
    source: candidates.length === 1 ? 'current-relationships' : 'needs-allocation' };
}
function settingsResolver(settings) {
  const groups = groupBy(settings, row => `${row.kind}:${row.key}`), cache = new Map();
  return (kind, key, date) => {
    const cacheKey = `${kind}:${key}:${date}`;
    if (!cache.has(cacheKey)) cache.set(cacheKey, effectiveRevision(groups.get(`${kind}:${key}`) || [], date));
    return cache.get(cacheKey);
  };
}
function resolveRate(employee, project) {
  const amount = getEmployeeChargeRate(employee, project);
  const rate = Math.round((amount + Number.EPSILON) * 100);
  if (amount === null || amount > 1000000 || !Number.isSafeInteger(rate) || rate <= 0) return { status: 'missing-rate' };
  return { status: 'estimated', rateHundredths: rate, rateSource: 'employee-project', rateKey: `${id(employee)}:${id(project)}` };
}
function summarizeProduction(rows, targetRows = [], includeBilling = false) {
  const summary = empty();
  for (const row of rows) for (const key of fields) summary[key] += row[key];
  for (const row of targetRows) summary.expectedSeconds += row.expectedSeconds;
  // One person's overtime cannot erase another person's target gap, nor
  // erase a shortfall on a different day.
  const progress = new Map();
  for (const row of targetRows) progress.set(`${row.employee}:${row.date}`, { expected: row.expectedSeconds, production: 0, configured: row.configured });
  for (const row of rows) {
    const key = `${row.employee}:${row.date}`;
    if (progress.has(key)) progress.get(key).production += row.productionSeconds;
  }
  summary.remainingSeconds = [...progress.values()].reduce((sum, row) => sum + Math.max(0, row.expected - row.production), 0);
  summary.overtimeSeconds = [...progress.values()].reduce((sum, row) => sum + (row.configured ? Math.max(0, row.production - row.expected) : 0), 0);
  summary.targetEligibleProductionSeconds = [...progress.values()].reduce((sum, row) => sum + (row.expected > 0 ? row.production : 0), 0);
  summary.achievementPercent = percent(summary.targetEligibleProductionSeconds, summary.expectedSeconds);
  if (includeBilling) {
    const applicable = [...rows, ...targetRows].some(row => row.billing?.applicable);
    summary.billing = { applicable };
    if (applicable) {
      const currencies = new Map();
      let billableSeconds = 0, billingProductionSeconds = 0;
      for (const row of targetRows) if (row.billing?.applicable && row.billing.currency) currencies.set(row.billing.currency, { currency: row.billing.currency, numerator: 0n, ratedSeconds: 0, missingRateSeconds: 0, currencyMismatchSeconds: 0 });
      for (const row of rows) {
        const billing = row.billing;
        if (!billing?.applicable) continue;
        billingProductionSeconds += row.productionSeconds; billableSeconds += billing.billableSeconds || 0;
        if (!currencies.has(billing.currency)) currencies.set(billing.currency, { currency: billing.currency, numerator: 0n, ratedSeconds: 0, missingRateSeconds: 0, currencyMismatchSeconds: 0 });
        const bucket = currencies.get(billing.currency);
        if (billing.status === 'estimated') { bucket.numerator += BigInt(Math.round(row.actualSeconds * 1000)) * BigInt(billing.rateHundredths); bucket.ratedSeconds += row.actualSeconds; }
        else if (billing.status === 'missing-rate') bucket.missingRateSeconds += row.actualSeconds;
        else if (billing.status === 'currency-mismatch') bucket.currencyMismatchSeconds += row.actualSeconds;
      }
      summary.billing = { applicable: true, billableSeconds, utilizationPercent: percent(billableSeconds, billingProductionSeconds),
        estimates: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map(bucket => ({
          currency: bucket.currency, ratedSeconds: bucket.ratedSeconds, missingRateSeconds: bucket.missingRateSeconds,
          currencyMismatchSeconds: bucket.currencyMismatchSeconds, complete: bucket.missingRateSeconds + bucket.currencyMismatchSeconds === 0,
          estimatedAmount: estimatedAmount(bucket),
        })) };
    }
  }
  return summary;
}

function calculateProduction({ employees = [], logs = [], tasks = [], projects = [], allocations = [], settings = [],
  policies = [], attendance = [], startDate, endDate, timezone = 'Asia/Kolkata', now = Date.now(), includeBilling = false, includeOptionalWork = false, filters = {}, allowedTeamIds = null, billingTeamIds = null }) {
  let range;
  try { range = getBillingDateRange(startDate, endDate, timezone); } catch (error) { throw fail(error.message); }
  const asOf = +new Date(now);
  if (!Number.isFinite(asOf)) throw fail('Invalid calculation time.');
  if (employees.length > 1000 || logs.length > 50000) throw fail('Narrow the Production report date range or employee selection.', 413);
  const employeeMap = new Map(employees.map(row => [id(row), row]));
  const taskMap = new Map(tasks.map(row => [id(row), row])), projectMap = new Map(projects.map(row => [id(row), row]));
  const allocationMap = new Map();
  for (const row of allocations) {
    const key = id(row.timeLog), previous = allocationMap.get(key);
    if (!previous || row.version > previous.version) allocationMap.set(key, row);
  }
  const policyMap = new Map(policies.map(row => [id(row.employee), row]));
  const attendanceMap = new Map(attendance.map(row => [`${id(row.employee)}:${row.date}`, row]));
  const resolve = settingsResolver(settings), warnings = new Map(), details = [];
  const choiceIds = { clients: new Set(), projects: new Set(), tasks: new Set() };
  const warn = (code, log, subject, date) => {
    if (log && !warningApplicable(log, date)) return;
    if (subject) {
      const person = employeeMap.get(subject.slice(0, -11)), day = subject.slice(-10), team = id(person?.team);
      if ((allowedTeams && !allowedTeams.has(team)) || (filters.team && filters.team !== team)
        || resolve('team-billing', team, day)?.values.billingEnabled !== true) return;
    }
    if (!warnings.has(code)) warnings.set(code, { code, timeLogIds: new Set(), subjects: new Set() });
    if (log) warnings.get(code).timeLogIds.add(id(log));
    if (subject) warnings.get(code).subjects.add(subject);
  };
  const dates = [];
  for (let date = startDate; date <= endDate; date = addDateKeyDays(date, 1)) dates.push(date);
  const dayBounds = dates.map(date => ({ date, start: +dateKeyToUtc(date, timezone), end: +dateKeyToUtc(addDateKeyDays(date, 1), timezone) }));
  const allowedTeams = allowedTeamIds === null ? null : new Set(allowedTeamIds);
  const moneyTeams = billingTeamIds === null ? null : new Set(billingTeamIds);
  const allowed = row => (!allowedTeams || allowedTeams.has(row.team)) && (!filters.team || row.team === filters.team)
    && (!filters.client || row.client === filters.client) && (!filters.project || row.project === filters.project)
    && (!filters.task || row.task === filters.task);
  const configOn = (team, date) => team && (!moneyTeams || moneyTeams.has(team)) ? resolve('team-billing', team, date) : null;
  // The home team is used only to route an unresolved record's review notice;
  // it never assigns its work, production credit or billing to that team.
  const warningApplicable = (log, date) => {
    const allocation = resolveWorkTeam(log, taskMap.get(id(log.task)), projectMap.get(id(log.project)), allocationMap.get(id(log)));
    const team = allocation.team || id(employeeMap.get(id(log.employee))?.team);
    if (!allowed({ team, client: id(log.client), project: id(log.project), task: id(log.task) })) return false;
    const enabled = day => resolve('team-billing', team, day)?.values.billingEnabled === true;
    if (date) return enabled(date);
    const start = +new Date(log.startedAt), stop = log.stoppedAt ? +new Date(log.stoppedAt) : asOf;
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return enabled(startDate);
    return dayBounds.some(day => start < day.end && stop > day.start && enabled(day.date));
  };
  const classificationOn = (log, team, date) => team && (log.activityMapping
    ? resolve('classification', `${team}:activity:${id(log.activityMapping)}`, date) : null)
    || (team ? resolve('classification', `${team}:task:${id(log.task)}`, date) : null);
  const prepared = [];
  for (const log of logs) {
    if (!employeeMap.has(id(log.employee)) || log.manualEntry?.deletedAt) continue;
    const start = Math.max(+range.start, +new Date(log.startedAt));
    let stop = log.stoppedAt ? +new Date(log.stoppedAt) : log.status === 'stopped' ? NaN : asOf;
    if (!log.stoppedAt && log.desktopHeartbeatAt && asOf - +new Date(log.desktopHeartbeatAt) >= 90000) stop = Math.min(stop, +new Date(log.desktopHeartbeatAt));
    stop = Math.min(+range.endExclusive, asOf, stop);
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) { warn('invalid-or-empty-interval', log); continue; }
    const task = taskMap.get(id(log.task)), project = projectMap.get(id(log.project));
    const allocation = resolveWorkTeam(log, task, project, allocationMap.get(id(log)));
    // Explicit Break/Lunch tasks never enter production or billing, even when
    // shared across teams. Their team links do not need a production review.
    if (task?.taskType !== 'break') {
      if (!allocation.team) warn('needs-team-allocation', log);
      else if (allocation.source === 'current-relationships') warn('team-inferred-from-current-relationships', log);
    }
    const pauses = [];
    for (const pause of log.pauses || []) {
      if (!pause.pausedAt) { warn('invalid-pause', log); continue; }
      const from = Math.max(start, +new Date(pause.pausedAt));
      const to = Math.min(stop, pause.resumedAt ? +new Date(pause.resumedAt) : stop);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) pauses.push([from, to]);
      else warn('invalid-pause', log);
    }
    // Persisted totals are intentionally not added to timestamp intervals: they
    // may already include pauses, and summing both would double-count time.
    prepared.push({ log, start, stop, pauses, task, ...allocation });
  }
  for (const [employee, items] of groupBy(prepared, item => id(item.log.employee))) {
    const events = [];
    const add = (at, type, item, delta) => events.push({ at, type, item, delta });
    for (const item of items) {
      add(item.start, 'active', item, 1); add(item.stop, 'active', item, -1);
      for (const [a, b] of item.pauses) { add(a, 'paused', item, 1); add(b, 'paused', item, -1); }
    }
    for (const day of dayBounds) { add(day.start, 'day'); add(day.end, 'day'); }
    if (events.length > 500000) throw fail('Too many time intervals. Narrow the Production report.', 413);
    events.sort((a, b) => a.at - b.at);
    const active = new Set(), paused = new Map();
    let index = 0;
    while (index < events.length) {
      const at = events[index].at;
      while (index < events.length && events[index].at === at) {
        const event = events[index++];
        if (event.type === 'active') { if (event.delta > 0) active.add(event.item); else active.delete(event.item); }
        if (event.type === 'paused') paused.set(event.item, (paused.get(event.item) || 0) + event.delta);
      }
      const until = events[index]?.at;
      if (!active.size || !until || until <= at) continue;
      const date = getDateKeyInTimezone(new Date(at), timezone);
      const candidates = [...active].map(item => {
        const classification = classificationOn(item.log, item.team, date);
        let category = !item.team ? 'unallocated' : classification?.values.category || 'unclassified';
        const optionalIncluded = includeOptionalWork === true && category === 'excluded' && classification?.values.reportOptionalBillable === true;
        if (optionalIncluded) category = 'productive';
        if (item.task?.taskType === 'break' || paused.get(item) > 0) category = 'break-idle';
        return { item, category, classification, optionalIncluded };
      });
      // Exclusions take precedence over simultaneous work. Conflicting work
      // tuples are held for review rather than credited or billed twice.
      const priority = { 'break-idle': 7, training: 6, excluded: 5, unallocated: 4, unclassified: 3, productive: 2 };
      candidates.sort((a, b) => priority[b.category] - priority[a.category] || id(a.item.log).localeCompare(id(b.item.log)));
      const chosen = candidates[0], item = chosen.item, log = item.log;
      let category = chosen.category;
      const tuple = candidate => [candidate.item.team, id(candidate.item.log.client), id(candidate.item.log.project), id(candidate.item.log.task), id(candidate.item.log.activityMapping)].join(':');
      if (category === 'productive' && new Set(candidates.map(tuple)).size > 1) { category = 'conflict'; for (const entry of candidates) warn('overlapping-work-needs-review', entry.item.log, null, date); }
      if (category === 'unclassified') warn('needs-activity-classification', log, null, date);
      const seconds = (until - at) / 1000;
      const row = { employee, date, team: category === 'conflict' ? null : item.team,
        client: id(log.client) || null, project: id(log.project), task: id(log.task),
        category, allocationSource: item.source, timeLogIds: candidates.filter(entry => tuple(entry) === tuple(chosen)).map(entry => id(entry.item.log)),
        startedAt: new Date(at).toISOString(), stoppedAt: new Date(until).toISOString(), ...empty(), actualSeconds: seconds };
      const metric = { productive: 'productionSeconds', training: 'trainingSeconds', 'break-idle': 'breakIdleSeconds',
        excluded: 'excludedSeconds', unclassified: 'unclassifiedSeconds', unallocated: 'unallocatedSeconds', conflict: 'conflictSeconds' }[category];
      row[metric] = seconds;
      const eligible = category === 'productive' && (chosen.classification?.values.billable === true || chosen.optionalIncluded);
      row.eligibleClientWorkSeconds = eligible ? seconds : 0;
      row.nonBillableProductiveSeconds = category === 'productive' && !eligible ? seconds : 0;
      if (!allowedTeams || allowedTeams.has(row.team)) {
        if (row.client) choiceIds.clients.add(row.client);
        if (row.project) choiceIds.projects.add(row.project);
        if (row.task) choiceIds.tasks.add(row.task);
      }
      if (includeBilling) {
        const config = configOn(row.team, date);
        row.billing = { applicable: config?.values.billingEnabled === true };
        if (row.billing.applicable) {
          row.billing = { ...row.billing, currency: config.values.currency, billableSeconds: eligible ? seconds : 0,
            status: eligible ? 'missing-rate' : 'not-billable', configRevision: id(config), approvalRequired: config.values.approvalRequired === true };
          if (eligible) {
            const rate = resolveRate(employeeMap.get(employee), row.project);
            Object.assign(row.billing, rate);
            if (rate.status !== 'estimated') warn(rate.status, log, null, date);
          }
        }
      }
      if (allowed(row)) details.push(row);
      if (details.length > 100000) throw fail('Too many Production detail rows. Narrow the report.', 413);
    }
  }
  const targets = [];
  for (const employee of employees) {
    if (TARGET_EXCLUDED_ROLES.includes(employee.role)) continue;
    for (const { date, start } of dayBounds) {
      if (start > asOf) continue;
      const att = attendanceMap.get(`${id(employee)}:${date}`), adjustment = att?.workingHoursAdjustments?.at(-1);
      const present = att?.status === 'Present' && !['leave', 'absent'].includes(adjustment?.type);
      const policy = policyOnDate(policyMap.get(id(employee)), date);
      const team = id(employee.team) || null;
      if (allowedTeams && !allowedTeams.has(team)) continue;
      if (filters.team && filters.team !== team) continue;
      if (present && !policy) warn('missing-working-hours-target', null, `${id(employee)}:${date}`);
      const expectedSeconds = present && policy ? Math.round(policy.requiredSeconds * (adjustment?.type === 'half_day' ? policy.halfDayPercent / 100 : 1)) : 0;
      const row = { employee: id(employee), team, date, configured: Boolean(policy), present, expectedSeconds };
      if (includeBilling) {
        const config = configOn(team, date);
        row.billing = { applicable: config?.values.billingEnabled === true, ...(config?.values.billingEnabled ? { currency: config.values.currency } : {}) };
      }
      targets.push(row);
    }
  }
  const summarize = (rows, targetRows) => summarizeProduction(rows, targetRows, includeBilling);
  const employeeRows = groupBy(details, row => row.employee), employeeTargets = groupBy(targets, row => row.employee);
  const members = employees.map(employee => ({ employee: id(employee), fullName: employee.fullName, employeeId: employee.employeeId,
    team: id(employee.team) || null, ...summarize(employeeRows.get(id(employee)) || [], employeeTargets.get(id(employee)) || []) }));
  const teamRows = groupBy(details, row => row.team), teamTargets = groupBy(targets, row => row.team);
  const teams = [...new Set([...teamRows.keys(), ...teamTargets.keys()])].map(team => ({ team,
    employeeCount: new Set([...(teamRows.get(team) || []), ...(teamTargets.get(team) || [])].map(row => row.employee)).size,
    ...summarize(teamRows.get(team) || [], teamTargets.get(team) || []) }));
  const dailyRows = groupBy(details, row => row.date), dailyTargets = groupBy(targets, row => row.date);
  const daily = dates.map(date => ({ date, ...summarize(dailyRows.get(date) || [], dailyTargets.get(date) || []) }));
  const periodSummaries = key => [...groupBy(dates, key).entries()].map(([date, periodDates]) => {
    const chosen = new Set(periodDates);
    return { date, periodStart: periodDates[0], periodEnd: periodDates.at(-1),
      ...summarize(details.filter(row => chosen.has(row.date)), targets.filter(row => chosen.has(row.date))) };
  });
  const weekly = periodSummaries(date => addDateKeyDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7)));
  const monthly = periodSummaries(date => date.slice(0, 7));
  const groupDetails = key => [...groupBy(details, key).values()].map(rows => ({
    client: rows[0].client, project: rows[0].project, task: rows[0].task,
    employeeCount: new Set(rows.map(row => row.employee)).size, ...summarize(rows, []),
  }));
  return { kind: 'production', calculationVersion: 2, provisional: true, period: { startDate, endDate, timezone },
    billingEnabledTeamIds: [...new Set(settings.filter(row => row.kind === 'team-billing').map(row => id(row.team) || row.key))]
      .filter(team => dates.some(date => resolve('team-billing', team, date)?.values.billingEnabled === true)),
    asOf: new Date(asOf).toISOString(), targetBasis: 'existing-attendance-policy; targets assigned once to employee home team',
    filterTargetBasis: 'employee daily target; client/project/task filters restrict work, not the daily target',
    totals: summarize(details, targets), members, teams, daily, weekly, monthly, details,
    choiceIds: Object.fromEntries(Object.entries(choiceIds).map(([key, values]) => [key, [...values]])),
    clientProjects: groupDetails(row => `${row.client || ''}:${row.project}`),
    tasks: groupDetails(row => row.task),
    warnings: [...warnings.values()].filter(warning => includeBilling || !['missing-rate', 'currency-mismatch'].includes(warning.code))
      .map(warning => { const ids = [...warning.timeLogIds];
        return { code: warning.code, count: ids.length || warning.subjects.size, timeLogIds: ids.sort().slice(0, 20) }; })
      .filter(warning => warning.count > 0) };
}
module.exports = { calculateProduction, resolveWorkTeam, resolveRate, summarizeProduction };
