import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Clock3, Download, FileSearch, FolderKanban, ReceiptText, UsersRound } from "lucide-react";

import DashboardLayout from "../../components/layout/DashboardLayout";
import { getBillingEmployees, getBillingReport, getProductionReport } from "../../api/billingApi";
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

function BillingContent({ productionOnly = false, productionScope = 'overview' }) {
  const productionOverview = productionOnly && productionScope === 'overview';
  const productionTeam = productionOnly && productionScope === 'team';
  const productionEmployee = productionOnly && productionScope === 'employee';
  const productionTitle = productionOverview ? 'Production overview' : productionTeam ? 'Team production' : 'Employee production';
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
        const nextTeam = productionOverview ? 'all' : firstTeam ? recordId(firstTeam) : productionTeam ? 'unassigned' : 'all';
        setTeamId(nextTeam);
        const member = nextEmployees.find(employee => nextTeam === 'all' || (nextTeam === 'unassigned' ? !recordId(employee.team) : recordId(employee.team) === nextTeam));
        setEmployeeId(productionEmployee ? recordId(member) : 'all');
      } catch (requestError) {
        if (active) setError(getApiErrorMessage(requestError, "Unable to load employees for Billing."));
      }
    };
    void loadEmployees();
    return () => { active = false; };
  }, [productionOverview, productionTeam, productionEmployee]);

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
  const groupReport = Boolean(report?.scope);
  const reportName = report?.scope?.label || report?.employee?.fullName || '';

  const changeTeam = (value) => {
    setTeamId(value);
    setReport(null);
    const member = employees.find(employee => value === 'all' || (value === 'unassigned' ? !recordId(employee.team) : recordId(employee.team) === value));
    setEmployeeId(productionEmployee ? recordId(member) : 'all');
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
      setError("Select all members or an employee before generating the report.");
      return;
    }
    if (!fromDate || !toDate || toDate < fromDate) {
      setError("Select a valid From and To date.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const data = await (productionOnly ? getProductionReport : getBillingReport)({ employee: employeeId, ...(employeeId === 'all' ? { team: teamId } : {}), startDate: fromDate, endDate: toDate });
      setReport(data.report);
    } catch (requestError) {
      setReport(null);
      setError(getApiErrorMessage(requestError, productionOnly ? "Unable to generate the production report." : "Unable to generate the billing report."));
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async () => {
    if (!report) return;
    const ExcelJSModule = await import("exceljs");
    const ExcelJS = ExcelJSModule.default || ExcelJSModule;
    const titleRows = [
      [productionOnly ? 'Production Report' : 'Billing Report'],
      [groupReport ? 'Team' : 'Employee', reportName],
      [groupReport ? 'Members' : 'Employee ID', groupReport ? report.scope.memberCount : report.employee.employeeId],
      ["Period", `${formatDate(report.period.startDate)} - ${formatDate(report.period.endDate)}`],
      [],
      ["Task Summary"],
      ["Project", "Client", "Service Type", "Task", "Description", "Total Hours", "Decimal Hours", "Hourly Rate", "Billable Amount", "Warning", "Employee", "Employee ID"],
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
        task.employeeName || report.employee?.fullName || '',
        task.employeeCode || report.employee?.employeeId || '',
      ]),
      [],
      ["Time Summary"],
      ["Metric", "Total Hours", "Decimal Hours"],
      [productionOnly ? 'Production Hours' : 'Task Hours', formatClockDuration(report.summary.taskSeconds), toDecimalHours(report.summary.taskSeconds)],
      ...(!productionOnly ? [
        ["Break / Idle", formatClockDuration((report.summary.breakIdleSeconds ?? report.summary.breakSeconds)), toDecimalHours((report.summary.breakIdleSeconds ?? report.summary.breakSeconds))],
        ["Total Recorded Hours", formatClockDuration((report.summary.recordedSeconds ?? report.summary.totalSeconds)), toDecimalHours((report.summary.recordedSeconds ?? report.summary.totalSeconds))],
      ] : []),
      ["Calculated Billable Amount", "", report.summary.totalBillableAmount],
      ["Rate Warnings", "", report.summary.missingRateCount || 0],
    ];
    const dailyRows = [
      ["Date", "Type", "Project", "Client", "Service Type", "Task", "Description", "Start", "End", "Duration", "Decimal Hours", "Hourly Rate", "Billable Amount", "Warning", "Employee", "Employee ID"],
      ...report.dailyDetails.flatMap((day) => day.entries.map((entry) => [
        day.date,
        entry.type === "break" ? "Break / Idle" : "Task",
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
        entry.employeeName || report.employee?.fullName || '',
        entry.employeeCode || report.employee?.employeeId || '',
      ])),
    ];
    const workbook = new ExcelJS.Workbook();
    if (groupReport) {
      const membersSheet = workbook.addWorksheet('Members');
      membersSheet.addRows([['Employee', 'Employee ID', productionOnly ? 'Production hours' : 'Task hours', ...(!productionOnly ? ['Break / Idle'] : []), 'Billable amount', 'Missing rates'],
        ...report.members.map(member => [member.fullName, member.employeeId, toDecimalHours(member.taskSeconds), ...(!productionOnly ? [toDecimalHours((member.breakIdleSeconds ?? member.breakSeconds))] : []), member.totalBillableAmount, member.missingRateCount])]);
      membersSheet.columns = [{ width: 26 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 16 }];
      membersSheet.getColumn(3).numFmt = '0.0#';
      if (!productionOnly) membersSheet.getColumn(4).numFmt = '0.0#';
      membersSheet.getColumn(productionOnly ? 4 : 5).numFmt = '$0.00';
    }
    const summarySheet = workbook.addWorksheet(productionOnly ? 'Production Summary' : 'Billing Summary');
    const dailySheet = workbook.addWorksheet("Daily Details");
    summarySheet.addRows(titleRows);
    dailySheet.addRows(dailyRows);
    formatDecimalCells(summarySheet);
    formatDecimalCells(dailySheet);
    for (let row = 8; row < 8 + report.taskSummary.length; row += 1) {
      summarySheet.getCell(row, 8).numFmt = "$0.00";
      summarySheet.getCell(row, 9).numFmt = "$0.00";
    }
    summarySheet.getCell(titleRows.findIndex(row => row[0] === 'Calculated Billable Amount') + 1, 3).numFmt = "$0.00";
    for (let row = 2; row < 2 + dailyRows.length - 1; row += 1) {
      dailySheet.getCell(row, 12).numFmt = "$0.00";
      dailySheet.getCell(row, 13).numFmt = "$0.00";
    }
    summarySheet.columns = [
      { width: 24 }, { width: 22 }, { width: 22 }, { width: 24 },
      { width: 36 }, { width: 16 }, { width: 16 }, { width: 16 },
      { width: 18 }, { width: 28 }, { width: 26 }, { width: 18 },
    ];
    dailySheet.columns = [
      { width: 14 }, { width: 12 }, { width: 24 }, { width: 22 },
      { width: 22 }, { width: 24 }, { width: 36 }, { width: 24 },
      { width: 24 }, { width: 14 }, { width: 16 }, { width: 16 },
      { width: 18 }, { width: 28 }, { width: 26 }, { width: 18 },
    ];
    const safeName = reportName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const fileName = `${productionOnly ? 'Production' : 'Billing'}-${safeName}-${report.period.startDate}-${report.period.endDate}.xlsx`;
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
    <div className={`billing-page${productionOnly ? ' production-page' : ''}`} data-production-view={productionOnly ? productionScope : undefined}>
      <section className="billing-hero">
        <div><span>{productionOnly ? 'Production billing' : 'Company billing'}</span><h2>{productionOnly ? productionTitle : 'Billing report'}</h2><p>{productionOnly ? `${productionOverview ? 'All teams and members.' : productionTeam ? 'All members of the selected team.' : 'Production for one employee.'} Billable task work only; Break / Idle time is excluded.` : 'Aggregate completed task and break time from the existing employee timer.'}</p></div>
        {report && canExport && <button type="button" className="billing-export" onClick={exportReport}><Download size={17} />Export Excel</button>}
      </section>

      <section className="billing-filters card" aria-label="Billing report filters">
        {!productionOverview && <label><span>Team</span><select aria-label="Team" disabled={loading} value={teamId} onChange={(event) => changeTeam(event.target.value)}>{!productionTeam && <option value="all">All teams</option>}{teams.map((team) => <option key={recordId(team)} value={recordId(team)}>{team.teamName}</option>)}<option value="unassigned">Unassigned employees</option></select></label>}
        {(!productionOnly || productionEmployee) && <label><span>Employee</span><select aria-label="Employee" disabled={loading || (productionEmployee && !filteredEmployees.length)} value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setReport(null); }}>{!productionEmployee && <option value="all">All members ({filteredEmployees.length})</option>}{productionEmployee && !filteredEmployees.length && <option value="">No employees in this team</option>}{filteredEmployees.map((employee) => <option key={recordId(employee)} value={recordId(employee)}>{employee.fullName} ({employee.employeeId})</option>)}</select></label>}
        <label><span>Date period</span><select aria-label="Date period" disabled={loading} value={period} onChange={(event) => changePeriod(event.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this-week">This week</option><option value="last-week">Last week</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom date range</option></select></label>
        <label><span>From date</span><input type="date" disabled={loading} value={fromDate} onChange={(event) => { setPeriod("custom"); setFromDate(event.target.value); }} /></label>
        <label><span>To date</span><input type="date" disabled={loading} min={fromDate} value={toDate} onChange={(event) => { setPeriod("custom"); setToDate(event.target.value); }} /></label>
        <button type="button" className="billing-generate" onClick={generateReport} disabled={loading || !employeeId}><ReceiptText size={17} />{loading ? "Generating..." : "Generate report"}</button>
      </section>

      {error && <p className="billing-error" role="alert">{error}</p>}
      {!report && !error && <section className="billing-empty card"><FileSearch size={30} /><h3>{productionOverview ? 'Choose a period' : productionTeam ? 'Choose a team and period' : productionEmployee ? 'Choose an employee and period' : 'Choose a team, members and period'}</h3><p>{productionOverview ? 'Generate a production report across all teams.' : productionTeam ? 'The report includes every member of the selected team.' : productionEmployee ? 'Select an employee to see their production hours and billing.' : 'Select All members for a combined team report, or choose one employee.'}</p></section>}

      {report && (
        <>
          <section className="billing-summary-grid">
            <article className="card"><UsersRound size={20} /><span>{groupReport ? report.scope.type === 'company' ? 'Scope' : 'Team' : 'Employee'}</span><strong>{reportName}</strong><small>{groupReport ? `${report.scope.memberCount} members` : report.employee.employeeId}</small></article>
            <article className="card"><CalendarRange size={20} /><span>Selected period</span><strong>{formatDate(report.period.startDate)} - {formatDate(report.period.endDate)}</strong><small>{report.summary.workingDays} working days</small></article>
            <article className="card"><Clock3 size={20} /><span>{productionOnly ? 'Production hours' : 'Task hours'}</span><strong>{formatDuration(report.summary.taskSeconds)}</strong><small>{report.summary.taskCount} tasks · {report.summary.projectCount} projects</small></article>
            {!productionOnly && <article className="card break-card"><Clock3 size={20} /><span>Break / Idle</span><strong>{formatDuration((report.summary.breakIdleSeconds ?? report.summary.breakSeconds))}</strong><small>Breaks and idle time combined</small></article>}
            {!productionOnly && <article className="card total-card"><ReceiptText size={20} /><span>Total recorded</span><strong>{formatDuration((report.summary.recordedSeconds ?? report.summary.totalSeconds))}</strong><small>{report.summary.projectCount} projects</small></article>}
            <article className="card billing-amount-card"><ReceiptText size={20} /><span>{report.summary.missingRateCount ? "Calculated subtotal" : "Billable amount"}</span><strong>{formatMoney(report.summary.totalBillableAmount)}</strong><small>{report.summary.missingRateCount ? `Excludes ${report.summary.missingRateCount} task(s) with missing rates` : "All rates configured"}</small></article>
          </section>

          {report.warnings?.length > 0 && (
            <section className="billing-rate-warning" role="alert">
              <strong>Billing configuration required.</strong>
              <span>{report.warnings.map((warning) => `${warning.employeeName ? `${warning.employeeName}: ` : ''}${warning.projectName} / ${warning.taskName}: ${warning.message}`).join(" ")}</span>
            </section>
          )}

          {groupReport && <section className="billing-report card" aria-label="Billing by member"><header><div><span>All selected members</span><h3>{productionOnly ? 'Production by member' : 'Member totals'}</h3></div></header><div className="billing-table-wrap"><table><thead><tr><th>Employee</th><th>{productionOnly ? 'Production hours' : 'Task hours'}</th>{!productionOnly && <th>Break / Idle</th>}<th>Billable amount</th></tr></thead><tbody>{report.members.map(member => <tr key={member._id}><td><strong>{member.fullName}</strong><small>{member.employeeId}</small></td><td>{formatDuration(member.taskSeconds)}</td>{!productionOnly && <td>{formatDuration((member.breakIdleSeconds ?? member.breakSeconds))}</td>}<td>{formatMoney(member.totalBillableAmount)}{member.missingRateCount > 0 && <small className="billing-missing-rate">Missing rates excluded</small>}</td></tr>)}</tbody></table></div></section>}
          <section className="billing-report card">
            <header><div><span>Primary report</span><h3>Project-wise task summary</h3></div><strong>{formatDuration(report.summary.taskSeconds)}</strong></header>
            {report.projects.length === 0 ? <div className="billing-no-data">No completed task time was recorded in this period.</div> : report.projects.map((project) => (
              <article className="billing-project" key={project.key || project.projectId}>
                <div className="billing-project-heading"><div><FolderKanban size={18} /><div><h4>{project.projectName}</h4><p>{project.clientName || project.projectCode || "No client assigned"}</p></div></div><div className="billing-project-totals"><strong>{formatDuration(project.totalSeconds)}</strong><span>{project.hasMissingRates ? "Known subtotal: " : ""}{formatMoney(project.totalBillableAmount)}{project.hasMissingRates ? " (missing rates excluded)" : ""}</span></div></div>
                <div className="billing-table-wrap"><table><thead><tr>{groupReport && <th>Employee</th>}{showServiceType && <th>Service type</th>}<th>Task</th><th>Description</th><th>Total time</th><th>Hourly rate</th><th>Billable amount</th></tr></thead><tbody>{project.tasks.map((task) => <tr key={task.key || task.taskId}>{groupReport && <td><strong>{task.employeeName}</strong><small>{task.employeeCode}</small></td>}{showServiceType && <td>{task.serviceType || "-"}</td>}<td><strong>{task.taskName}</strong>{task.taskCode && <small>{task.taskCode}</small>}</td><td>{task.taskDescription || "-"}</td><td>{formatClockDuration(task.totalSeconds)}</td><td className={task.billingWarning ? "billing-missing-rate" : ""}>{formatRate(task.chargeRate, task.billingWarning)}</td><td className={task.billingWarning ? "billing-missing-rate" : ""}>{formatMoney(task.billableAmount, task.billingWarning)}</td></tr>)}</tbody></table></div>
              </article>
            ))}
          </section>

          <section className="billing-daily card">
            <header><div><span>Audit detail</span><h3>Daily details</h3></div><p>{productionOnly ? 'Expand a date to review production task sessions.' : 'Expand a date to review individual timer sessions.'}</p></header>
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
                <div className="billing-table-wrap"><table><thead><tr>{groupReport && <th>Employee</th>}<th>Type</th><th>Project</th>{showServiceType && <th>Service</th>}<th>Task</th><th>Start</th><th>End</th><th>Time</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{day.entries.map((entry, index) => <tr key={`${entry.logId}-${index}`}>{groupReport && <td><strong>{entry.employeeName}</strong><small>{entry.employeeCode}</small></td>}<td><span className={`billing-type ${entry.type}`}>{entry.type === "break" ? "Break / Idle" : "Task"}</span></td><td>{entry.projectName}</td>{showServiceType && <td>{entry.serviceType || "-"}</td>}<td>{entry.taskName}</td><td>{new Date(entry.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: report.period.timezone })}</td><td>{new Date(entry.stoppedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: report.period.timezone })}</td><td>{formatDuration(entry.durationSeconds)}</td><td className={entry.billingWarning ? "billing-missing-rate" : ""}>{entry.type === "break" ? "-" : formatRate(entry.chargeRate, entry.billingWarning)}</td><td className={entry.billingWarning ? "billing-missing-rate" : ""}>{entry.type === "break" ? "-" : formatMoney(entry.billableAmount, entry.billingWarning)}</td></tr>)}</tbody></table></div>
              </details>
            ))}
          </section>
        </>
      )}
      {selectedEmployee?.isActive === false && <p className="billing-history-note">This employee is inactive; historical completed records remain available.</p>}
    </div>
  );
}

function BillingPage({ productionOnly = false, productionScope = 'overview' }) {
  const title = productionOnly ? productionScope === 'team' ? 'Team production' : productionScope === 'employee' ? 'Employee production' : 'Production overview' : 'Billing';
  return <DashboardLayout title={title}><BillingContent productionOnly={productionOnly} productionScope={productionScope} /></DashboardLayout>;
}

export default BillingPage;
