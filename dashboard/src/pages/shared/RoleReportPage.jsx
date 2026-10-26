import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSearch, Search } from "lucide-react";
import { useLocation } from "react-router-dom";

import useAuth from "../../context/useAuth";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import {
  getMyAttendance,
  getMyTimeLogs,
  getTeamAttendance,
  getTeamTimeLogs,
} from "../../api/reportApi";
import { getAllActiveProjects } from "../../api/projectApi";
import { getAllActiveTasksByProject } from "../../api/taskApi";
import ReportSummary from "../../components/dashboard/ReportSummary";
import PageHeader from "../../components/layout/PageHeader";
import useDataRefresh from "../../hooks/useDataRefresh";
import { buildChronologicalReportTimeline, sumTimelineSeconds } from "../../utils/timeLogTimeline";
import { formatReportDateTime, formatReportDuration, reportEntryStatus } from "../../utils/reportFormatting";
import { getWorkedSeconds, localDate as today } from "../../utils/timeLogReportHelpers";
import { readReportState, writeReportState } from "../../utils/reportPersistence";
import { buildClientTimesheet } from "../../utils/clientTimesheet";
import ClientTimesheet from "../../components/reports/ClientTimesheet";
import AddEntryModal from "../../components/reports/AddEntryModal";
import ManualEntriesModal from "../../components/reports/ManualEntriesModal";
import { canManageManualEntries } from "../../utils/manualEntry";

import "../../styles/adminReportPage.css";
import "../../styles/roleReportPage.css";

const duration = formatReportDuration;

