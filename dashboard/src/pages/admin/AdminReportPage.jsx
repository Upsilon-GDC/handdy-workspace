import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Clock3, FileDown, FileSearch, Plus, Search, Sheet } from "lucide-react";
import { useLocation } from "react-router-dom";

import DashboardLayout from "../../components/layout/DashboardLayout";
import { getAllEmployeeOptions } from "../../api/employeeApi";
import { getAllActiveProjects } from "../../api/projectApi";
import { getAllTeams } from "../../api/teamApi";
import { getAllActiveTasksByProject } from "../../api/taskApi";
import {
  getAdminAttendance,
  getAdminTimeLogs,
  getMyAttendance,
  getMyTimeLogs,
} from "../../api/reportApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import { exportReportExcel, exportReportPdf } from "../../utils/reportExport";
import useDataRefresh from "../../hooks/useDataRefresh";
import { buildChronologicalReportTimeline, sumTimelineSeconds } from "../../utils/timeLogTimeline";
import { formatReportDateTime, formatReportDuration, reportEntryStatus } from "../../utils/reportFormatting";
import { getIdleSeconds, getWorkedSeconds, localDate, projectServesTeam } from "../../utils/timeLogReportHelpers";
import { buildProjectWorkDetails } from "../../utils/projectWorkDetails";
import { countWorkedDays } from "../../utils/personalReports";
import { buildClientTimesheet, flattenClientTimesheet } from "../../utils/clientTimesheet";
import ClientTimesheet from "../../components/reports/ClientTimesheet";
import AddEntryModal from "../../components/reports/AddEntryModal";
import ManualEntriesModal from "../../components/reports/ManualEntriesModal";
import { canManageManualEntries } from "../../utils/manualEntry";
import { readReportState, writeReportState } from "../../utils/reportPersistence";
import useAuth from "../../context/useAuth";

import "../../styles/adminReportPage.css";
import ReportSummary from "../../components/dashboard/ReportSummary";

const formatDuration = formatReportDuration;

const buildGroupedRows = (records, groupBy, gapRows = []) => {
  const groups = new Map();

  records.forEach((record) => {
    const entity = groupBy === "employee" ? record.employee : record.project;
    const key = entity?._id || `unassigned-${groupBy}`;
    const label = groupBy === "employee"
      ? entity?.fullName || "Unassigned employee"
      : entity?.projectName || "Unassigned project";

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        employee: groupBy === "employee" ? entity : undefined,
        sessions: 0,
        employees: new Set(),
        projects: new Set(),
        tasks: new Set(),
        workedSeconds: 0,
        idleSeconds: 0,
      });
    }

    const group = groups.get(key);
    group.sessions += 1;
    group.employees.add(record.employee?._id || "unassigned");
    group.projects.add(record.project?._id || "unassigned");
    group.tasks.add(record.task?._id || "unassigned");
    group.workedSeconds += getWorkedSeconds(record);
    group.idleSeconds += getIdleSeconds(record);
  });

  gapRows.filter(({ entry }) => entry.source === "between_sessions").forEach(({ record, entry }) => {
    const entity = groupBy === "employee" ? record.employee : record.project;
    const key = entity?._id || `unassigned-${groupBy}`;
    if (groups.has(key)) groups.get(key).idleSeconds += entry.durationSeconds;
  });

  return [...groups.values()].sort(
    (first, second) => second.workedSeconds - first.workedSeconds
  );
};

