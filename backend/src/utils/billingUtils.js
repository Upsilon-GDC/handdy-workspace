const DEFAULT_TIMEZONE = "Asia/Kolkata";
const MAX_BILLING_RANGE_DAYS = 366;
const { isAdminRole } = require("./roles");

const parseDateKey = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("Dates must use YYYY-MM-DD format.");
  const [, year, month, day] = match.map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) throw new Error("The selected date is invalid.");
  return { year, month, day };
};

const addDateKeyDays = (dateKey, days) => {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const getTimezoneOffsetMilliseconds = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const representedUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return representedUtc - date.getTime();
};

const dateKeyToUtc = (dateKey, timezone = DEFAULT_TIMEZONE) => {
  const { year, month, day } = parseDateKey(dateKey);
  const localAsUtc = Date.UTC(year, month - 1, day);
  let instant = new Date(localAsUtc);
  instant = new Date(localAsUtc - getTimezoneOffsetMilliseconds(instant, timezone));
  return new Date(localAsUtc - getTimezoneOffsetMilliseconds(instant, timezone));
};

const getDateKeyInTimezone = (date, timezone = DEFAULT_TIMEZONE) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const getBillingDateRange = (startDate, endDate, timezone = DEFAULT_TIMEZONE) => {
  parseDateKey(startDate);
  parseDateKey(endDate);
  if (endDate < startDate) throw new Error("To date cannot be before From date.");
  const calendarDays = Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000,
  ) + 1;
  if (calendarDays > MAX_BILLING_RANGE_DAYS) {
    throw new Error(`Billing reports cannot exceed ${MAX_BILLING_RANGE_DAYS} days.`);
  }
  return {
    start: dateKeyToUtc(startDate, timezone),
    endExclusive: dateKeyToUtc(addDateKeyDays(endDate, 1), timezone),
    calendarDays,
  };
};

const getBillingEmployeeAccess = (user, requestedId) => {
  const targetId = String(requestedId || "");
  if (!isAdminRole(user?.role) && !["manager", "hr"].includes(user?.role)) {
    return { forbidden: true, targetId, filter: null };
  }
  const filter = { _id: targetId };
  return { forbidden: false, targetId, filter };
};

const overlapSeconds = (startA, endA, startB, endB) => {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  return Math.max(0, (end - start) / 1000);
};

const splitLogByDay = (log, rangeStart, rangeEnd, timezone) => {
  const logStart = new Date(log.startedAt);
  const logEnd = new Date(log.stoppedAt);
  const clippedStart = new Date(Math.max(logStart.getTime(), rangeStart.getTime()));
  const clippedEnd = new Date(Math.min(logEnd.getTime(), rangeEnd.getTime()));
  if (clippedEnd <= clippedStart) return [];

  const pauses = (log.pauses || []).
    filter((pause) => pause.pausedAt && pause.resumedAt).
    map((pause) => ({ start: new Date(pause.pausedAt), end: new Date(pause.resumedAt) }));
  const segments = [];
  let cursor = clippedStart;
  while (cursor < clippedEnd) {
    const date = getDateKeyInTimezone(cursor, timezone);
    const nextBoundary = dateKeyToUtc(addDateKeyDays(date, 1), timezone);
    const segmentEnd = new Date(Math.min(clippedEnd.getTime(), nextBoundary.getTime()));
    const elapsedSeconds = (segmentEnd.getTime() - cursor.getTime()) / 1000;
    const pausedSeconds = pauses.reduce(
      (total, pause) => total + overlapSeconds(cursor, segmentEnd, pause.start, pause.end),
      0,
    );
    const seconds = Math.max(0, Math.floor(elapsedSeconds - pausedSeconds));
    if (seconds > 0) segments.push({ date, startedAt: cursor, stoppedAt: segmentEnd, seconds });
    cursor = segmentEnd;
  }

  const isWholeLog = clippedStart.getTime() === logStart.getTime() && clippedEnd.getTime() === logEnd.getTime();
  if (isWholeLog && segments.length === 1 && Number.isFinite(log.totalWorkedSeconds)) {
    segments[0].seconds = Math.max(0, Math.floor(log.totalWorkedSeconds));
  }
  return segments;
};

