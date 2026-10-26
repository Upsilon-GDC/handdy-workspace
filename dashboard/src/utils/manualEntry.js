import { APP_TIMEZONE, todayDateKey } from "./appDate.js";

export const MAX_ENTRY_HOURS = 24;
export const MIN_REASON_LENGTH = 5;

const offsetMilliseconds = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second) - date.getTime();
};

const id = (value) => String(value?._id || value?.id || (typeof value === "string" ? value : ""));

// UI eligibility; the API also checks current grants and team membership.
// Admin, alpha, manager and HR act on every employee (2026-10-23 decision).
export const canManageManualEntries = (actor, employee, { teamReport = false } = {}) => {
  if (!actor || !employee || !id(employee)) return false;
  if (["alpha", "admin", "manager", "hr"].includes(actor.role)) return true;
  if (actor.role !== "team_lead" || employee.role !== "employee" || id(actor) === id(employee)) return false;
  return teamReport || id(employee.teamLead) === id(actor)
    || Boolean(actor.team && id(actor.team) === id(employee.team));
};

// Converts a wall-clock date + "HH:MM" in the business timezone to a UTC
// instant, so the entry lands on the same calendar day the reports use.
export const zonedDateTimeToIso = (dateKey, time, timezone = APP_TIMEZONE) => {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) return null;
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = new Date(wallClock - offsetMilliseconds(new Date(wallClock), timezone));
  return new Date(wallClock - offsetMilliseconds(firstGuess, timezone)).toISOString();
};

// The picker data comes from one request; narrowing is purely local.
export const projectsForClient = (options, clientId) => (options?.projects || [])
  .filter((project) => (!clientId || (project.clientIds || []).some((value) => id(value) === id(clientId)))
    && tasksForProject(options, project._id).length > 0);

export const tasksForProject = (options, projectId) => (options?.tasks || [])
  .filter((task) => projectId && id(task.project) === id(projectId));

export const emptyEntryForm = (now = new Date()) => ({
  client: "", project: "", task: "", date: todayDateKey(now), startTime: "", endTime: "", reason: "",
});

export const formatEntryDuration = (seconds) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}m`;
};

// Returns { errors, payload, seconds }. The server re-validates everything and
// remains authoritative (assignment scope, overlap, permissions).
export function validateEntryForm(form, options, employeeId, now = new Date(), timezone = APP_TIMEZONE) {
  const errors = {};
  const projects = options?.projects || [];
  if (!form.project) errors.project = "Select a project.";
  else if (form.client && !projectsForClient(options, form.client).some((project) => project._id === form.project)) {
    errors.project = "This project does not belong to the selected client.";
  } else if (!projects.some((project) => project._id === form.project)) errors.project = "Select a valid project.";
  if (!form.task) errors.task = "Select a task.";
  else if (!tasksForProject(options, form.project).some((task) => task._id === form.task)) errors.task = "Select a task from this project.";
  if (!form.date) errors.date = "Choose a date.";
  if (!form.startTime) errors.startTime = "Enter a start time.";
  if (!form.endTime) errors.endTime = "Enter an end time.";
  if ((form.reason || "").trim().length < MIN_REASON_LENGTH) errors.reason = `Enter a reason (at least ${MIN_REASON_LENGTH} characters).`;

  let seconds = 0;
  let startedAt = null;
  let stoppedAt = null;
  if (form.date && form.startTime && form.endTime) {
    startedAt = zonedDateTimeToIso(form.date, form.startTime, timezone);
    stoppedAt = zonedDateTimeToIso(form.date, form.endTime, timezone);
    seconds = Math.floor((new Date(stoppedAt) - new Date(startedAt)) / 1000);
    if (seconds <= 0) errors.endTime = "End time must be after the start time.";
    else if (seconds > MAX_ENTRY_HOURS * 3600) errors.endTime = `An entry cannot be longer than ${MAX_ENTRY_HOURS} hours.`;
    else if (new Date(stoppedAt) > now) errors.endTime = "The entry cannot end in the future.";
  }

  if (Object.keys(errors).length) return { errors, payload: null, seconds };
  return {
    errors,
    seconds,
    payload: {
      employee: employeeId,
      client: form.client || undefined,
      project: form.project,
      task: form.task,
      startedAt,
      stoppedAt,
      reason: form.reason.trim(),
    },
  };
}
