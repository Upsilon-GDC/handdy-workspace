const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateBillingLogs,
  aggregateBillingMembers,
  getBillingDateRange,
  getBillingEmployeeAccess,
} = require("../src/utils/billingUtils");

const employee = {
  _id: "64b000000000000000000001",
  employeeId: "EMP-1",
  fullName: "Lee Thomas",
  projectRates: [
    { project: "64b000000000000000000000021", chargeRate: 25 },
    { project: "64b000000000000000000000023", chargeRate: 30 },
  ],
};
const workTask = { _id: "64b000000000000000000000011", taskName: "Tax Preparation", taskType: "work" };
const secondTask = { _id: "64b000000000000000000000012", taskName: "Review", taskType: "work" };
const breakTask = { _id: "64b000000000000000000000013", taskName: "Break", taskType: "break" };
const project = { _id: "64b000000000000000000000021", projectName: "ABC CPA", clientName: "ABC", serviceType: "Tax" };

const log = (id, taskRecord, startedAt, seconds, projectRecord = project) => ({
  _id: id,
  employee: employee._id,
  task: taskRecord._id,
  project: projectRecord._id,
  taskRecord,
  projectRecord,
  startedAt: new Date(startedAt),
  stoppedAt: new Date(Date.parse(startedAt) + seconds * 1000),
  totalWorkedSeconds: seconds,
  pauses: [],
});

const reportFor = (logs, startDate = "2026-08-01", endDate = "2026-08-03", employeeRecord = employee) => {
  const range = getBillingDateRange(startDate, endDate, "UTC");
  return aggregateBillingLogs({ logs, employee: employeeRecord, startDate, endDate, timezone: "UTC", rangeStart: range.start, rangeEnd: range.endExclusive });
};

test('team billing preserves employee rates, missing rates and members without time', () => {
  const second = { ...employee, _id: 'second', employeeId: 'EMP-2', fullName: 'Second Member', projectRates: [{ project: project._id, chargeRate: 40 }] };
  const missing = { ...employee, _id: 'missing', fullName: 'Missing Rate', projectRates: [] };
  const idle = { ...employee, _id: 'idle', fullName: 'No Time' };
  const reports = [reportFor([log('a', workTask, '2026-08-01T09:00:00Z', 3600)]), reportFor([log('b', workTask, '2026-08-01T09:00:00Z', 7200)], undefined, undefined, second), reportFor([log('c', workTask, '2026-08-01T10:00:00Z', 3600)], undefined, undefined, missing), reportFor([], undefined, undefined, idle)];
  const result = aggregateBillingMembers({ reports, scope: { label: 'Tax team', type: 'team' }, period: reports[0].period });
  assert.equal(result.scope.memberCount, 4);
  assert.equal(result.summary.taskSeconds, 14400);
  assert.equal(result.summary.totalBillableAmount, 105);
  assert.equal(result.summary.taskCount, 1);
  assert.equal(result.summary.missingRateCount, 1);
  assert.equal(result.summary.workingDays, 1);
  assert.equal(result.members.find(row => row._id === 'idle').totalSeconds, 0);
  assert.equal(result.taskSummary.find(row => row.memberId === 'second').chargeRate, 40);
  assert.equal(result.projects[0].tasks.length, 3);
  assert.equal(new Set(result.projects[0].tasks.map(row => row.key)).size, 3);
  assert.equal(result.dailyDetails[0].totalBillableAmount, 105);
  assert.equal(result.dailyDetails[0].hasMissingRates, true);
  assert.equal(result.dailyDetails[0].allRatesMissing, false);
  assert.equal(result.warnings[0].employeeName, 'Missing Rate');
});

test('an empty team returns a valid zero billing report', () => {
  const result = aggregateBillingMembers({ reports: [], scope: { label: 'Empty team' }, period: { startDate: '2026-08-01', endDate: '2026-08-01', timezone: 'UTC' } });
  assert.equal(result.summary.totalBillableAmount, 0);
  assert.equal(result.scope.memberCount, 0);
  assert.deepEqual(result.dailyDetails, []);
  assert.deepEqual(result.members, []);
});