const roundCurrency = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const getEmployeeChargeRate = (employee, projectId) => {
  if (!projectId || !Array.isArray(employee?.projectRates)) return null;
  const targetProjectId = String(projectId?._id || projectId);
  const assignment = employee.projectRates.find(
    (item) => String(item?.project?._id || item?.project || "") === targetProjectId,
  );
  const rate = Number(assignment?.chargeRate);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
};

// Full precision until the final step: hours are NOT rounded before the rate
// is applied (7h 56m x $30 = $238.00, not 7.93h x $30 = $237.90). Only the
// finished currency amount is rounded to cents.
const calculateBillableAmount = (seconds, chargeRate) => {
  if (!Number.isFinite(chargeRate) || chargeRate <= 0) return null;
  return roundCurrency((Math.max(0, seconds) / 3600) * chargeRate);
};

const resolveBillingClient = (log, project) => {
  if (log.client) {
    const clientId = String(log.client._id || log.client);
    return { key: clientId, clientId, clientName: log.clientRecord?.clientName || log.client.clientName || "Deleted client" };
  }
  const candidates = [...(project.clients || []), project.client].filter(Boolean);
  const unique = new Map(candidates.map((client) => [String(client._id || client), client]));
  if (unique.size === 1) {
    const [clientId, client] = [...unique.entries()][0];
    return { key: clientId, clientId, clientName: client.clientName || project.clientName || "Unknown client" };
  }
  if (unique.size === 0 && project.clientName?.trim()) {
    const clientName = project.clientName.trim();
    return { key: `legacy:${clientName.toLowerCase()}`, clientId: null, clientName };
  }
  return { key: "unassigned", clientId: null, clientName: "Unassigned client" };
};

