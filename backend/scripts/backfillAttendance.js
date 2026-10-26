require("dotenv").config();

// Builds timer-based attendance rows for days recorded before automatic
// attendance existed, using the same rules as live timers
// (src/services/attendanceService.js). Rows created by the older check-in API
// are reported and left untouched. Dry run unless --apply is given.
//
//   node scripts/backfillAttendance.js --from 2026-09-01 --to 2026-10-23
//   node scripts/backfillAttendance.js --from 2026-09-01 --to 2026-10-23 --apply

const mongoose = require("mongoose");
const Attendance = require("../src/models/Attendance");
const TaskTimeLog = require("../src/models/TaskTimeLog");
const { syncAttendanceForDay } = require("../src/services/attendanceService");
const { getBillingDateRange, getDateKeyInTimezone } = require("../src/utils/billingUtils");

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
const applyChanges = process.argv.includes("--apply");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "");
};

const main = async () => {
  const from = argument("--from");
  const to = argument("--to");
  if (!from || !to) throw new Error("Usage: node scripts/backfillAttendance.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]");
  const range = getBillingDateRange(from, to, APP_TIMEZONE);

  const mongoUri = String(process.env.MONGODB_URI || "").trim();
  if (!mongoUri) throw new Error("MONGODB_URI is required.");
  await mongoose.connect(mongoUri);

  const days = new Map();
  const cursor = TaskTimeLog.find({
    startedAt: { $gte: range.start, $lt: range.endExclusive },
    "manualEntry.deletedAt": null,
  }).select("employee startedAt").lean().cursor();
  for await (const log of cursor) {
    const date = getDateKeyInTimezone(log.startedAt, APP_TIMEZONE);
    days.set(`${log.employee}|${date}`, { employee: String(log.employee), date });
  }

  const existing = await Attendance.find({ date: { $gte: from, $lte: to } }).select("employee date source").lean();
  const sourceByDay = new Map(existing.map((row) => [`${row.employee}|${row.date}`, row.source || "check_in"]));

  const counts = { create: 0, refresh: 0, keepCheckIn: 0 };
  for (const [key, day] of days) {
    const source = sourceByDay.get(key);
    if (source === "check_in") { counts.keepCheckIn += 1; continue; }
    counts[source ? "refresh" : "create"] += 1;
    if (applyChanges) await syncAttendanceForDay(day.employee, day.date, APP_TIMEZONE);
  }

  console.log(JSON.stringify({ mode: applyChanges ? "applied" : "dry-run", from, to, timezone: APP_TIMEZONE, employeeDays: days.size, ...counts }, null, 2));
  if (!applyChanges) console.log("No changes were written. Re-run with --apply to create these attendance rows.");
};

main()
  .catch((error) => {
    console.error(`Attendance backfill failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