test("recorded clients split shared-project billing without duplicating totals", () => {
  const first = { ...log("client-a-log", workTask, "2026-08-01T09:00:00Z", 3600), client: "client-a", clientRecord: { clientName: "Selected A" } };
  const second = { ...log("client-b-log", workTask, "2026-08-01T10:00:00Z", 7200), client: "client-b", clientRecord: { clientName: "Selected B" } };
  const report = reportFor([first, second]);
  assert.deepEqual(report.taskSummary.map((task) => [task.clientName, task.totalSeconds]), [["Selected A", 3600], ["Selected B", 7200]]);
  assert.equal(report.projects.length, 2);
  assert.equal(report.summary.projectCount, 1);
  assert.equal(report.summary.taskCount, 1);
  assert.equal(report.summary.taskSeconds, 10_800);
  assert.equal(report.summary.totalBillableAmount, 75);
  assert.deepEqual(report.dailyDetails[0].entries.map((entry) => entry.clientName), ["Selected A", "Selected B"]);
});

test("ambiguous legacy work and deleted recorded clients are never assigned to a different client", () => {
  const shared = { ...project, clients: [{ _id: "a", clientName: "A" }, { _id: "b", clientName: "B" }] };
  const report = reportFor([
    log("legacy", workTask, "2026-08-01T09:00:00Z", 3600, shared),
    { ...log("deleted", workTask, "2026-08-01T10:00:00Z", 3600, shared), client: "deleted-client" },
  ]);
  assert.deepEqual(report.dailyDetails[0].entries.map((entry) => entry.clientName), ["Unassigned client", "Deleted client"]);
  assert.equal(report.summary.taskSeconds, 7200);
  assert.equal(report.summary.totalBillableAmount, 50);
});

test("same task across days and sessions is aggregated by task ID", () => {
  const report = reportFor([
    log("1", workTask, "2026-08-01T09:00:00Z", 3600),
    log("2", workTask, "2026-08-02T09:00:00Z", 7200),
    log("3", workTask, "2026-08-03T09:00:00Z", 2700),
  ]);
  assert.equal(report.taskSummary.length, 1);
  assert.equal(report.taskSummary[0].totalSeconds, 13_500);
  assert.equal(report.summary.taskSeconds, 13_500);
});

test("multiple work tasks and break tasks have separate totals", () => {
  const report = reportFor([
    log("1", workTask, "2026-08-01T09:00:00Z", 10_800),
    log("2", secondTask, "2026-08-01T12:00:00Z", 7200),
    log("3", breakTask, "2026-08-01T14:00:00Z", 3600),
  ]);
  assert.equal(report.summary.taskSeconds, 18_000);
  assert.equal(report.summary.breakSeconds, 3600);
  assert.equal(report.summary.totalSeconds, 21_600);
  assert.equal(report.taskSummary.length, 2);
});

test("billing applies the employee rate for each task project ID", () => {
  const report = reportFor([
    log("1", workTask, "2026-08-01T09:00:00Z", 7200),
    log("2", secondTask, "2026-08-01T11:00:00Z", 1800, {
      _id: "64b000000000000000000000023",
      projectName: "Audit project",
      serviceType: "Audit",
    }),
  ]);
  const auditSummary = report.taskSummary.find((task) => task.serviceType === "Audit");
  const taxSummary = report.taskSummary.find((task) => task.serviceType === "Tax");
  assert.equal(auditSummary.billableAmount, 15);
  assert.equal(taxSummary.billableAmount, 50);
  assert.equal(report.summary.totalBillableAmount, 65);
  assert.equal(report.summary.missingRateCount, 0);
});

test("billing ignores service text and uses the project's database ID", () => {
  const taskWithStaleService = { ...workTask, serviceType: "Audit" };
  const report = reportFor([log("1", taskWithStaleService, "2026-08-01T09:00:00Z", 3600)]);
  assert.equal(report.taskSummary[0].serviceType, "Tax");
  assert.equal(report.taskSummary[0].chargeRate, 25);
  assert.equal(report.taskSummary[0].billableAmount, 25);
});

