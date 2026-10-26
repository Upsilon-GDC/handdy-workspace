import test from "node:test";
import assert from "node:assert/strict";

import { addDaysToDateKey, dateKeyInTimezone, dayOfWeekOfDateKey } from "../src/utils/appDate.js";
import { localDate } from "../src/utils/timeLogReportHelpers.js";
import { reportEntryStatus } from "../src/utils/reportFormatting.js";
import {
  emptyEntryForm,
  canManageManualEntries,
  projectsForClient,
  tasksForProject,
  validateEntryForm,
  zonedDateTimeToIso,
} from "../src/utils/manualEntry.js";

const options = {
  employee: { _id: "emp", fullName: "Lee" },
  clients: [{ _id: "c1", clientName: "ABC" }, { _id: "c2", clientName: "XYZ" }],
  projects: [
    { _id: "p1", projectName: "Tax", clientIds: ["c1"] },
    { _id: "p2", projectName: "Audit", clientIds: ["c1", "c2"] },
    { _id: "p3", projectName: "Open", clientIds: [] },
  ],
  tasks: [
    { _id: "t1", taskName: "Prep", project: "p1" },
    { _id: "t2", taskName: "Review", project: "p2" },
  ],
};

test("the default date is today's date in the business timezone, not the browser's", () => {
  // 20:00 UTC on 8 Oct is already 9 Oct (01:30) in Asia/Kolkata.
  const instant = new Date("2026-10-08T20:00:00Z");
  assert.equal(dateKeyInTimezone(instant, "Asia/Kolkata"), "2026-10-09");
  assert.equal(dateKeyInTimezone(instant, "UTC"), "2026-10-08");
  assert.equal(dateKeyInTimezone(instant, "America/Los_Angeles"), "2026-10-08");
  // Rolls over exactly at local midnight.
  assert.equal(dateKeyInTimezone(new Date("2026-10-08T18:29:59Z"), "Asia/Kolkata"), "2026-10-08");
  assert.equal(dateKeyInTimezone(new Date("2026-10-08T18:30:00Z"), "Asia/Kolkata"), "2026-10-09");
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test("an invalid timezone setting falls back instead of breaking the screen", () => {
  assert.match(dateKeyInTimezone(new Date(), "Not/AZone"), /^\d{4}-\d{2}-\d{2}$/);
});

test("date-key arithmetic is calendar based", () => {
  assert.equal(addDaysToDateKey("2026-10-01", -1), "2026-09-30");
  assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
  assert.equal(dayOfWeekOfDateKey("2026-10-09"), 5); // Friday
});

test("entry times are interpreted in the company timezone", () => {
  assert.equal(zonedDateTimeToIso("2026-10-08", "09:00", "Asia/Kolkata"), "2026-10-08T03:30:00.000Z");
  assert.equal(zonedDateTimeToIso("2026-10-08", "09:00", "UTC"), "2026-10-08T09:00:00.000Z");
  assert.equal(zonedDateTimeToIso("2026-10-08", "", "UTC"), null);
});

test("projects follow the chosen client and tasks follow the chosen project", () => {
  assert.deepEqual(projectsForClient(options, "c1").map((p) => p._id), ["p1", "p2"]);
  assert.deepEqual(projectsForClient(options, "c2").map((p) => p._id), ["p2"]);
  assert.deepEqual(projectsForClient(options, "").map((p) => p._id), ["p1", "p2"]);
  assert.deepEqual(tasksForProject(options, "p2").map((t) => t._id), ["t2"]);
  assert.deepEqual(tasksForProject(options, ""), []);
});

test("manual-entry UI: manager and HR act on every employee, leads only on their team", () => {
  const manager = { _id: "manager", role: "manager" };
  const hr = { _id: "hr", role: "hr" };
  const lead = { _id: "lead", role: "team_lead", team: "team" };
  const employee = { _id: "employee", role: "employee", team: "team" };
  for (const actor of [manager, hr]) {
    assert.equal(canManageManualEntries(actor, actor), true);
    for (const role of ["employee", "team_lead", "hr", "manager", "admin", "alpha"]) {
      assert.equal(canManageManualEntries(actor, { _id: `other-${role}`, role }), true, `${actor.role} -> ${role}`);
    }
  }
  assert.equal(canManageManualEntries(lead, employee), true);
  assert.equal(canManageManualEntries(lead, lead), false);
  assert.equal(canManageManualEntries(lead, { ...employee, role: "team_lead" }), false);
  assert.equal(canManageManualEntries(lead, { ...employee, team: "other" }), false);
  assert.equal(canManageManualEntries(employee, employee), false);
});

test("populated project identifiers still match and projects without linked tasks are not offered", () => {
  const populated = { ...options, tasks: [{ _id: "t2", project: { _id: "p2", projectName: "Audit" } }] };
  assert.deepEqual(tasksForProject(populated, "p2").map((task) => task._id), ["t2"]);
  assert.deepEqual(projectsForClient(populated, "c1").map((project) => project._id), ["p2"]);
  assert.deepEqual(projectsForClient({ ...options, tasks: [] }, ""), []);
});

const NOW = new Date("2026-10-09T12:00:00Z");
const form = (overrides = {}) => ({ ...emptyEntryForm(NOW), client: "c1", project: "p1", task: "t1",
  date: "2026-10-08", startTime: "09:00", endTime: "11:30", reason: "Timer was not started", ...overrides });

test("a valid form produces the API payload with exact UTC times", () => {
  const { errors, payload, seconds } = validateEntryForm(form(), options, "emp", NOW, "Asia/Kolkata");
  assert.deepEqual(errors, {});
  assert.equal(seconds, 9000);
  assert.deepEqual(payload, {
    employee: "emp", client: "c1", project: "p1", task: "t1",
    startedAt: "2026-10-08T03:30:00.000Z", stoppedAt: "2026-10-08T06:00:00.000Z", reason: "Timer was not started",
  });
});

test("required fields and invalid combinations are blocked", () => {
  const check = (overrides) => validateEntryForm(form(overrides), options, "emp", NOW, "Asia/Kolkata");
  assert.ok(check({ project: "" }).errors.project);
  assert.ok(check({ client: "c2", project: "p1", task: "t1" }).errors.project, "project of another client");
  assert.ok(check({ task: "" }).errors.task);
  assert.ok(check({ task: "t2" }).errors.task, "task of another project");
  assert.ok(check({ startTime: "" }).errors.startTime);
  assert.ok(check({ endTime: "08:00" }).errors.endTime, "end before start");
  assert.ok(check({ reason: "no" }).errors.reason);
  assert.ok(check({ date: "2026-10-10", startTime: "10:00", endTime: "11:00" }).errors.endTime, "future");
  assert.equal(check({ project: "" }).payload, null);
});

test("status wording: manual entries are labelled and disconnects stay neutral", () => {
  const stoppedAt = "2026-10-08T06:00:00.000Z";
  const entry = { type: "work", end: stoppedAt };
  assert.equal(reportEntryStatus({ stoppedAt }, entry), "Completed");
  assert.equal(reportEntryStatus({ stoppedAt, entrySource: "manual" }, entry), "Manual entry");
  assert.equal(reportEntryStatus({ stoppedAt, stopReason: "desktop_disconnected" }, entry), "Desktop connection lost");
  assert.equal(reportEntryStatus({ stoppedAt, stopReason: "desktop_disconnected" }, { ...entry, isOpen: true }), "Running");
  assert.equal(reportEntryStatus({}, { type: "break", isOpen: true }), "On break");
});
