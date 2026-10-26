import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Clock3, Download, FileSearch, FolderKanban, ReceiptText, UsersRound } from "lucide-react";

import DashboardLayout from "../../components/layout/DashboardLayout";
import { getBillingEmployees, getBillingReport } from "../../api/billingApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import useAuth from "../../context/useAuth";
import { addDaysToDateKey, dayOfWeekOfDateKey, todayDateKey } from "../../utils/appDate";

import "../../styles/billingPage.css";

// Periods are computed from today's date in the business timezone, the same
// calendar the backend uses for billing day boundaries.
const getPeriodDates = (period) => {
  const today = todayDateKey();
  if (period === "yesterday") {
    const date = addDaysToDateKey(today, -1);
    return [date, date];
  }
  if (period === "this-week" || period === "last-week") {
    const mondayOffset = (dayOfWeekOfDateKey(today) + 6) % 7;
    const thisMonday = addDaysToDateKey(today, -mondayOffset);
    const start = period === "last-week" ? addDaysToDateKey(thisMonday, -7) : thisMonday;
    const end = period === "last-week" ? addDaysToDateKey(thisMonday, -1) : today;
    return [start, end];
  }
  if (period === "this-month" || period === "last-month") {
    const monthStart = `${today.slice(0, 8)}01`;
    if (period === "this-month") return [monthStart, today];
    const lastMonthEnd = addDaysToDateKey(monthStart, -1);
    return [`${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd];
  }
  return [today, today];
};

const formatDuration = (seconds = 0) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
};

const formatClockDuration = (seconds = 0) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 3600)).padStart(2, "0")}:${String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, "0")}`;
};

const toDecimalHours = (seconds = 0) =>
  Math.round((Math.max(0, Number(seconds) || 0) / 3600) * 100) / 100;

const formatMoney = (amount, missingMessage = "Charge rate not configured for this employee and project.") => amount === null || amount === undefined
  ? missingMessage
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const formatRate = (rate, missingMessage = "Charge rate not configured for this employee and project.") => rate === null || rate === undefined
  ? missingMessage
  : `${formatMoney(rate)} / hour`;

const formatDecimalCells = (worksheet) => {
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === "number") {
        cell.numFmt = "0.0#";
      }
    });
  });
  return worksheet;
};

const formatDate = (dateKey) => new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "short", day: "numeric",
}).format(new Date(`${dateKey}T00:00:00`));

const recordId = (value) => String(value?._id || value?.id || value || "");

