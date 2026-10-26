import ModalFrame from "../../components/layout/ModalFrame";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import TaskForm from "../../components/tasks/TaskForm";
import "../../styles/adminTasks.css";
import { deleteTask, getAllTasks } from "../../api/taskApi";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import useAuth from "../../context/useAuth";
import PermissionNote from "../../components/layout/PermissionNote";
import { TASK_CREATE_PERMISSIONS, missingTaskPermissions } from "../../utils/permissions";

const getTaskName = (task) =>
  task.taskName || task.name || task.taskCode || "-";

const getAssignedName = (task) => {
  if (task.assignToAllEmployees) {
    return `Entire ${task.team?.teamName || "selected"} team`;
  }

  if (Array.isArray(task.assignedTo)) {
    const names = task.assignedTo
      .map((employee) => {
        if (typeof employee === "string") {
          return employee;
        }

        return (
          employee?.fullName ||
          employee?.employeeId ||
          ""
        );
      })
      .filter(Boolean);

    return names.length > 0
      ? names.join(", ")
      : "-";
  }

  return "-";
};

function AdminTasks() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(...TASK_CREATE_PERMISSIONS);
  const canEdit = hasPermission("edit_tasks");
  const canArchive = hasPermission("archive_tasks");
  const missingPermissions = missingTaskPermissions(hasPermission);
  const [tasks, setTasks] = useState([]);

  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("active");

  const [recordsPerPage, setRecordsPerPage] =
    useState(10);

  const [currentPage, setCurrentPage] =
    useState(1);

  const [sortField, setSortField] =
    useState("taskName");

  const [sortDirection, setSortDirection] =
    useState("asc");

  const [showModal, setShowModal] =
    useState(false);

  const [editingTask, setEditingTask] =
    useState(null);

  // ==============================
  // LOAD TASKS
  // ==============================

  const loadTasks = async ({ background = false } = {}) => {
    try {
      if (!background) setLoading(true);
      setError("");

      setTasks(await getAllTasks());
    } catch (err) {
      console.error(err);

      setError(getApiErrorMessage(err, "Unable to load tasks."));
    } finally {
      if (!background) setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  // ==============================
  // FILTER + SORT
  // ==============================

  const filteredTasks = useMemo(() => {
    const searchValue =
      search.trim().toLowerCase();

    let result = [...tasks];

    if (statusFilter === "active") {
      result = result.filter(
        (task) => task.isActive !== false
      );
    }

    if (statusFilter === "inactive") {
      result = result.filter(
        (task) => task.isActive === false
      );
    }

    if (searchValue) {
      result = result.filter((task) => {
        const name =
          getTaskName(task).toLowerCase();

        const code = (
          task.taskCode || ""
        ).toLowerCase();

        const type = (
          task.taskType || ""
        ).toLowerCase();

        const assigned =
          getAssignedName(task).toLowerCase();

        return (
          name.includes(searchValue) ||
          code.includes(searchValue) ||
          type.includes(searchValue) ||
          assigned.includes(searchValue)
        );
      });
    }

    result.sort((a, b) => {
      let valueA = "";
      let valueB = "";

      if (sortField === "taskName") {
        valueA = getTaskName(a);
        valueB = getTaskName(b);
      }

      if (sortField === "taskType") {
        valueA = a.taskType || "";
        valueB = b.taskType || "";
      }

      if (sortField === "assignedTo") {
        valueA = getAssignedName(a);
        valueB = getAssignedName(b);
      }

      valueA = valueA
        .toString()
        .toLowerCase();

      valueB = valueB
        .toString()
        .toLowerCase();

      if (valueA < valueB) {
        return sortDirection === "asc"
          ? -1
          : 1;
      }

      if (valueA > valueB) {
        return sortDirection === "asc"
          ? 1
          : -1;
      }

      return 0;
    });

    return result;
  }, [
    tasks,
    search,
    statusFilter,
    sortField,
    sortDirection,
  ]);

  // Only legacy projects still carry a service type; see BillingPage.
  const showServiceType = tasks.some((task) => task.taskType !== "break" && task.project?.serviceType);
  const columnCount = (showServiceType ? 8 : 7) - (canEdit || canArchive ? 0 : 1);

  // ==============================
  // PAGINATION
  // ==============================

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredTasks.length / recordsPerPage
    )
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [
    search,
    statusFilter,
    recordsPerPage,
  ]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const startIndex =
    (currentPage - 1) * recordsPerPage;

  const visibleTasks =
    filteredTasks.slice(
      startIndex,
      startIndex + recordsPerPage
    );

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((previous) =>
        previous === "asc"
          ? "desc"
          : "asc"
      );

      return;
    }

    setSortField(field);
    setSortDirection("asc");
  };

  // ==============================
  // EDIT
  // ==============================

  const openEditModal = (task) => {
    setEditingTask(task);
    setError("");
    setMessage("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTask(null);
  };

  // ==============================
  // DELETE
  // ==============================

  const handleDelete = async (task) => {
    const taskId =
      task._id || task.id;

    if (!taskId) return;

    const confirmed =
      window.confirm(
        `Delete "${getTaskName(task)}"?`
      );

    if (!confirmed) return;

    try {
      setError("");
      setMessage("");

      await deleteTask(taskId);

      setMessage(
        "Task deleted successfully."
      );
      setTasks((previous) => previous.filter((item) => (item._id || item.id) !== taskId));
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to delete task."));
    }
  };

  // ==============================
  // PAGE NUMBERS
  // ==============================

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from(
        { length: totalPages },
        (_, index) => index + 1
      );
    }

    if (currentPage <= 4) {
      return [
        1,
        2,
        3,
        4,
        5,
        "...",
        totalPages,
      ];
    }

    if (
      currentPage >=
      totalPages - 3
    ) {
      return [
        1,
        "...",
        totalPages - 4,
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages,
      ];
    }

    return [
      1,
      "...",
      currentPage - 1,
      currentPage,
      currentPage + 1,
      "...",
      totalPages,
    ];
  };

  return (
    <DashboardLayout title="Tasks">
      <div className="tasks-page">
        <h1 className="tasks-page-title">
          Tasks
        </h1>

        <section className="tasks-card">

          {/* SEARCH + ADD */}

          <div className="tasks-toolbar">
            <button type="button" onClick={() => void loadTasks()} disabled={loading}>Refresh</button>
            <div className="tasks-search-box">
              <label htmlFor="task-search">
                Search:
              </label>

              <input
                id="task-search"
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
              />
            </div>

            {canCreate && <button
              type="button"
              className="tasks-add-button"
              onClick={() => navigate("/admin/tasks/new")}
            >
              Add New Task
            </button>}
          </div>
          {missingPermissions.length > 0 && <PermissionNote permissions={missingPermissions}>
            {canCreate || canEdit || canArchive ? "Some task actions are hidden." : "View only."}
          </PermissionNote>}

          {message && (
            <div className="tasks-message success">
              {message}
            </div>
          )}

          {error && (
            <div className="tasks-message error">
              {error}
            </div>
          )}

          {/* TABLE */}

          <div className="tasks-table-wrapper">
            <table className="tasks-table">
              <thead>
                <tr>
                  <th>
                    Team
                  </th>

                  <th>
                    Project
                  </th>

                  <th>
                    <button
                      type="button"
                      className="task-sort-button"
                      onClick={() =>
                        handleSort(
                          "taskName"
                        )
                      }
                    >
                      <span>
                        Task name
                      </span>

                      <span>↕</span>
                    </button>
                  </th>

                  <th>
                    <button
                      type="button"
                      className="task-sort-button"
                      onClick={() =>
                        handleSort(
                          "taskType"
                        )
                      }
                    >
                      <span>
                        Task type
                      </span>

                      <span>↕</span>
                    </button>
                  </th>

                  {showServiceType && <th>Service</th>}

                  <th>
                    <button
                      type="button"
                      className="task-sort-button"
                      onClick={() =>
                        handleSort(
                          "assignedTo"
                        )
                      }
                    >
                      <span>
                        Assigned to
                      </span>

                      <span>↕</span>
                    </button>
                  </th>

                  {(canEdit || canArchive) && <th>
                    Action
                  </th>}

                  <th className="tasks-status-heading">
                    <select
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(
                          event.target.value
                        )
                      }
                    >
                      <option value="active">
                        Active
                      </option>

                      <option value="inactive">
                        Inactive
                      </option>

                      <option value="all">
                        All
                      </option>
                    </select>
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={columnCount}
                      className="tasks-empty"
                    >
                      Loading tasks...
                    </td>
                  </tr>
                ) : visibleTasks.length ===
                  0 ? (
                  <tr>
                    <td
                      colSpan={columnCount}
                      className="tasks-empty"
                    >
                      No tasks found.
                    </td>
                  </tr>
                ) : (
                  visibleTasks.map(
                    (task) => {
                      const taskId =
                        task._id ||
                        task.id;

                      return (
                        <tr key={taskId}>
                          <td>
                            {(task.teams?.length ? task.teams : [task.team]).filter(Boolean).map((team) => team?.teamName || team).join(", ") || "-"}
                          </td>

                          <td>
                            {task.project?.projectName || (task.taskType === "work" ? "All team projects" : "-")}
                          </td>

                          <td>
                            {getTaskName(task)}
                          </td>

                          <td>
                            {task.taskType === "break" ? "Break time" : "Work time"}
                          </td>

                          {showServiceType && <td>{task.taskType === "break" ? "-" : task.project?.serviceType || "-"}</td>}

                          <td>
                            {getAssignedName(
                              task
                            )}
                          </td>

                          {(canEdit || canArchive) && <td>
                            <div className="task-actions">
                              {canEdit && <button
                                type="button"
                                className="task-icon-button task-edit-button"
                                title="Edit"
                                aria-label={`Edit ${getTaskName(task)}`}
                                onClick={() =>
                                  openEditModal(
                                    task
                                  )
                                }
                              >
                                <Pencil size={17} strokeWidth={2} aria-hidden="true" />
                              </button>}

                              {canArchive && <button
                                type="button"
                                className="task-icon-button task-delete-button"
                                title="Delete"
                                aria-label={`Delete ${getTaskName(task)}`}
                                onClick={() =>
                                  handleDelete(
                                    task
                                  )
                                }
                              >
                                <Trash2 size={17} strokeWidth={2} aria-hidden="true" />
                              </button>}
                            </div>
                          </td>}

                          <td>
                            <span
                              className={
                                task.isActive !==
                                false
                                  ? "task-status active"
                                  : "task-status inactive"
                              }
                            >
                              {task.isActive !==
                              false
                                ? "Active"
                                : "Inactive"}
                            </span>
                          </td>
                        </tr>
                      );
                    }
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}

          <div className="tasks-table-footer">
            <div className="tasks-page-size">
              <span className="tasks-record-count">
                Showing {filteredTasks.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + recordsPerPage, filteredTasks.length)} of {filteredTasks.length} tasks
              </span>
              <label>
                Records per page
              </label>

              <select
                value={recordsPerPage}
                onChange={(event) =>
                  setRecordsPerPage(
                    Number(
                      event.target.value
                    )
                  )
                }
              >
                <option value={10}>
                  10
                </option>

                <option value={25}>
                  25
                </option>

                <option value={50}>
                  50
                </option>

                <option value={100}>
                  100
                </option>
              </select>
            </div>

            <div className="tasks-pagination">
              <button
                type="button"
                disabled={
                  currentPage === 1
                }
                onClick={() =>
                  setCurrentPage(1)
                }
              >
                «
              </button>

              <button
                type="button"
                disabled={
                  currentPage === 1
                }
                onClick={() =>
                  setCurrentPage(
                    Math.max(
                      1,
                      currentPage - 1
                    )
                  )
                }
              >
                ‹
              </button>

              {getPageNumbers().map(
                (page, index) =>
                  page === "..." ? (
                    <span
                      key={`dots-${index}`}
                      className="tasks-pagination-dots"
                    >
                      ...
                    </span>
                  ) : (
                    <button
                      type="button"
                      key={page}
                      className={
                        currentPage === page
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setCurrentPage(
                          page
                        )
                      }
                    >
                      {page}
                    </button>
                  )
              )}

              <button
                type="button"
                disabled={
                  currentPage ===
                  totalPages
                }
                onClick={() =>
                  setCurrentPage(
                    Math.min(
                      totalPages,
                      currentPage + 1
                    )
                  )
                }
              >
                ›
              </button>

              <button
                type="button"
                disabled={
                  currentPage ===
                  totalPages
                }
                onClick={() =>
                  setCurrentPage(
                    totalPages
                  )
                }
              >
                »
              </button>
            </div>
          </div>
        </section>

        {/* MODAL */}

        {showModal && (
          <ModalFrame onClose={closeModal} label="Tasks details">
            <div className="task-modal">

              <div className="task-modal-header">
                <div>
                  <p>
                    TASK MANAGEMENT
                  </p>

                  <h2>
                    {editingTask
                      ? "Edit Task"
                      : "Add New Task"}
                  </h2>
                </div>

                <button
                  type="button"
                  className="task-modal-close"
                  onClick={closeModal}
                >
                  ×
                </button>
              </div>

              <TaskForm
                mode="edit"
                scope="admin"
                initialTask={editingTask}
                formClassName="admin-add-task-card embedded"
                saveLabel="Update Task"
                onCancel={closeModal}
                onSaved={() => {
                  setMessage("Task updated successfully.");
                  setShowModal(false);
                  setEditingTask(null);
                  void loadTasks();
                }}
              />
            </div>
          </ModalFrame>
        )}
      </div>
    </DashboardLayout>
  );
}

export default AdminTasks;