function RoleReportPage({ title, description, mode = "time", scope = "team", showDesktopDownload = false, showClientView = false }) {
  const { user, hasPermission } = useAuth();
  const { pathname } = useLocation();
  const reportStorageKey = `crm-report:${user?._id || user?.email || "user"}:${pathname}`;
  const [savedReportState] = useState(() => readReportState(reportStorageKey));
  const restoredReportRef = useRef(false);
  const latestReportRequestRef = useRef(0);
  const pendingReportRequestsRef = useRef(0);
  const [fromDate, setFromDate] = useState(() => today());
  const [toDate, setToDate] = useState(() => today());
  const [project, setProject] = useState(() => savedReportState.project || "");
  const [task, setTask] = useState(() => savedReportState.task || "");
  const [appliedProject, setAppliedProject] = useState(() => savedReportState.project || "");
  const [appliedTask, setAppliedTask] = useState(() => savedReportState.task || "");
  // Snapshot of the filters that were active when "Generate" last succeeded.
  // The silent background poll must replay this snapshot, not whatever is
  // currently sitting in the (possibly half-edited) filter inputs.
  const appliedFiltersRef = useRef({
    fromDate: today(),
    toDate: today(),
    project: savedReportState.project || "",
    task: savedReportState.task || "",
  });
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(() => Boolean(savedReportState.hasRun));
  const [error, setError] = useState("");
  const [teamView, setTeamView] = useState(() => savedReportState.teamView === "client" ? "client" : "employee");
  const isTeamLead = user?.role === "team_lead";
  // The route decides: team pages show the person's team (a lead's assigned
  // employees, or an employee's own team when given "View team timesheets").
  const isTeamReport = scope !== "personal";
  // A team lead only sees Add Entry when an administrator granted
  // "add_manual_entries" to the role; the API enforces it regardless.
  const [entryEmployee, setEntryEmployee] = useState(null);
  const [manualEntryEmployee, setManualEntryEmployee] = useState(null);
  const [entryNotice, setEntryNotice] = useState("");
  const manualEntriesAvailable = showClientView && isTeamReport && mode === "time";
  const canAddEntry = manualEntriesAvailable && hasPermission("add_manual_entries");

  useEffect(() => {
    if (mode !== "time") return;
    const loadProjects = async () => {
      try {
        setProjects(await getAllActiveProjects());
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "Unable to load report projects."));
      }
    };
    void loadProjects();
  }, [mode]);

  useEffect(() => {
    let active = true;
    if (mode !== "time" || !project) {
      setTasks([]);
      setTasksLoading(false);
      return () => { active = false; };
    }

    const loadTasks = async () => {
      setTasksLoading(true);
      try {
        const nextTasks = await getAllActiveTasksByProject(project);
        if (!active) return;
        setTasks(nextTasks);
        setTask((currentTask) => currentTask && !nextTasks.some((item) => item._id === currentTask)
          ? ""
          : currentTask);
      } catch (requestError) {
        if (!active) return;
        setTasks([]);
        setTask("");
        setError(getApiErrorMessage(requestError, "Unable to load tasks for this project."));
      } finally {
        if (active) setTasksLoading(false);
      }
    };

    void loadTasks();
    return () => { active = false; };
  }, [mode, project]);

  const totalSeconds = useMemo(() => records.reduce((sum, record) => sum + getWorkedSeconds(record), 0), [records]);
  const totalBreakSeconds = useMemo(
    () => sumTimelineSeconds(records, "break"),
    [records],
  );
  const timelineRows = useMemo(
    () => buildChronologicalReportTimeline(records, {
      taskFiltered: Boolean(appliedTask),
      // A server-side project filter hides intervening projects, so gaps
      // between its remaining sessions cannot safely be called idle.
      includeGaps: !appliedProject && !appliedTask,
    }),
    [appliedProject, appliedTask, records],
  );
  const clientDetails = useMemo(
    () => showClientView && isTeamReport ? buildClientTimesheet(records, timelineRows) : [],
    [records, timelineRows, showClientView, isTeamReport],
  );
  const entryEmployees = useMemo(() => {
    const employees = new Map();
    for (const record of records) {
      const employee = record.employee;
      if (canManageManualEntries(user, employee, { teamReport: isTeamReport })) employees.set(String(employee._id), employee);
    }
    return [...employees.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [records, user, isTeamReport]);
  const manualEntryCount = (id) => records.filter((record) => record.entrySource === "manual" && !record.manualEntry?.deletedAt
    && String(record.employee?._id || record.employee || "") === String(id)).length;

  const loadReport = useCallback(async ({ silent = false, force = false } = {}) => {
    if (silent && !force && pendingReportRequestsRef.current > 0) return;
    const requestId = ++latestReportRequestRef.current;
    const isCurrent = () => latestReportRequestRef.current === requestId;

    // Silent (background) refreshes must replay the filters captured the
    // last time "Generate" succeeded, never the live (possibly half-edited)
    // filter inputs, so in-progress edits never silently change the table.
    const activeFilters = silent
      ? appliedFiltersRef.current
      : { fromDate, toDate, project, task };

    if (!silent) setHasRun(true);

    if (!activeFilters.fromDate || !activeFilters.toDate || activeFilters.toDate < activeFilters.fromDate) {
      if (!silent) {
        setRecords([]);
        setError("Select a valid From and To date.");
      }
      return;
    }

    pendingReportRequestsRef.current += 1;
    try {
      if (!silent) {
        setLoading(true);
        setError("");
      }
      const params = {
        startDate: activeFilters.fromDate,
        endDate: activeFilters.toDate,
        project: activeFilters.project || undefined,
        task: activeFilters.task || undefined,
      };
      const data = mode === "attendance"
        ? isTeamReport ? await getTeamAttendance(params, { force: force || !silent }) : await getMyAttendance(params, { force: force || !silent })
        : isTeamReport ? await getTeamTimeLogs(params, { force: force || !silent }) : await getMyTimeLogs(params, { force: force || !silent });

      if (!isCurrent()) return;
      setRecords(mode === "attendance" ? data.attendance || [] : data.timeLogs || []);
      if (!silent) {
        appliedFiltersRef.current = activeFilters;
        setAppliedProject(activeFilters.project || "");
        setAppliedTask(activeFilters.task || "");
      }
    } catch (requestError) {
      if (!isCurrent()) return;
      if (!silent) {
        setRecords([]);
        setError(getApiErrorMessage(requestError, "Unable to generate this report."));
      }
    } finally {
      pendingReportRequestsRef.current -= 1;
      if (isCurrent() && (!silent || force)) setLoading(false);
    }
  }, [fromDate, isTeamReport, mode, project, task, toDate]);

  const runReport = () => loadReport();
  const handleEntrySaved = (timeLog) => {
    setEntryNotice(`Entry added for ${timeLog?.employee?.fullName || "the employee"}.`);
    if (hasRun) void loadReport({ silent: true, force: true });
  };
  const handleEntryDeleted = () => {
    setEntryNotice("Manual entry deleted.");
    if (hasRun) void loadReport({ silent: true, force: true });
  };
  useEffect(() => {
    // Dates are not persisted, so reopening the page starts on today's date.
    writeReportState(reportStorageKey, { project, task, hasRun, teamView });
  }, [hasRun, project, reportStorageKey, task, teamView]);

  useEffect(() => {
    if (restoredReportRef.current) return;
    restoredReportRef.current = true;
    if (savedReportState.hasRun) void loadReport();
  }, [loadReport, savedReportState.hasRun]);

  useDataRefresh(() => {
    if (hasRun) return loadReport({ silent: true });
    return undefined;
  }, 30_000);

  const report = (
    <div className="admin-report-page role-report-page">
      <ReportSummary items={[
        { label: "Recorded time", value: hasRun ? duration(totalSeconds) : "—" },
        { label: "Break time", value: hasRun ? duration(totalBreakSeconds) : "—", help: "Intentional timer breaks" },
        { label: "Timer records", value: hasRun ? records.length : "—" },
        { label: "Workspace", value: isTeamReport ? "Your team" : "Personal", help: user?.fullName || "Your employee account" },
      ]} />
      <section className="admin-report-filter card">
        <div><span className="admin-report-kicker">{isTeamReport ? "Team report" : "My report"}</span><h2>{title}</h2><p>{description}</p></div>
        <div className="admin-report-controls">
          {mode === "time" && <select value={project} onChange={(event) => { setProject(event.target.value); setTask(""); setError(""); }} aria-label="Project"><option value="">All projects</option>{projects.map((item) => <option value={item._id} key={item._id}>{item.projectName}</option>)}</select>}
          {mode === "time" && <select value={task} onChange={(event) => setTask(event.target.value)} aria-label="Task" disabled={!project || tasksLoading}><option value="">{!project ? "Select project first" : tasksLoading ? "Loading tasks..." : "All tasks"}</option>{tasks.map((item) => <option value={item._id} key={item._id}>{item.taskName}</option>)}</select>}
          <label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label>To<input type="date" min={fromDate} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          <button type="button" onClick={runReport} disabled={loading}><Search size={16} />{loading ? "Loading…" : "Generate"}</button>
        </div>
      </section>
      <section className="admin-report-results card">
        <header><div><span className="admin-report-kicker">Results</span><h2>{mode === "time" ? `${timelineRows.length} timeline entries` : `${records.length} records`}</h2></div></header>
        {showClientView && isTeamReport && mode === "time" && <div className="client-timesheet-view-buttons" role="group" aria-label="Team timesheet view">
          <button type="button" aria-pressed={teamView === "employee"} onClick={() => setTeamView("employee")}>Employee</button>
          <button type="button" aria-pressed={teamView === "client"} onClick={() => setTeamView("client")}>Client</button>
        </div>}
        {error && <p className="admin-report-message error-message" role="alert">{error}</p>}
        {entryNotice && <p className="report-entry-notice" role="status">{entryNotice}</p>}
        {!error && !hasRun && <div className="admin-report-empty"><FileSearch size={26} /><strong>Your work, in one view</strong><span>Select a period and generate your timesheet to view recorded work.</span></div>}
        {!error && hasRun && records.length === 0 && <div className="admin-report-empty"><FileSearch size={26} /><strong>No records found</strong><span>No matching activity exists for the selected dates.</span></div>}
        {!error && mode === "time" && records.length > 0 && showClientView && isTeamReport && teamView === "client" && <ClientTimesheet employees={clientDetails} />}
        {!error && manualEntriesAvailable && canAddEntry && teamView === "employee" && entryEmployees.map((employee) => <div className="report-entry-employee-actions" key={employee._id}>
          <strong>{employee.fullName}</strong><div className="report-manual-actions">
            <button type="button" className="report-add-entry-button" onClick={() => setEntryEmployee({ id: employee._id, name: employee.fullName })}>Add Entry</button>
            {manualEntryCount(employee._id) > 0 && <button type="button" className="secondary-button" onClick={() => setManualEntryEmployee({ id: employee._id, name: employee.fullName })}>Manual entries ({manualEntryCount(employee._id)})</button>}
          </div>
        </div>)}
        {!error && mode === "time" && records.length > 0 && !(showClientView && isTeamReport && teamView === "client") && (
          <div className="admin-report-table-wrap">
            <table>
              <thead><tr>{isTeamReport && <th>Employee</th>}<th>Type</th><th>Project</th><th>Task / segment</th><th>Started</th><th>Finished</th><th>Duration</th><th>Idle</th><th>Status</th><th>Note</th></tr></thead>
              <tbody>{timelineRows.map(({ record, entry, key }) => (
                <tr className={`report-timeline-row report-${entry.type}-row`} key={key}>
                  {isTeamReport && <td>{record.employee?.fullName || "—"}</td>}
                  <td><span className={`report-entry-badge ${entry.type}`}>{entry.type}</span></td>
                  <td>{record.project?.projectName || "—"}</td>
                  <td>{entry.source === "between_sessions" ? "Between tasks" : entry.type === "work" ? `${record.task?.taskName || "Task"} · Work ${entry.sequence}` : `${entry.type === "break" ? record.task?.taskName || "Break" : "Idle"} ${entry.sequence}`}</td>
                  <td><strong>{formatReportDateTime(entry.start)}</strong></td>
                  <td><strong>{entry.end ? formatReportDateTime(entry.end) : "In progress"}</strong></td>
                  <td>{duration(entry.durationSeconds)}</td>
                  <td>{entry.type === "idle" ? duration(entry.durationSeconds) : "—"}</td>
                  <td>{reportEntryStatus(record, entry)}</td>
                  <td className="report-entry-note">{entry.type === "work" ? record.note || "—" : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {!error && mode === "attendance" && records.length > 0 && <div className="admin-report-table-wrap"><table><thead><tr>{isTeamReport && <th>Employee</th>}<th>Date</th><th>Check in</th><th>Check out</th><th>Hours</th><th>Status</th></tr></thead><tbody>{records.map((record) => <tr key={record._id}>{isTeamReport && <td>{record.employee?.fullName || "—"}</td>}<td>{record.date}</td><td>{record.checkIn ? new Date(record.checkIn).toLocaleTimeString() : "—"}</td><td>{record.checkOut ? new Date(record.checkOut).toLocaleTimeString() : "—"}</td><td>{record.totalHours || 0}</td><td>{record.status}</td></tr>)}</tbody></table></div>}
      </section>
      {entryEmployee && <AddEntryModal employee={entryEmployee} onClose={() => setEntryEmployee(null)} onSaved={handleEntrySaved} />}
      {manualEntryEmployee && <ManualEntriesModal employee={manualEntryEmployee} records={records} onClose={() => setManualEntryEmployee(null)} onDeleted={handleEntryDeleted} />}
    </div>
  );

  return isTeamLead
    ? <div className="tl-page"><div className="tl-main"><main className="tl-content"><PageHeader title={showDesktopDownload ? `Welcome back${user?.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}` : title} description={showDesktopDownload ? "Your work summary, timesheets and desktop workspace." : description} />{report}</main></div></div>
    : <div className="employee-page"><div className="employee-main"><main className="employee-content"><PageHeader title={showDesktopDownload ? `Welcome back${user?.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}` : title} description={showDesktopDownload ? "Your work summary, timesheets and desktop workspace." : description} />{report}</main></div></div>;
}

export default RoleReportPage;
