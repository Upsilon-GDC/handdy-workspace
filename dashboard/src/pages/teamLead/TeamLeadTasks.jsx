import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, SquareX } from "lucide-react";
import axiosInstance from "../../api/axiosInstance";
import { getAllTasks } from "../../api/taskApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import useAuth from "../../context/useAuth";
import ModalFrame from "../../components/layout/ModalFrame";
import PermissionNote from "../../components/layout/PermissionNote";
import TaskForm from "../../components/tasks/TaskForm";
import { TASK_CREATE_PERMISSIONS, missingTaskPermissions } from "../../utils/permissions";
import "../../styles/adminTasks.css";
import "../../styles/teamLeadSidebar.css";
import "../../styles/teamLeadTasks.css";

function TeamLeadTasks() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(...TASK_CREATE_PERMISSIONS);
  const canEdit = hasPermission("edit_tasks");
  const canArchive = hasPermission("archive_tasks");
  const missingPermissions = missingTaskPermissions(hasPermission);
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      // "manage": the own team's tasks, also for an employee given task duties.
      setTasks(await getAllTasks({ scope: "manage" }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load tasks."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const filteredTasks = useMemo(() => {
    const text = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesSearch = !text || task.taskName?.toLowerCase().includes(text) || task.taskCode?.toLowerCase().includes(text);
      const taskStatus = task.isActive ? "Active" : "Inactive";
      return matchesSearch && (status === "All" || status === taskStatus);
    });
  }, [search, status, tasks]);

  // Only legacy projects still carry a service type; see BillingPage.
  const showServiceType = tasks.some((task) => task.taskType !== "break" && task.project?.serviceType);
  const columnCount = (showServiceType ? 7 : 6) - (canEdit || canArchive ? 0 : 1);

  const toggleTask = async (taskId) => {
    try {
      await axiosInstance.patch(`/tasks/${taskId}/toggle-status`);
      await loadTasks();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to update task."));
    }
  };

  const deleteTask = async (taskId) => {
    if (!window.confirm("Delete this task?")) return;
    try {
      await axiosInstance.delete(`/tasks/${taskId}`);
      await loadTasks();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to delete task."));
    }
  };

  return (
    <div className="tl-page">
      <main className="tl-main">
        <div className="tl-tasks-header">
          <div><p>TEAM TASK MANAGEMENT</p><h1>Tasks</h1><span>Create and manage work for your team.</span></div>
          <div className="tl-tasks-actions">
            <button type="button" onClick={() => void loadTasks()} disabled={loading}>Refresh</button>
            {canCreate && <button type="button" onClick={() => navigate("/team-lead/tasks/add")}>+ Add task</button>}
          </div>
        </div>
        {missingPermissions.length > 0 && <PermissionNote permissions={missingPermissions}>
          {canCreate || canEdit || canArchive ? "Some task actions are hidden." : "View only."}
        </PermissionNote>}
        {error && <p className="status-message error-message" role="alert">{error}</p>}
        {message && <p className="status-message success-message" role="status">{message}</p>}
        <section className="tl-tasks-card">
          <div className="tl-tasks-toolbar">
            <label>Search tasks<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by task name" aria-label="Search tasks" /></label>
            <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="All">All</option><option value="Active">Active</option><option value="Inactive">Inactive</option>
            </select></label>
          </div>
          <div className="tl-tasks-table-wrapper">
            <table className="tl-tasks-table">
              <thead><tr><th>Task</th><th>Type</th>{showServiceType && <th>Service</th>}<th>Project</th><th>Assigned to</th><th>Status</th>{(canEdit || canArchive) && <th>Actions</th>}</tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={columnCount}>Loading tasks...</td></tr> : filteredTasks.length === 0 ? <tr><td colSpan={columnCount}>No tasks found.</td></tr> : filteredTasks.map((task) => (
                  <tr key={task._id}>
                    <td>{task.taskName} <small>{task.taskCode}</small></td>
                    <td>{task.taskType}</td>{showServiceType && <td>{task.taskType === "break" ? "-" : task.project?.serviceType || "-"}</td>}<td>{task.project?.projectName || (task.taskType === "work" ? "All team projects" : "-")}</td>
                    <td>{task.assignToAllEmployees ? "Entire team" : (task.assignedTo || []).map((item) => item.fullName).join(", ") || "-"}</td>
                    <td><span className={`tl-task-status ${task.isActive ? "is-active" : "is-inactive"}`}>{task.isActive ? "Active" : "Inactive"}</span></td>
                    {(canEdit || canArchive) && <td className="tl-task-actions">
                      {canEdit && <button type="button" className="tl-task-edit" title="Edit" aria-label={`Edit ${task.taskName}`}
                        onClick={() => { setError(""); setMessage(""); setEditingTask(task); }}><Pencil size={16} /></button>}
                      {canArchive && <>
                        <button type="button" className="tl-task-toggle" onClick={() => toggleTask(task._id)}>{task.isActive ? "Deactivate" : "Activate"}</button>
                        <button type="button" className="tl-task-delete" aria-label={`Delete ${task.taskName}`} onClick={() => deleteTask(task._id)}><SquareX size={17} /></button>
                      </>}
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      {editingTask && (
        <ModalFrame onClose={() => setEditingTask(null)} label="Edit task">
          <div className="task-modal">
            <div className="task-modal-header">
              <div><p>TASK MANAGEMENT</p><h2>Edit Task</h2></div>
              <button type="button" className="task-modal-close" aria-label="Close" onClick={() => setEditingTask(null)}>×</button>
            </div>
            <TaskForm
              mode="edit"
              scope="teamLead"
              initialTask={editingTask}
              formClassName="admin-add-task-card embedded"
              saveLabel="Update task"
              onCancel={() => setEditingTask(null)}
              onSaved={() => {
                setEditingTask(null);
                setMessage("Task updated.");
                void loadTasks();
              }}
            />
          </div>
        </ModalFrame>
      )}
    </div>
  );
}

export default TeamLeadTasks;