test("billing amount keeps full hour precision and rounds only the final currency value", () => {
  const report = reportFor([log("1", workTask, "2026-08-01T09:00:00Z", 11_040)]);
  assert.equal(report.taskSummary[0].totalSeconds, 11_040);
  // 11,040s = 3.06666...h x $25 = $76.666... -> $76.67 (not 3.07h x $25 = $76.75).
  assert.equal(report.taskSummary[0].billableAmount, 76.67);
});

test("daily billing row reports billable seconds, an exact amount and missing-rate state", () => {
  // 7h 56m at $25 = 28,560s -> $198.33; precision is not lost to hour rounding.
  const priced = reportFor([log("1", workTask, "2026-08-01T09:00:00Z", 28_560)]);
  const [day] = priced.dailyDetails;
  assert.equal(day.billableSeconds, 28_560);
  assert.equal(day.totalBillableAmount, 198.33);
  assert.equal(day.hasMissingRates, false);
  assert.equal(day.allRatesMissing, false);
});

test("billing returns a warning and no amount when a project rate is missing", () => {
  const bookkeepingTask = {
    _id: "64b000000000000000000000099",
    taskName: "Monthly books",
    taskType: "work",
  };
  const bookkeepingProject = {
    _id: "64b000000000000000000000024",
    projectName: "Books project",
    serviceType: "Bookkeeping",
  };
  const report = reportFor([log("1", bookkeepingTask, "2026-08-01T09:00:00Z", 3600, bookkeepingProject)]);
  assert.equal(report.taskSummary[0].chargeRate, null);
  assert.equal(report.taskSummary[0].billableAmount, null);
  assert.equal(report.taskSummary[0].billingWarning, "Charge rate not configured for this employee and project.");
  assert.equal(report.summary.totalBillableAmount, 0);
  assert.equal(report.summary.missingRateCount, 1);
});

test("renaming a project does not break its ID-based billing rate", () => {
  const renamedProject = { ...project, projectName: "Completely Renamed Project", serviceType: "Audit" };
  const report = reportFor([log("1", workTask, "2026-08-01T09:00:00Z", 3600, renamedProject)]);
  assert.equal(report.taskSummary[0].projectName, "Completely Renamed Project");
  assert.equal(report.taskSummary[0].billableAmount, 25);
});

test("an edited employee project rate changes the billing total", () => {
  const employeeWithEditedRate = {
    ...employee,
    projectRates: [{ project: project._id, chargeRate: 40 }],
  };
  const report = reportFor(
    [log("1", workTask, "2026-08-01T09:00:00Z", 7200)],
    "2026-08-01",
    "2026-08-03",
    employeeWithEditedRate,
  );
  assert.equal(report.taskSummary[0].chargeRate, 40);
  assert.equal(report.taskSummary[0].billableAmount, 80);
  assert.equal(report.summary.totalBillableAmount, 80);
});

test("paused time is not added back into a completed timer session", () => {
  const pausedLog = log("1", workTask, "2026-08-01T09:00:00Z", 5400);
  pausedLog.totalWorkedSeconds = 3600;
  pausedLog.pauses = [{ pausedAt: new Date("2026-08-01T09:30:00Z"), resumedAt: new Date("2026-08-01T10:00:00Z") }];
  const report = reportFor([pausedLog]);
  assert.equal(report.summary.taskSeconds, 3600);
  assert.equal(report.summary.totalSeconds, 3600);
});

test("same task and project names do not cause rates to match across project IDs", () => {
  const otherProject = { _id: "64b000000000000000000000022", projectName: project.projectName, serviceType: "Tax" };
  const sameNameTask = { _id: "64b000000000000000000000014", taskName: "Tax Preparation", taskType: "work" };
  const report = reportFor([
    log("1", workTask, "2026-08-01T09:00:00Z", 3600),
    log("2", sameNameTask, "2026-08-01T10:00:00Z", 3600, otherProject),
  ]);
  assert.equal(report.taskSummary.length, 2);
  assert.equal(report.projects.length, 2);
  assert.equal(report.taskSummary.find((task) => task.projectId === project._id).billableAmount, 25);
  assert.equal(report.taskSummary.find((task) => task.projectId === otherProject._id).billableAmount, null);
  assert.equal(report.summary.totalBillableAmount, 25);
});