function BillingContent() {
  // Exports are built in the browser, so this only controls the button.
  const canExport = useAuth().hasPermission("export_reports");
  const initialDates = getPeriodDates("today");
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [period, setPeriod] = useState("today");
  const [fromDate, setFromDate] = useState(initialDates[0]);
  const [toDate, setToDate] = useState(initialDates[1]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadEmployees = async () => {
      try {
        const data = await getBillingEmployees();
        if (!active) return;
        const nextEmployees = data.employees || [];
        const nextTeams = data.teams || [];
        setEmployees(nextEmployees);
        setTeams(nextTeams);
        const firstTeam = nextTeams[0];
        const firstEmployee = firstTeam
          ? nextEmployees.find((employee) => recordId(employee.team) === recordId(firstTeam))
          : nextEmployees[0];
        setTeamId(firstTeam ? recordId(firstTeam) : "all");
        setEmployeeId(recordId(firstEmployee));
      } catch (requestError) {
        if (active) setError(getApiErrorMessage(requestError, "Unable to load employees for Billing."));
      }
    };
    void loadEmployees();
    return () => { active = false; };
  }, []);

  const filteredEmployees = useMemo(() => {
    if (teamId === "all") return employees;
    if (teamId === "unassigned") return employees.filter((employee) => !recordId(employee.team));
    return employees.filter((employee) => recordId(employee.team) === teamId);
  }, [employees, teamId]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => recordId(employee) === employeeId),
    [employeeId, employees],
  );
  // Projects no longer carry a service type (rates are set per project), so
  // only legacy projects have one. Show the column only when it has data.
  const showServiceType = Boolean(report?.taskSummary?.some((task) => task.serviceType));

  const changeTeam = (value) => {
    setTeamId(value);
    setReport(null);
    let nextEmployees = employees;
    if (value === "unassigned") nextEmployees = employees.filter((employee) => !recordId(employee.team));
    else if (value !== "all") {
      nextEmployees = employees.filter((employee) => recordId(employee.team) === value);
    }
    setEmployeeId(recordId(nextEmployees[0]));
  };

  const changePeriod = (value) => {
    setPeriod(value);
    if (value !== "custom") {
      const [start, end] = getPeriodDates(value);
      setFromDate(start);
      setToDate(end);
    }
  };

  const generateReport = async () => {
    if (!employeeId) {
      setError("Select an employee before generating the report.");
      return;
    }
    if (!fromDate || !toDate || toDate < fromDate) {
      setError("Select a valid From and To date.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const data = await getBillingReport({ employee: employeeId, startDate: fromDate, endDate: toDate });
      setReport(data.report);
    } catch (requestError) {
      setReport(null);
      setError(getApiErrorMessage(requestError, "Unable to generate the billing report."));
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async () => {
    if (!report) return;
    const ExcelJSModule = await import("exceljs");
    const ExcelJS = ExcelJSModule.default || ExcelJSModule;
    const titleRows = [
      ["Billing Report"],
      ["Employee", report.employee.fullName],
      ["Employee ID", report.employee.employeeId],
      ["Period", `${formatDate(report.period.startDate)} - ${formatDate(report.period.endDate)}`],
      [],
      ["Task Summary"],
      ["Project", "Client", "Service Type", "Task", "Description", "Total Hours", "Decimal Hours", "Hourly Rate", "Billable Amount", "Warning"],
      ...report.taskSummary.map((task) => [
        task.projectName,
        task.clientName,
        task.serviceType || "",
        task.taskName,
        task.taskDescription,
        formatClockDuration(task.totalSeconds),
        toDecimalHours(task.totalSeconds),
        task.chargeRate,
        task.billableAmount,
        task.billingWarning || "",
      ]),
      [],
      ["Time Summary"],
      ["Metric", "Total Hours", "Decimal Hours"],
      ["Task Hours", formatClockDuration(report.summary.taskSeconds), toDecimalHours(report.summary.taskSeconds)],
      ["Break Hours", formatClockDuration(report.summary.breakSeconds), toDecimalHours(report.summary.breakSeconds)],
      ["Total Recorded Hours", formatClockDuration(report.summary.totalSeconds), toDecimalHours(report.summary.totalSeconds)],
      ["Calculated Billable Amount", "", report.summary.totalBillableAmount],
      ["Rate Warnings", "", report.summary.missingRateCount || 0],
    ];
    const dailyRows = [
      ["Date", "Type", "Project", "Client", "Service Type", "Task", "Description", "Start", "End", "Duration", "Decimal Hours", "Hourly Rate", "Billable Amount", "Warning"],
      ...report.dailyDetails.flatMap((day) => day.entries.map((entry) => [
        day.date,
        entry.type === "break" ? "Break" : "Task",
        entry.projectName,
        entry.clientName,
        entry.serviceType || "",
        entry.taskName,
        entry.taskDescription,
        new Date(entry.startedAt).toLocaleString(undefined, { timeZone: report.period.timezone }),
        new Date(entry.stoppedAt).toLocaleString(undefined, { timeZone: report.period.timezone }),
        formatClockDuration(entry.durationSeconds),
        toDecimalHours(entry.durationSeconds),
        entry.chargeRate,
        entry.billableAmount,
        entry.billingWarning || "",
      ])),
    ];
    const workbook = new ExcelJS.Workbook();
    const summarySheet = workbook.addWorksheet("Billing Summary");
    const dailySheet = workbook.addWorksheet("Daily Details");
    summarySheet.addRows(titleRows);
    dailySheet.addRows(dailyRows);
    formatDecimalCells(summarySheet);
    formatDecimalCells(dailySheet);
    for (let row = 8; row < 8 + report.taskSummary.length; row += 1) {
      summarySheet.getCell(row, 8).numFmt = "$0.00";
      summarySheet.getCell(row, 9).numFmt = "$0.00";
    }
    summarySheet.getCell(14 + report.taskSummary.length, 3).numFmt = "$0.00";
    for (let row = 2; row < 2 + dailyRows.length - 1; row += 1) {
      dailySheet.getCell(row, 12).numFmt = "$0.00";
      dailySheet.getCell(row, 13).numFmt = "$0.00";
    }
    summarySheet.columns = [
      { width: 24 }, { width: 22 }, { width: 22 }, { width: 24 },
      { width: 36 }, { width: 16 }, { width: 16 }, { width: 16 },
      { width: 18 }, { width: 28 },
    ];
    dailySheet.columns = [
      { width: 14 }, { width: 12 }, { width: 24 }, { width: 22 },
      { width: 22 }, { width: 24 }, { width: 36 }, { width: 24 },
      { width: 24 }, { width: 14 }, { width: 16 }, { width: 16 },
      { width: 18 }, { width: 28 },
    ];
    const safeName = report.employee.fullName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const fileName = `Billing-${safeName}-${report.period.startDate}-${report.period.endDate}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const downloadUrl = URL.createObjectURL(new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };

  return (
    <div className="billing-page">
      <section className="billing-hero">
        <div><span>Company billing</span><h2>Billing report</h2><p>Aggregate completed task and break time from the existing employee timer.</p></div>
        {report && canExport && <button type="button" className="billing-export" onClick={exportReport}><Download size={17} />Export Excel</button>}
      </section>

      <section className="billing-filters card" aria-label="Billing report filters">
        <label><span>Team</span><select value={teamId} onChange={(event) => changeTeam(event.target.value)}><option value="all">All teams</option>{teams.map((team) => <option key={recordId(team)} value={recordId(team)}>{team.teamName}</option>)}<option value="unassigned">Unassigned employees</option></select></label>
        <label><span>Employee</span><select value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setReport(null); }} disabled={filteredEmployees.length === 0}>{filteredEmployees.length === 0 && <option value="">No employees in this team</option>}{filteredEmployees.map((employee) => <option key={recordId(employee)} value={recordId(employee)}>{employee.fullName} ({employee.employeeId})</option>)}</select></label>
        <label><span>Date period</span><select value={period} onChange={(event) => changePeriod(event.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this-week">This week</option><option value="last-week">Last week</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom date range</option></select></label>
        <label><span>From date</span><input type="date" value={fromDate} onChange={(event) => { setPeriod("custom"); setFromDate(event.target.value); }} /></label>
        <label><span>To date</span><input type="date" min={fromDate} value={toDate} onChange={(event) => { setPeriod("custom"); setToDate(event.target.value); }} /></label>
        <button type="button" className="billing-generate" onClick={generateReport} disabled={loading || !employeeId}><ReceiptText size={17} />{loading ? "Generating..." : "Generate report"}</button>
      </section>

      {error && <p className="billing-error" role="alert">{error}</p>}
      {!report && !error && <section className="billing-empty card"><FileSearch size={30} /><h3>Choose an employee and period</h3><p>Generate a report to see task totals, break time, project groups, and daily details.</p></section>}

      {report && (
        <>
          <section className="billing-summary-grid">
            <article className="card"><UsersRound size={20} /><span>Employee</span><strong>{report.employee.fullName}</strong><small>{report.employee.employeeId}</small></article>
            <article className="card"><CalendarRange size={20} /><span>Selected period</span><strong>{formatDate(report.period.startDate)} - {formatDate(report.period.endDate)}</strong><small>{report.summary.workingDays} working days</small></article>
            <article className="card"><Clock3 size={20} /><span>Task hours</span><strong>{formatDuration(report.summary.taskSeconds)}</strong><small>{report.summary.taskCount} tasks</small></article>
            <article className="card break-card"><Clock3 size={20} /><span>Break hours</span><strong>{formatDuration(report.summary.breakSeconds)}</strong><small>Recorded break tasks</small></article>
            <article className="card total-card"><ReceiptText size={20} /><span>Total recorded</span><strong>{formatDuration(report.summary.totalSeconds)}</strong><small>{report.summary.projectCount} projects</small></article>
            <article className="card billing-amount-card"><ReceiptText size={20} /><span>{report.summary.missingRateCount ? "Calculated subtotal" : "Billable amount"}</span><strong>{formatMoney(report.summary.totalBillableAmount)}</strong><small>{report.summary.missingRateCount ? `Excludes ${report.summary.missingRateCount} task(s) with missing rates` : "All rates configured"}</small></article>
          </section>

          {report.warnings?.length > 0 && (
            <section className="billing-rate-warning" role="alert">
              <strong>Billing configuration required.</strong>
              <span>{report.warnings.map((warning) => `${warning.projectName} / ${warning.taskName}: ${warning.message}`).join(" ")}</span>
            </section>
          )}

          <section className="billing-report card">
            <header><div><span>Primary report</span><h3>Project-wise task summary</h3></div><strong>{formatDuration(report.summary.taskSeconds)}</strong></header>
            {report.projects.length === 0 ? <div className="billing-no-data">No completed task time was recorded in this period.</div> : report.projects.map((project) => (
              <article className="billing-project" key={project.key || project.projectId}>
                <div className="billing-project-heading"><div><FolderKanban size={18} /><div><h4>{project.projectName}</h4><p>{project.clientName || project.projectCode || "No client assigned"}</p></div></div><div className="billing-project-totals"><strong>{formatDuration(project.totalSeconds)}</strong><span>{project.hasMissingRates ? "Known subtotal: " : ""}{formatMoney(project.totalBillableAmount)}{project.hasMissingRates ? " (missing rates excluded)" : ""}</span></div></div>
                <div className="billing-table-wrap"><table><thead><tr>{showServiceType && <th>Service type</th>}<th>Task</th><th>Description</th><th>Total time</th><th>Hourly rate</th><th>Billable amount</th></tr></thead><tbody>{project.tasks.map((task) => <tr key={task.taskId}>{showServiceType && <td>{task.serviceType || "-"}</td>}<td><strong>{task.taskName}</strong>{task.taskCode && <small>{task.taskCode}</small>}</td><td>{task.taskDescription || "-"}</td><td>{formatClockDuration(task.totalSeconds)}</td><td className={task.billingWarning ? "billing-missing-rate" : ""}>{formatRate(task.chargeRate, task.billingWarning)}</td><td className={task.billingWarning ? "billing-missing-rate" : ""}>{formatMoney(task.billableAmount, task.billingWarning)}</td></tr>)}</tbody></table></div>
              </article>
            ))}
          </section>

          <section className="billing-daily card">
            <header><div><span>Audit detail</span><h3>Daily details</h3></div><p>Expand a date to review individual timer sessions.</p></header>
            {report.dailyDetails.length === 0 ? <div className="billing-no-data">No completed timer records were found.</div> : report.dailyDetails.map((day) => (
              <details key={day.date}>
                <summary>
                  <span className="billing-day-date">{formatDate(day.date)}</span>
                  <span className="billing-day-cell"><small>Billable hours</small><strong>{formatDuration(day.taskSeconds)}</strong></span>
                  <span className="billing-day-cell billing-day-amount">
                    <small>Billing amount</small>
                    {day.allRatesMissing
                      ? <strong className="billing-missing-rate">Missing Rate</strong>
                      : <strong>{formatMoney(day.totalBillableAmount)}{day.hasMissingRates && <em className="billing-missing-rate"> + Missing Rate</em>}</strong>}
                  </span>
                </summary>
                <div className="billing-table-wrap"><table><thead><tr><th>Type</th><th>Project</th>{showServiceType && <th>Service</th>}<th>Task</th><th>Start</th><th>End</th><th>Time</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{day.entries.map((entry, index) => <tr key={`${entry.logId}-${index}`}><td><span className={`billing-type ${entry.type}`}>{entry.type === "break" ? "Break" : "Task"}</span></td><td>{entry.projectName}</td>{showServiceType && <td>{entry.serviceType || "-"}</td>}<td>{entry.taskName}</td><td>{new Date(entry.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: report.period.timezone })}</td><td>{new Date(entry.stoppedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: report.period.timezone })}</td><td>{formatDuration(entry.durationSeconds)}</td><td className={entry.billingWarning ? "billing-missing-rate" : ""}>{entry.type === "break" ? "-" : formatRate(entry.chargeRate, entry.billingWarning)}</td><td className={entry.billingWarning ? "billing-missing-rate" : ""}>{entry.type === "break" ? "-" : formatMoney(entry.billableAmount, entry.billingWarning)}</td></tr>)}</tbody></table></div>
              </details>
            ))}
          </section>
        </>
      )}
      {selectedEmployee?.isActive === false && <p className="billing-history-note">This employee is inactive; historical completed records remain available.</p>}
    </div>
  );
}

function BillingPage() {
  return <DashboardLayout title="Billing"><BillingContent /></DashboardLayout>;
}

export default BillingPage;
