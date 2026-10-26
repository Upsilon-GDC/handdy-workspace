const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const TaskTimeLog = require("../models/TaskTimeLog");
const { addDateKeyDays, dateKeyToUtc, getDateKeyInTimezone } = require("../utils/billingUtils");

// Attendance is recorded automatically from timer activity (product decision,
// 2026-10-23): the first timer started on a company day is the check-in, the
// last stop is the check-out, and a timer that is still running leaves the
// day open. A day belongs to the date its sessions started on, so an
// overnight session checks out on the following morning.
//
// Each update recomputes the whole day from its time logs instead of patching
// the row, so idle stops, heartbeat-lease closures, manual entries and their
// deletion all converge on the same answer, and repeating an update is safe.
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

const roundHours = (milliseconds) => Math.round((milliseconds / 3_600_000) * 100) / 100;

// The attendance values for one day's sessions, or null for a day with none.
function deriveAttendance(logs) {
  if (!logs.length) return null;
  const checkIn = new Date(Math.min(...logs.map((log) => new Date(log.startedAt).getTime())));
  const open = logs.some((log) => !log.stoppedAt || log.status !== "stopped");
  const checkOut = open ? null : new Date(Math.max(...logs.map((log) => new Date(log.stoppedAt).getTime())));
  return { checkIn, checkOut, totalHours: checkOut ? roundHours(checkOut - checkIn) : 0, status: "Present" };
}

async function syncAttendanceForDay(employeeId, dateKey, timezone = APP_TIMEZONE) {
  const logs = await TaskTimeLog.find({
    employee: employeeId,
    startedAt: { $gte: dateKeyToUtc(dateKey, timezone), $lt: dateKeyToUtc(addDateKeyDays(dateKey, 1), timezone) },
    "manualEntry.deletedAt": null,
  }).select("startedAt stoppedAt status").lean();

  const values = deriveAttendance(logs);
  if (!values) {
    // The day's only activity was removed (a deleted manual entry). Update
    // rather than delete, so report delta-sync clients receive the change.
    // Rows from the older check-in API are left exactly as they were.
    return Attendance.findOneAndUpdate(
      { employee: employeeId, date: dateKey, source: "timer" },
      { $set: { status: "Absent", checkIn: null, checkOut: null, totalHours: 0 } },
      { returnDocument: "after" },
    );
  }
  return Attendance.findOneAndUpdate(
    { employee: employeeId, date: dateKey },
    { $set: { ...values, source: "timer" } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}

// Updates for the same employee-day run one at a time, so a stop and a start
// arriving together cannot leave the row describing an older state. The API
// runs as a single instance (render.yaml); see CODEBASE_GUIDE.md before scaling.
const pendingDays = new Map();
function serializeDay(key, operation) {
  const result = (pendingDays.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  pendingDays.set(key, result);
  result.finally(() => { if (pendingDays.get(key) === result) pendingDays.delete(key); }).catch(() => {});
  return result;
}

// Called after a session starts, stops or changes. Attendance must never fail
// a timer action, so problems are logged and the next timer event repairs it.
async function recordAttendanceActivity(employeeId, sessionStartedAt, timezone = APP_TIMEZONE) {
  if (!employeeId || !sessionStartedAt || mongoose.connection.readyState !== 1) return null;
  const employee = String(employeeId?._id || employeeId);
  const dateKey = getDateKeyInTimezone(new Date(sessionStartedAt), timezone);
  try {
    return await serializeDay(`${employee}:${dateKey}`, () => syncAttendanceForDay(employee, dateKey, timezone));
  } catch (error) {
    console.error("[attendance] unable to update", JSON.stringify({ employee, date: dateKey, error: error.message }));
    return null;
  }
}

module.exports = { deriveAttendance, recordAttendanceActivity, syncAttendanceForDay };