test("date boundaries clip overnight records to the selected period", () => {
  const report = reportFor([
    log("1", workTask, "2026-07-31T23:00:00Z", 7200),
    log("2", workTask, "2026-08-04T00:00:00Z", 3600),
  ], "2026-08-01", "2026-08-03");
  assert.equal(report.summary.taskSeconds, 3600);
  assert.equal(report.dailyDetails.length, 1);
  assert.equal(report.dailyDetails[0].date, "2026-08-01");
});

test("billing range uses the configured timezone and rejects excessive ranges", () => {
  const range = getBillingDateRange("2026-08-01", "2026-08-01", "Asia/Kolkata");
  assert.equal(range.start.toISOString(), "2026-07-31T18:30:00.000Z");
  assert.equal(range.endExclusive.toISOString(), "2026-08-01T18:30:00.000Z");
  assert.throws(() => getBillingDateRange("2025-01-01", "2026-08-01", "UTC"), /cannot exceed/);
});

test("billing employee access is restricted to administrators, managers and hr", () => {
  const employeeAccess = getBillingEmployeeAccess({ _id: "employee-1", role: "employee" }, "employee-2");
  const teamAccess = getBillingEmployeeAccess({ _id: "lead-1", role: "team_lead" }, "employee-2");
  assert.equal(employeeAccess.forbidden, true);
  assert.equal(teamAccess.forbidden, true);
  const adminAccess = getBillingEmployeeAccess({ _id: "admin-1", role: "admin" }, "employee-2");
  assert.deepEqual(adminAccess.filter, { _id: "employee-2" });
  const hrAccess = getBillingEmployeeAccess({ _id: "hr-1", role: "hr" }, "employee-2");
  assert.deepEqual(hrAccess.filter, { _id: "employee-2" });
  const managerAccess = getBillingEmployeeAccess({ _id: "manager-1", role: "manager" }, "employee-2");
  assert.deepEqual(managerAccess.filter, { _id: "employee-2" });
});

const thirtyDollarProject = { _id: "64b000000000000000000000023", projectName: "FTC filing", serviceType: "FTC" };
const unratedProject = { _id: "64b000000000000000000000024", projectName: "Books project", serviceType: "Bookkeeping" };

test("7h 56m at $30/hour bills exactly $238.00 and excludes breaks from billable hours", () => {
  const report = reportFor([
    log("1", workTask, "2026-08-01T09:00:00Z", 28_560, thirtyDollarProject),
    log("2", breakTask, "2026-08-01T17:00:00Z", 1_800, thirtyDollarProject),
  ]);
  const [day] = report.dailyDetails;
  assert.equal(day.billableSeconds, 28_560);
  assert.equal(day.breakSeconds, 1_800);
  assert.equal(day.totalBillableAmount, 238);
});

test("a day with several service rates sums each task separately and rounds once", () => {
  const report = reportFor([
    log("1", workTask, "2026-08-01T09:00:00Z", 3_600, project),
    log("2", secondTask, "2026-08-01T11:00:00Z", 5_400, thirtyDollarProject),
  ]);
  const [day] = report.dailyDetails;
  assert.equal(day.billableSeconds, 9_000);
  assert.equal(day.totalBillableAmount, 70); // 1h x $25 + 1.5h x $30
});

test("a day without any configured rate flags Missing Rate and never invents an amount", () => {
  const report = reportFor([log("1", workTask, "2026-08-01T09:00:00Z", 3_600, unratedProject)]);
  const [day] = report.dailyDetails;
  assert.equal(day.hasMissingRates, true);
  assert.equal(day.allRatesMissing, true);
  assert.equal(day.totalBillableAmount, 0);
  assert.equal(day.entries[0].billableAmount, null);
});

test("a partly rated day keeps the known subtotal but is flagged as incomplete", () => {
  const report = reportFor([
    log("1", workTask, "2026-08-01T09:00:00Z", 3_600, project),
    log("2", secondTask, "2026-08-01T11:00:00Z", 3_600, unratedProject),
  ]);
  const [day] = report.dailyDetails;
  assert.equal(day.hasMissingRates, true);
  assert.equal(day.allRatesMissing, false);
  assert.equal(day.totalBillableAmount, 25);
});