const aggregateBillingLogs = ({ logs, employee, startDate, endDate, timezone, rangeStart, rangeEnd }) => {
  const taskGroups = new Map();
  const dailyGroups = new Map();
  let taskSeconds = 0;
  let breakSeconds = 0;

  for (const log of logs) {
    const task = log.taskRecord || {};
    const project = log.projectRecord || {};
    const isBreak = task.taskType === "break";
    const serviceType = isBreak ? null : project.serviceType || null;
    const projectId = project._id || log.project;
    const client = resolveBillingClient(log, project);
    const chargeRate = isBreak ? null : getEmployeeChargeRate(employee, projectId);
    const billingWarning = isBreak
      ? null
      : chargeRate === null
        ? "Charge rate not configured for this employee and project."
        : null;
    for (const segment of splitLogByDay(log, rangeStart, rangeEnd, timezone)) {
      if (isBreak) breakSeconds += segment.seconds;
      else taskSeconds += segment.seconds;

      if (!isBreak) {
        const key = `${client.key}:${projectId}:${task._id || log.task}`;
        const current = taskGroups.get(key) || {
          projectId: String(projectId),
          projectCode: project.projectCode || "",
          projectName: project.projectName || "Deleted project",
          clientKey: client.key,
          clientId: client.clientId,
          clientName: client.clientName,
          taskId: String(task._id || log.task),
          taskCode: task.taskCode || "",
          taskName: task.taskName || "Deleted task",
          taskDescription: task.description || "",
          serviceType,
          chargeRate,
          totalSeconds: 0,
        };
        current.totalSeconds += segment.seconds;
        taskGroups.set(key, current);
      }

      const day = dailyGroups.get(segment.date) || { date: segment.date, taskSeconds: 0, breakSeconds: 0, entries: [] };
      if (isBreak) day.breakSeconds += segment.seconds;
      else day.taskSeconds += segment.seconds;
      day.entries.push({
        logId: String(log._id),
        type: isBreak ? "break" : "work",
        projectId: String(projectId),
        projectName: project.projectName || "Deleted project",
        clientId: client.clientId,
        clientName: client.clientName,
        taskId: String(task._id || log.task),
        taskName: task.taskName || "Deleted task",
        taskDescription: task.description || "",
        serviceType,
        chargeRate,
        billableAmount: isBreak ? null : calculateBillableAmount(segment.seconds, chargeRate),
        billingWarning,
        startedAt: segment.startedAt.toISOString(),
        stoppedAt: segment.stoppedAt.toISOString(),
        durationSeconds: segment.seconds,
      });
      dailyGroups.set(segment.date, day);
    }
  }

  const taskSummary = [...taskGroups.values()]
    .map((task) => ({
      ...task,
      billableAmount: calculateBillableAmount(task.totalSeconds, task.chargeRate),
      billingWarning: task.chargeRate === null
        ? "Charge rate not configured for this employee and project."
        : null,
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.clientName.localeCompare(b.clientName) || a.taskName.localeCompare(b.taskName));
  const projectsMap = new Map();
  for (const task of taskSummary) {
    const key = `${task.clientKey}:${task.projectId}`;
    const project = projectsMap.get(key) || {
      key,
      projectId: task.projectId,
      projectCode: task.projectCode,
      projectName: task.projectName,
      clientName: task.clientName,
      clientId: task.clientId,
      totalSeconds: 0,
      totalBillableAmount: 0,
      hasMissingRates: false,
      tasks: [],
    };
    project.totalSeconds += task.totalSeconds;
    if (task.billableAmount === null) project.hasMissingRates = true;
    else project.totalBillableAmount = roundCurrency(project.totalBillableAmount + task.billableAmount);
    project.tasks.push(task);
    projectsMap.set(key, project);
  }

  const dailyDetails = [...dailyGroups.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of dailyDetails) {
    day.totalSeconds = day.taskSeconds + day.breakSeconds;
    // Each entry is priced at its own project/task rate; the day is the sum
    // of the unrounded entry amounts, rounded once, so the cents never drift.
    day.billableSeconds = day.taskSeconds;
    day.totalBillableAmount = roundCurrency(day.entries.reduce(
      (total, entry) => total + (entry.type === "break" || entry.billingWarning || !entry.chargeRate
        ? 0
        : (entry.durationSeconds / 3600) * entry.chargeRate),
      0,
    ));
    day.hasMissingRates = day.entries.some((entry) => entry.billingWarning);
    // Every billable entry lacks a rate: show "Missing Rate", not $0.00.
    day.allRatesMissing = day.hasMissingRates
      && day.entries.filter((entry) => entry.type !== "break").every((entry) => entry.billingWarning);
    day.entries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  const missingRateTasks = taskSummary.filter((task) => task.billingWarning);
  const totalBillableAmount = roundCurrency(taskSummary.reduce(
    (total, task) => total + (task.billableAmount ?? 0),
    0,
  ));

  return {
    employee,
    period: { startDate, endDate, timezone },
    summary: {
      taskSeconds,
      breakSeconds,
      totalSeconds: taskSeconds + breakSeconds,
      workingDays: dailyDetails.length,
      taskCount: new Set(taskSummary.map((task) => task.taskId)).size,
      projectCount: new Set(taskSummary.map((task) => task.projectId)).size,
      totalBillableAmount,
      missingRateCount: missingRateTasks.length,
    },
    warnings: missingRateTasks.map((task) => ({
      taskId: task.taskId,
      taskName: task.taskName,
      projectId: task.projectId,
      projectName: task.projectName,
      clientId: task.clientId,
      clientName: task.clientName,
      serviceType: task.serviceType,
      message: task.billingWarning,
    })),
    projects: [...projectsMap.values()],
    taskSummary,
    dailyDetails,
  };
};

module.exports = {
  DEFAULT_TIMEZONE,
  MAX_BILLING_RANGE_DAYS,
  addDateKeyDays,
  aggregateBillingLogs,
  dateKeyToUtc,
  getBillingDateRange,
  getBillingEmployeeAccess,
  getDateKeyInTimezone,
  getEmployeeChargeRate,
  calculateBillableAmount,
};