function AdminReportContent({
  title,
  description,
  mode = "time",
  scope = "company",
  variant = "detailed",
  trackingLabel = "tracking activity",
  allowEmployeeFilter = scope === "company",
}) {
  const { pathname } = useLocation();
  const { user, hasPermission } = useAuth();
  const canExport = hasPermission("export_reports");
  const reportStorageKey = `crm-report:${user?._id || user?.email || "user"}:${pathname}`;
  // The team timesheet filters by team instead of by employee.
  const hasTeamFilter = variant === "project" || variant === "team";
  const showEmployeeFilter = allowEmployeeFilter && variant !== "team";
  const [savedReportState] = useState(() => {
    const saved = readReportState(reportStorageKey);
    // Older navigations could copy the Project Hours team into this route's
    // storage. Reports without a team control discard that filter, and a
    // report without an employee control must not apply a hidden saved one.
    if (!hasTeamFilter && saved.team) return { ...saved, team: "", employee: "" };
    if (!showEmployeeFilter && saved.employee) return { ...saved, employee: "" };
    return saved;
  });
  const restoredReportRef = useRef(false);
  const latestReportRequestRef = useRef(0);
  const pendingReportRequestsRef = useRef(0);
  const [fromDate, setFromDate] = useState(() => localDate());
  const [toDate, setToDate] = useState(() => localDate());
  const [employee, setEmployee] = useState(() => savedReportState.employee || "");
  const [team, setTeam] = useState(() => savedReportState.team || "");
  const [project, setProject] = useState(() => savedReportState.project || "");
  const [appliedProject, setAppliedProject] = useState(() => savedReportState.project || "");
  const [task, setTask] = useState(() => savedReportState.task || "");
  const [appliedTask, setAppliedTask] = useState(() => savedReportState.task || "");
  const [appliedHeading, setAppliedHeading] = useState(() => ({
    team: savedReportState.team || "",
    employee: savedReportState.employee || "",
    fromDate: localDate(),
    toDate: localDate(),
  }));
  // Snapshot of the filters that were active when "Generate" last succeeded.
  // The silent background poll must replay this snapshot, not whatever is
  // currently sitting in the (possibly half-edited) filter inputs.
  const appliedFiltersRef = useRef({
    fromDate: localDate(),
    toDate: localDate(),
    employee: savedReportState.employee || "",
    team: savedReportState.team || "",
    project: savedReportState.project || "",
    task: savedReportState.task || "",
  });

  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [allTimeRecords, setAllTimeRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(() => Boolean(savedReportState.hasRun));
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const [teamView, setTeamView] = useState(() => savedReportState.teamView === "client" ? "client" : "employee");
  // Manual entries: the button is only offered to users holding the
  // permission. The API enforces it independently of this flag.
  const [entryEmployee, setEntryEmployee] = useState(null);
  const [manualEntryEmployee, setManualEntryEmployee] = useState(null);
  const [entryNotice, setEntryNotice] = useState("");
  // Managers and HR may also correct their own time from "My timesheet".
  const canAddOwnEntry = ["manager", "hr"].includes(user?.role);
  const manualEntriesAvailable = mode === "time" && (variant === "team" && scope === "company"
    || scope === "personal" && canAddOwnEntry);
  const canAddEntry = manualEntriesAvailable && hasPermission("add_manual_entries");
  const canAddFor = (target) => canAddEntry && canManageManualEntries(user, target);
  const manualEntryCount = (id) => records.filter((record) => record.entrySource === "manual" && !record.manualEntry?.deletedAt
    && String(record.employee?._id || record.employee || user?._id || "") === String(id)).length;

  useEffect(() => {
    if (mode === "tracking") return;

    const loadOptions = async () => {
      try {
        const [employeeData, projectData, teamData] = await Promise.all([
          showEmployeeFilter
            ? getAllEmployeeOptions()
            : Promise.resolve([]),
          mode === "time"
            ? getAllActiveProjects()
            : Promise.resolve([]),
          hasTeamFilter && mode === "time" ? getAllTeams() : Promise.resolve([]),
        ]);
        setEmployees(employeeData);
        setProjects(projectData);
        setTeams(teamData);
      } catch (requestError) {
        setError(
          getApiErrorMessage(requestError, "Unable to load report filters.")
        );
      }
    };

    void loadOptions();
  }, [hasTeamFilter, mode, showEmployeeFilter]);

  const availableEmployees = useMemo(() => team
    ? employees.filter((item) => String(item.team?._id || item.team || "") === team)
    : employees, [employees, team]);
  const availableProjects = useMemo(() => variant === "team"
    ? projects.filter((item) => projectServesTeam(item, team))
    : projects, [projects, team, variant]);

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

  const totalSeconds = useMemo(
    () => records.reduce((sum, record) => sum + getWorkedSeconds(record), 0),
    [records]
  );
  const timelineRows = useMemo(
    () => buildChronologicalReportTimeline(allTimeRecords, { includeGaps: true })
      .filter(({ record, entry }) =>
        (!appliedProject || String(record.project?._id || record.project || "") === appliedProject)
        && (!appliedTask || String(record.task?._id || record.task || "") === appliedTask)
        && (!appliedTask || (entry.source !== "between_sessions"
          && entry.type === (record.task?.taskType === "break" ? "break" : "work")))),
    [allTimeRecords, appliedProject, appliedTask],
  );
  const totalIdleSeconds = useMemo(
    () => appliedTask ? 0 : records.reduce((sum, record) => sum + getIdleSeconds(record), 0)
      + timelineRows.filter(({ entry }) => entry.source === "between_sessions")
        .reduce((sum, { entry }) => sum + entry.durationSeconds, 0),
    [appliedTask, records, timelineRows]
  );
  const totalBreakSeconds = useMemo(
    () => sumTimelineSeconds(records, "break"),
    [records],
  );
  const teamRows = useMemo(
    () => buildGroupedRows(records, "employee", timelineRows),
    [records, timelineRows]
  );
  const projectDetails = useMemo(
    () => buildProjectWorkDetails(records, timelineRows),
    [records, timelineRows]
  );
  const clientDetails = useMemo(
    () => variant === "team" ? buildClientTimesheet(records, timelineRows) : [],
    [records, timelineRows, variant],
  );
  // "My timesheet": only the totals for the period (worked, break, idle).
  const summaryRows = useMemo(() => variant === "summary" ? [
    { label: "Work time", value: formatDuration(totalSeconds) },
    { label: "Break time", value: formatDuration(totalBreakSeconds) },
    { label: "Idle time", value: formatDuration(totalIdleSeconds) },
    { label: "Days worked", value: String(countWorkedDays(records)) },
    { label: "Timer sessions", value: String(records.length) },
  ] : [], [variant, records, totalSeconds, totalBreakSeconds, totalIdleSeconds]);
  // The client view reports worked and idle time per task only.
  const showBreakTotals = !(variant === "team" && teamView === "client");

  const resultCount = variant === "team"
    ? teamRows.length
    : variant === "project"
      ? projectDetails.length
      : variant === "detailed" && mode === "time" ? timelineRows.length : records.length;
  const resultLabel = variant === "summary"
    ? "timer sessions"
    : variant === "team"
    ? "employees"
    : variant === "project"
      ? "employees"
      : variant === "detailed" && mode === "time" ? "timeline entries" : "records";

  const loadReport = useCallback(async ({ silent = false, force = false } = {}) => {
    if (silent && !force && pendingReportRequestsRef.current > 0) return;
    const requestId = ++latestReportRequestRef.current;
    const isCurrent = () => latestReportRequestRef.current === requestId;

    // Silent (background) refreshes must replay the filters captured the
    // last time "Generate" succeeded, never the live (possibly half-edited)
    // filter inputs, so in-progress edits never silently change the table.
    const activeFilters = silent
      ? appliedFiltersRef.current
      : { fromDate, toDate, employee, team, project, task };

    if (!silent) {
      setHasRun(true);
      setError("");
    }

    if (!activeFilters.fromDate || !activeFilters.toDate || activeFilters.toDate < activeFilters.fromDate) {
      if (!silent) {
        setRecords([]);
        setAllTimeRecords([]);
        setError("Select a valid From and To date.");
      }
      return;
    }

    if (mode === "tracking") {
      if (!silent) setRecords([]);
      return;
    }

    pendingReportRequestsRef.current += 1;
    try {
      if (!silent) setLoading(true);
      const params = {
        startDate: activeFilters.fromDate,
        endDate: activeFilters.toDate,
        employee: activeFilters.employee || undefined,
        team: activeFilters.team || undefined,
        // Fetch every task in the selected scope first. Filtering locally
        // preserves true between-session gaps when switching projects.
        project: mode === "attendance" ? activeFilters.project || undefined : undefined,
        task: mode === "attendance" ? activeFilters.task || undefined : undefined,
      };
      const data = mode === "attendance"
        ? scope === "personal"
          ? await getMyAttendance(params, { force: force || !silent })
          : await getAdminAttendance(params, { force: force || !silent })
        : scope === "personal"
          ? await getMyTimeLogs(params, { force: force || !silent })
          : await getAdminTimeLogs(params, { force: force || !silent });

      if (!isCurrent()) return;
      const fetched = mode === "attendance" ? data.attendance || [] : data.timeLogs || [];
      if (mode === "time") {
        setAllTimeRecords(fetched);
        setRecords(fetched.filter((record) =>
          (!activeFilters.project || String(record.project?._id || record.project || "") === activeFilters.project)
          && (!activeFilters.task || String(record.task?._id || record.task || "") === activeFilters.task)));
      } else {
        setRecords(fetched);
      }
      if (!silent) {
        appliedFiltersRef.current = activeFilters;
        setAppliedHeading({
          team: activeFilters.team || "",
          employee: activeFilters.employee || "",
          fromDate: activeFilters.fromDate,
          toDate: activeFilters.toDate,
        });
        setAppliedProject(activeFilters.project || "");
        setAppliedTask(activeFilters.task || "");
      }
    } catch (requestError) {
      if (!isCurrent()) return;
      if (!silent) {
        setRecords([]);
        setAllTimeRecords([]);
        setError(
          getApiErrorMessage(requestError, "Unable to generate this report.")
        );
      }
    } finally {
      pendingReportRequestsRef.current -= 1;
      if (isCurrent() && (!silent || force)) setLoading(false);
    }
  }, [employee, fromDate, mode, project, scope, task, team, toDate]);

  const runReport = () => loadReport();
  // Replay the applied filters even while a draft selection is being edited.
  const handleEntrySaved = (timeLog) => {
    setEntryNotice(`Entry added for ${timeLog?.employee?.fullName || "the employee"}.`);
    if (hasRun) void loadReport({ silent: true, force: true });
  };
  const handleEntryDeleted = () => {
    setEntryNotice("Manual entry deleted.");
    if (hasRun) void loadReport({ silent: true, force: true });
  };
  useEffect(() => {
    // Dates are deliberately not persisted: reopening the page always starts
    // on today's date instead of whatever day was last selected.
    writeReportState(reportStorageKey, {
      employee,
      team,
      project,
      task,
      hasRun,
      teamView,
    });
  }, [employee, hasRun, project, reportStorageKey, task, team, teamView]);

  useEffect(() => {
    if (restoredReportRef.current) return;
    restoredReportRef.current = true;
    if (savedReportState.hasRun) void loadReport();
  }, [loadReport, savedReportState.hasRun]);

  useDataRefresh(() => {
    if (hasRun) return loadReport({ silent: true });
    return undefined;
  }, 30_000);

  const getExportData = () => {
    if (mode === "attendance") {
      const columns = [
        ...(scope === "company" ? ["Employee"] : []),
        "Date", "Check in", "Check out", "Total hours", "Status",
      ];
      const rows = records.map((record) => [
        ...(scope === "company" ? [record.employee?.fullName || "-"] : []),
        record.date || "-",
        record.checkIn ? new Date(record.checkIn).toLocaleString() : "-",
        record.checkOut ? new Date(record.checkOut).toLocaleString() : "-",
        Number(record.totalHours) || 0,
        record.status || "-",
      ]);
      return { columns, rows };
    }

    if (variant === "summary") {
      return { columns: ["Total", "Time"], rows: summaryRows.map((row) => [row.label, row.value]) };
    }

    if (variant === "team") {
      if (teamView === "client") return {
        columns: ["Employee", "Client", "Project", "Task", "Sessions", "Worked", "Idle"],
        rows: flattenClientTimesheet(clientDetails).map((row) => [
          row.employee, row.client, row.project, row.task, row.sessions,
          formatDuration(row.workedSeconds), formatDuration(row.idleSeconds),
        ]),
      };
      return {
        columns: ["Employee", "Sessions", "Projects", "Tasks", "Worked", "Idle"],
        rows: teamRows.map((row) => [
          row.label, row.sessions, row.projects.size, row.tasks.size,
          formatDuration(row.workedSeconds), formatDuration(row.idleSeconds),
        ]),
      };
    }

    if (variant === "project") {
      return {
        columns: ["Employee", "Project", "Sessions", "Worked", "Break", "Idle"],
        rows: projectDetails.flatMap((employeeRow) => [
          ...employeeRow.projects.map((row) => [
            employeeRow.name, row.name, row.sessions,
            formatDuration(row.workedSeconds), formatDuration(row.breakSeconds), formatDuration(row.idleSeconds),
          ]),
          [employeeRow.name, "Employee total", "", formatDuration(employeeRow.workedSeconds),
            formatDuration(employeeRow.breakSeconds), formatDuration(employeeRow.idleSeconds)],
        ]),
      };
    }

    return {
      columns: [
        ...(scope === "company" ? ["Employee"] : []),
        "Entry type", "Project", "Task", "Started", "Finished", "Duration", "Idle", "Status", "Note",
      ],
      rows: timelineRows.map(({ record, entry }) => {
        const employeeCell = scope === "company" ? [record.employee?.fullName || "-"] : [];
        return [
          ...employeeCell,
          entry.type === "break" ? "Break" : entry.type === "idle" ? "Idle" : "Work",
          record.project?.projectName || "-",
          entry.source === "between_sessions" ? "Between tasks" : entry.type === "work" ? `${record.task?.taskName || "Task"} - Work ${entry.sequence}` : `${entry.type === "break" ? record.task?.taskName || "Break" : "Idle"} ${entry.sequence}`,
          formatReportDateTime(entry.start),
          entry.end ? formatReportDateTime(entry.end) : "In progress",
          formatReportDuration(entry.durationSeconds),
          entry.type === "idle" ? formatReportDuration(entry.durationSeconds) : "-",
          reportEntryStatus(record, entry),
          entry.type === "work" ? record.note || "-" : "-",
        ];
      }),
    };
  };

  const exportCurrentReport = async (format) => {
    if (!hasRun || records.length === 0 || exporting) return;
    setExporting(format);
    setExportError("");
    try {
      const { columns, rows } = getExportData();
      const exportOptions = {
        title,
        fromDate: appliedHeading.fromDate,
        toDate: appliedHeading.toDate,
        columns,
        rows,
        summary: [
          { label: variant === "detailed" && mode === "time" ? "Timeline entries" : variant === "project" ? "Employees" : "Records", value: resultCount },
          ...(mode === "time" ? [
            { label: "Worked", value: formatDuration(totalSeconds) },
            ...(showBreakTotals ? [{ label: "Break", value: formatDuration(totalBreakSeconds) }] : []),
            { label: "Idle", value: formatDuration(totalIdleSeconds) },
          ] : []),
        ],
      };
      if (format === "excel") await exportReportExcel(exportOptions);
      else await exportReportPdf(exportOptions);
    } catch (exportRequestError) {
      console.error("Report export failed:", exportRequestError);
      setExportError(`Unable to export ${format === "excel" ? "Excel" : "PDF"}. Please try again.`);
    } finally {
      setExporting("");
    }
  };

  return (
    <DashboardLayout title={title}>
      <div className="admin-report-page">
        {variant !== "summary" && <ReportSummary items={mode === "time" ? [
          { label: variant === "detailed" ? "Timeline entries" : "Records", value: hasRun ? resultCount : "—", help: variant === "detailed" ? `${records.length} timer sessions` : undefined },
          { label: "Worked time", value: hasRun ? formatDuration(totalSeconds) : "—" },
          { label: "Break time", value: hasRun ? formatDuration(totalBreakSeconds) : "—", help: "Intentional timer breaks" },
          { label: "Idle time", value: hasRun ? formatDuration(totalIdleSeconds) : "—" },
        ] : [
          { label: "Records", value: hasRun ? records.length : "—" },
          { label: "Report scope", value: scope === "personal" ? "Personal" : "Company", help: "Access follows your role" },
        ]} />}
        <section className="admin-report-filter card">
          <div>
            <span className="admin-report-kicker">Report filters</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>

          <div className="admin-report-controls">
            {hasTeamFilter && mode === "time" && (
              <select
                value={team}
                onChange={(event) => {
                  const nextTeam = event.target.value;
                  setTeam(nextTeam);
                  setEmployee("");
                  // Clear a project (and its task) the new team does not use.
                  const selectedProject = projects.find((item) => item._id === project);
                  if (variant === "team" && selectedProject && !projectServesTeam(selectedProject, nextTeam)) {
                    setProject("");
                    setTask("");
                  }
                  setError("");
                }}
                aria-label="Team"
              >
                <option value="">All teams</option>
                {teams.map((item) => (
                  <option value={item._id} key={item._id}>{item.teamName}</option>
                ))}
              </select>
            )}
            {showEmployeeFilter && mode !== "tracking" && (
              <select
                value={employee}
                onChange={(event) => setEmployee(event.target.value)}
                aria-label="Employee"
              >
                <option value="">All employees</option>
                {availableEmployees.map((item) => (
                  <option value={item._id} key={item._id}>{item.fullName}</option>
                ))}
              </select>
            )}
            {mode === "time" && (
              <select
                value={project}
                onChange={(event) => {
                  setProject(event.target.value);
                  setTask("");
                  setError("");
                }}
                aria-label="Project"
              >
                <option value="">All projects</option>
                {availableProjects.map((item) => (
                  <option value={item._id} key={item._id}>{item.projectName}</option>
                ))}
              </select>
            )}
            {mode === "time" && (
              <select
                value={task}
                onChange={(event) => setTask(event.target.value)}
                aria-label="Task"
                disabled={!project || tasksLoading}
              >
                <option value="">
                  {!project ? "Select project first" : tasksLoading ? "Loading tasks..." : "All tasks"}
                </option>
                {tasks.map((item) => (
                  <option value={item._id} key={item._id}>{item.taskName}</option>
                ))}
              </select>
            )}
            <label>
              From
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <button type="button" onClick={runReport} disabled={loading}>
              <Search size={16} />{loading ? "Loading…" : "Generate"}
            </button>
          </div>
        </section>

        <section className="admin-report-results card">
          <header>
            <div>
              <span className="admin-report-kicker">Results</span>
              <h2>{resultCount} {resultLabel}</h2>
            </div>
            <div className="admin-report-header-actions">
              {mode === "time" && variant !== "detailed" && (
                <div className="admin-report-totals">
                  <strong><Clock3 size={16} />Worked {formatDuration(totalSeconds)}</strong>
                  {showBreakTotals && <strong className="admin-report-break-total"><Clock3 size={16} />Break {formatDuration(totalBreakSeconds)}</strong>}
                  <strong className="admin-report-idle-total"><Activity size={16} />Idle {formatDuration(totalIdleSeconds)}</strong>
                </div>
              )}
              <div className="admin-report-export-actions" aria-label="Export report">
                {manualEntriesAvailable && canAddOwnEntry && canAddFor(user) && <>
                  <button type="button" className="report-add-entry-button" onClick={() => setEntryEmployee({ id: user._id, name: user.fullName })}><Plus size={14} />Add my entry</button>
                  {scope === "personal" && manualEntryCount(user._id) > 0 && <button type="button" className="secondary-button" onClick={() => setManualEntryEmployee({ id: user._id, name: user.fullName })}>Manual entries ({manualEntryCount(user._id)})</button>}
                </>}
                {canExport && <><button
                  type="button"
                  className="report-export-button excel"
                  onClick={() => exportCurrentReport("excel")}
                  disabled={!hasRun || records.length === 0 || Boolean(exporting)}
                >
                  <Sheet size={16} />
                  {exporting === "excel" ? "Exporting..." : "Export Excel"}
                </button>
                <button
                  type="button"
                  className="report-export-button pdf"
                  onClick={() => exportCurrentReport("pdf")}
                  disabled={!hasRun || records.length === 0 || Boolean(exporting)}
                >
                  <FileDown size={16} />
                  {exporting === "pdf" ? "Exporting..." : "Export PDF"}
                </button></>}
              </div>
            </div>
          </header>

          {exportError && <p className="admin-report-message error-message" role="alert">{exportError}</p>}
          {entryNotice && <p className="report-entry-notice" role="status">{entryNotice}</p>}
          {variant === "team" && mode === "time" && <div className="client-timesheet-view-buttons" role="group" aria-label="Team timesheet view">
            <button type="button" aria-pressed={teamView === "employee"} onClick={() => setTeamView("employee")}>Employee</button>
            <button type="button" aria-pressed={teamView === "client"} onClick={() => setTeamView("client")}>Client</button>
          </div>}
          {error && (
            <p className="admin-report-message error-message" role="alert">{error}</p>
          )}
          {!error && !hasRun && mode !== "tracking" && <div className="admin-report-empty"><FileSearch size={26} /><strong>Your report starts here</strong><span>Choose your filters, then generate a report to see recorded activity.</span></div>}
          {!error && mode === "tracking" && hasRun && (
            <div className="admin-report-empty">
              <Activity size={26} />
              <strong>No {trackingLabel} received</strong>
              <span>The current desktop timer does not collect this data yet.</span>
            </div>
          )}
          {!error && mode === "tracking" && !hasRun && (
            <div className="admin-report-empty">
              <FileSearch size={26} />
              <strong>Generate a report</strong>
              <span>Choose a date range to check for {trackingLabel}.</span>
            </div>
          )}
          {!error && mode !== "tracking" && hasRun && records.length === 0 && (
            <div className="admin-report-empty">
              <FileSearch size={26} />
              <strong>No records found</strong>
              <span>No matching data exists for the selected filters.</span>
            </div>
          )}

          {!error && mode === "time" && records.length > 0 && variant === "team" && teamView === "client" && <ClientTimesheet employees={clientDetails} />}
          {!error && mode === "time" && records.length > 0 && variant === "team" && teamView === "employee" && (
            <div className="admin-report-table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Sessions</th><th>Projects</th><th>Tasks</th><th>Worked</th><th>Idle</th>{canAddEntry && <th>Actions</th>}</tr></thead>
                <tbody>{teamRows.map((row) => (
                  <tr key={row.key}><td>{row.label}</td><td>{row.sessions}</td><td>{row.projects.size}</td><td>{row.tasks.size}</td><td>{formatDuration(row.workedSeconds)}</td><td>{formatDuration(row.idleSeconds)}</td>
                    {canAddEntry && <td>{canAddFor(row.employee) && <div className="report-manual-actions">
                      <button type="button" className="report-add-entry-button" onClick={() => setEntryEmployee({ id: row.key, name: row.label })}><Plus size={14} />Add Entry</button>
                      {manualEntryCount(row.key) > 0 && <button type="button" className="secondary-button" onClick={() => setManualEntryEmployee({ id: row.key, name: row.label })}>Manual entries ({manualEntryCount(row.key)})</button>}
                    </div>}</td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {!error && mode === "time" && records.length > 0 && variant === "project" && (
            <div className="project-work-details">
              <div className="project-work-report-banner">
                {teams.find((item) => item._id === appliedHeading.team)?.teamName || "All teams"}
                {" · "}
                {employees.find((item) => item._id === appliedHeading.employee)?.fullName || "All employees"}
                {" · "}
                {appliedHeading.fromDate} to {appliedHeading.toDate}
              </div>
              {projectDetails.map((employeeRow) => (
                <section className="project-work-employee" key={employeeRow.key}>
                  <h3>{employeeRow.name}</h3>
                  <div className="admin-report-table-wrap">
                    <table>
                      <thead><tr><th>Project</th><th>Sessions</th><th>Worked</th><th>Break</th><th>Idle</th></tr></thead>
                      <tbody>
                        {employeeRow.projects.map((row) => (
                          <tr key={row.key}>
                            <td>{row.name}</td><td>{row.sessions}</td>
                            <td>{formatDuration(row.workedSeconds)}</td>
                            <td>{formatDuration(row.breakSeconds)}</td>
                            <td className="project-work-idle">{formatDuration(row.idleSeconds)}</td>
                          </tr>
                        ))}
                        <tr className="project-work-total"><td>Employee total</td><td>—</td>
                          <td>{formatDuration(employeeRow.workedSeconds)}</td>
                          <td>{formatDuration(employeeRow.breakSeconds)}</td>
                          <td className="project-work-idle">{formatDuration(employeeRow.idleSeconds)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}

          {!error && mode === "time" && records.length > 0 && variant === "summary" && (
            <div className="admin-report-table-wrap">
              <table>
                <thead><tr><th>Total for {appliedHeading.fromDate} to {appliedHeading.toDate}</th><th>Time</th></tr></thead>
                <tbody>
                  {summaryRows.map((row) => (
                    <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.value}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="admin-report-message">For your work from time to time, open My detailed timesheet.</p>
            </div>
          )}

          {!error && mode === "time" && records.length > 0 && variant === "detailed" && (
            <div className="admin-report-table-wrap">
              <table>
                <thead><tr>{scope === "company" && <th>Employee</th>}<th>Type</th><th>Project</th><th>Task / segment</th><th>Started</th><th>Finished</th><th>Duration</th><th>Idle</th><th>Status</th><th>Note</th></tr></thead>
                <tbody>{timelineRows.map(({ record, entry, key }) => (
                      <tr className={`report-timeline-row report-${entry.type}-row`} key={key}>
                        {scope === "company" && <td>{record.employee?.fullName || "—"}</td>}
                        <td><span className={`report-entry-badge ${entry.type}`}>{entry.type}</span></td>
                        <td>{record.project?.projectName || "—"}</td>
                        <td>{entry.source === "between_sessions" ? "Between tasks" : entry.type === "work" ? `${record.task?.taskName || "Task"} · Work ${entry.sequence}` : `${entry.type === "break" ? record.task?.taskName || "Break" : "Idle"} ${entry.sequence}`}</td>
                        <td><strong>{formatReportDateTime(entry.start)}</strong></td>
                        <td><strong>{entry.end ? formatReportDateTime(entry.end) : "In progress"}</strong></td>
                        <td>{formatReportDuration(entry.durationSeconds)}</td>
                        <td>{entry.type === "idle" ? formatReportDuration(entry.durationSeconds) : "—"}</td>
                        <td>{reportEntryStatus(record, entry)}</td>
                        <td className="report-entry-note">{entry.type === "work" ? record.note || "—" : "—"}</td>
                      </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {!error && mode === "attendance" && records.length > 0 && (
            <div className="admin-report-table-wrap">
              <table>
                <thead><tr>{scope === "company" && <th>Employee</th>}<th>Date</th><th>Check in</th><th>Check out</th><th>Total hours</th><th>Status</th></tr></thead>
                <tbody>{records.map((record) => (
                  <tr key={record._id}>{scope === "company" && <td>{record.employee?.fullName || "—"}</td>}<td>{record.date}</td><td>{record.checkIn ? new Date(record.checkIn).toLocaleTimeString() : "—"}</td><td>{record.checkOut ? new Date(record.checkOut).toLocaleTimeString() : "—"}</td><td>{record.totalHours || 0}</td><td>{record.status}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {entryEmployee && <AddEntryModal employee={entryEmployee} onClose={() => setEntryEmployee(null)} onSaved={handleEntrySaved} />}
      {manualEntryEmployee && <ManualEntriesModal employee={manualEntryEmployee}
        records={scope === "personal" ? records.map((record) => ({ ...record, employee: record.employee || user })) : records}
        onClose={() => setManualEntryEmployee(null)} onDeleted={handleEntryDeleted} />}
    </DashboardLayout>
  );
}

function AdminReportPage(props) {
  const { pathname } = useLocation();
  // Sibling report routes reuse this component. A key gives each route its
  // own filter state instead of carrying Project Hours selections across.
  return <AdminReportContent key={pathname} {...props} />;
}

export default AdminReportPage;
