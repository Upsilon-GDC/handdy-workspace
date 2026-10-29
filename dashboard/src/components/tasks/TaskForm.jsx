import { useEffect, useMemo, useRef, useState } from "react";

import axiosInstance from "../../api/axiosInstance";
import { getAllEmployeeOptions, getAllMyTeamMembers } from "../../api/employeeApi";
import useAuth from "../../context/useAuth";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import PermissionNote from "../layout/PermissionNote";

import "../../styles/adminAddTask.css";

const toId = (value) => (typeof value === "string" ? value : value?._id) || "";

// Shared Task Creation/Edit form used by Admin (full page + list-page edit
// modal) and Team Lead (full page). Tasks are team-wide and can be used with
// any active project available to their selected teams.
function TaskForm({
  mode = "create",
  scope = "admin",
  initialTask = null,
  formClassName = "admin-add-task-card",
  header = null,
  saveLabel,
  onCancel,
  onSaved,
}) {
  const { user, hasPermission } = useAuth();
  // Without it the form keeps the current assignment; the API accepts an
  // edit that re-submits unchanged assignees (middleware/taskPermissions.js).
  const canReassign = hasPermission("reassign_tasks");
  // Switching a task on or off is the "Archive tasks" duty (the API checks).
  const canArchive = hasPermission("archive_tasks");

  const [taskName, setTaskName] = useState(initialTask?.taskName || "");
  const [additionalTaskNames, setAdditionalTaskNames] = useState([]);
  const [taskType, setTaskType] = useState(initialTask?.taskType || "work");
  const [idleLogout, setIdleLogout] = useState(initialTask?.idleLogout === true);
  const [isActive, setIsActive] = useState(initialTask ? initialTask.isActive !== false : true);

  const [teams, setTeams] = useState(() => {
    if (scope === "teamLead") return user?.team ? [toId(user.team)] : [];
    if (initialTask) {
      const raw = initialTask.teams?.length
        ? initialTask.teams
        : initialTask.team
        ? [initialTask.team]
        : [];
      return raw.map(toId).filter(Boolean);
    }
    return [];
  });

  const [assignType, setAssignType] = useState(
    mode === "create" || initialTask?.assignToAllEmployees ? "team" : "employee"
  );
  const [assignedTo, setAssignedTo] = useState(() =>
    (initialTask?.assignedTo || []).map(toId).filter(Boolean)
  );

  const [teamsOptions, setTeamsOptions] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // `saving` only disables the button after React re-renders; a ref blocks a
  // second click or Enter press that arrives before then.
  const submittingRef = useRef(false);
  const errorRef = useRef(null);

  // The form can be taller than the window; keep a rejection visible.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [error]);

  useEffect(() => {
    if (scope !== "admin") return;
    axiosInstance
      .get("/teams")
      .then(({ data }) => setTeamsOptions((data.teams || []).filter((team) => team.isActive)))
      .catch(() => {});
  }, [scope]);

  useEffect(() => {
    let active = true;
    if (scope === "admin") {
      getAllEmployeeOptions({ isActive: true })
        .then((employees) => { if (active) setAllEmployees(employees); })
        .catch((requestError) => { if (active) setError(getApiErrorMessage(requestError, "Unable to load employees.")); });
    } else {
      getAllMyTeamMembers()
        .then((employees) => { if (active) setTeamMembers(employees); })
        .catch((requestError) => { if (active) setError(getApiErrorMessage(requestError, "Unable to load your team.")); });
    }
    return () => { active = false; };
  }, [scope]);

  const teamsKey = teams.join(",");

  const availableEmployees = useMemo(() => {
    const pool =
      scope === "admin"
        ? allEmployees.filter(
            (employee) => employee.role === "employee" && teams.includes(toId(employee.team))
          )
        : teamMembers;
    const text = employeeSearch.trim().toLowerCase();
    return text ? pool.filter((employee) => employee.fullName?.toLowerCase().includes(text)) : pool;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, allEmployees, teamMembers, teamsKey, employeeSearch]);

  const myTeamName = teamMembers[0]?.team?.teamName || "Your team";

  const toggleTeam = (teamId) => {
    setTeams((previous) =>
      previous.includes(teamId) ? previous.filter((id) => id !== teamId) : [...previous, teamId]
    );
    setAssignedTo([]);
  };

  const toggleEmployee = (employeeId) => {
    setAssignedTo((previous) =>
      previous.includes(employeeId) ? previous.filter((id) => id !== employeeId) : [...previous, employeeId]
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");

    const taskNames = [taskName, ...additionalTaskNames].map((name) => name.trim());
    if (taskNames.some((name) => !name)) {
      setError("Enter every task name, or remove unused task-name rows.");
      return;
    }
    if (new Set(taskNames.map((name) => name.toLowerCase())).size !== taskNames.length) {
      setError("Each task name in this batch must be unique.");
      return;
    }
    if (scope === "admin" && teams.length === 0) {
      setError("Select at least one team.");
      return;
    }
    if (assignType === "employee" && assignedTo.length === 0) {
      setError("Select at least one employee, or choose to assign the entire team.");
      return;
    }

    const payload = {
      taskName: taskName.trim(),
      taskType,
      // A team lead's or employee's edit keeps the task's teams; the API
      // allows only their own team.
      ...(scope === "teamLead" && mode === "edit" ? {} : { teams }),
      project: null,
      assignToAllEmployees: mode === "create" || assignType === "team",
      assignedTo: mode === "create" || assignType === "team" ? [] : assignedTo,
      idleLogout,
      ...(mode === "edit" && canArchive ? { isActive } : {}),
    };

    try {
      submittingRef.current = true;
      setSaving(true);
      const response =
        mode === "edit"
          ? await axiosInstance.put(`/tasks/${initialTask._id}`, payload)
          : await axiosInstance.post("/tasks/bulk", { ...payload, taskNames, autoProjects: true });
      onSaved(response.data.tasks || response.data.task);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to save task."));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form className={formClassName} onSubmit={handleSubmit} aria-busy={saving}>
      {header}
      {error && <p ref={errorRef} className="admin-error-box" role="alert">{error}</p>}

      <div className="admin-task-basics admin-task-name-list" style={{ gridTemplateColumns: "1fr" }}>
        <label>
          Task name
          <input
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
            placeholder="Enter task name"
            required
          />
        </label>

        {mode === "create" && additionalTaskNames.map((name, index) => (
          <div className="admin-task-name-row" key={index}>
            <label>
              Task name {index + 2}
              <input
                value={name}
                onChange={(event) => setAdditionalTaskNames((current) =>
                  current.map((item, itemIndex) => itemIndex === index ? event.target.value : item)
                )}
                placeholder="Enter another task name"
                required
              />
            </label>
            <button
              type="button"
              className="admin-task-name-remove"
              onClick={() => setAdditionalTaskNames((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`Remove task name ${index + 2}`}
            >
              Remove
            </button>
          </div>
        ))}

        {mode === "create" && (
          <button
            type="button"
            className="admin-task-name-add"
            onClick={() => setAdditionalTaskNames((current) => [...current, ""])}
          >
            + Add another task name
          </button>
        )}

        {mode === "edit" && canArchive && (
          <label>
            Status
            <select value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        )}
      </div>

      <div className="admin-task-options">
        <div>
          <strong>Task type</strong>
          <label>
            <input type="radio" checked={taskType === "work"} onChange={() => setTaskType("work")} />
            Work time
          </label>
          <label>
            <input type="radio" checked={taskType === "break"} onChange={() => setTaskType("break")} />
            Break time
          </label>
        </div>
        <label className="admin-task-idle">
          <input type="checkbox" checked={idleLogout} onChange={(event) => setIdleLogout(event.target.checked)} />
          Enable idle logout for this task
        </label>
      </div>

      {scope === "admin" ? (
        <div className="admin-task-access">
          <div className="admin-task-section-heading">
            <div>
              <p>ASSIGN ACCESS</p>
              <h3>Select teams</h3>
              <span className="admin-task-selection-copy">Choose one or more teams for this task.</span>
            </div>
            <span className="admin-task-selection-count">{teams.length} selected</span>
          </div>
          <div className="admin-task-team-grid">
            {teamsOptions.map((team) => {
              const selected = teams.includes(team._id);
              return (
                <button
                  type="button"
                  key={team._id}
                  className={`admin-task-team-option ${selected ? "selected" : ""}`}
                  onClick={() => toggleTeam(team._id)}
                  aria-pressed={selected}
                >
                  <i aria-hidden="true">{selected ? "✓" : ""}</i>
                  <span>{team.teamName}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="admin-task-access">
          <div className="admin-task-section-heading">
            <div>
              <p>ASSIGN ACCESS</p>
              <h3>Team</h3>
              <span className="admin-task-selection-copy">This task is created for your team.</span>
            </div>
            <span className="admin-task-selection-count">{myTeamName}</span>
          </div>
        </div>
      )}

      <p className="admin-task-project-empty">
        This task is available across all active projects assigned to the selected teams.
      </p>

      {mode === "edit" && <div className="admin-task-assignees">
        <div className="admin-task-section-heading">
          <div>
            <p>ASSIGNMENT</p>
            <h3>Who can use this task?</h3>
          </div>
        </div>
        {!canReassign && <PermissionNote permissions={["reassign_tasks"]}>
          {assignType === "team" ? "Entire selected team." : `${assignedTo.length} selected employee${assignedTo.length === 1 ? "" : "s"}.`}
        </PermissionNote>}
        {canReassign && <div className="admin-task-assignment-toggle">
          <button
            type="button"
            className={`admin-task-assignment-option ${assignType === "team" ? "selected" : ""}`}
            onClick={() => { setAssignType("team"); setAssignedTo([]); }}
          >
            Entire selected team
          </button>
          <button
            type="button"
            className={`admin-task-assignment-option ${assignType === "employee" ? "selected" : ""}`}
            onClick={() => setAssignType("employee")}
          >
            Specific employees
          </button>
        </div>}

        {canReassign && assignType === "employee" && (
          <div className="admin-task-employee-panel">
            <div>
              <label>
                Search employees
                <input
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  placeholder="Search by name"
                />
              </label>
              <span>{assignedTo.length} selected</span>
            </div>
            <div className="admin-task-employee-list">
              {availableEmployees.map((employee) => {
                const selected = assignedTo.includes(employee._id);
                return (
                  <button
                    type="button"
                    key={employee._id}
                    className={`admin-task-employee-option ${selected ? "selected" : ""}`}
                    onClick={() => toggleEmployee(employee._id)}
                  >
                    <i aria-hidden="true">{selected ? "✓" : ""}</i>
                    <strong>{employee.fullName}</strong>
                    <small>{employee.team?.teamName || "Team member"}</small>
                  </button>
                );
              })}
              {scope === "admin" && teams.length > 0 && availableEmployees.length === 0 && (
                <p>No employees found in the selected teams.</p>
              )}
              {scope === "teamLead" && availableEmployees.length === 0 && (
                <p>No employees found on your team.</p>
              )}
            </div>
          </div>
        )}
      </div>}

      <footer>
        <button type="button" className="admin-add-task-cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="admin-add-task-save" disabled={saving}>
          {saving
            ? "Saving..."
            : mode === "create" && additionalTaskNames.length > 0
              ? `Save ${additionalTaskNames.length + 1} task names`
              : saveLabel || "Save task"}
        </button>
      </footer>
    </form>
  );
}

export default TaskForm;
