import ModalFrame from "../../components/layout/ModalFrame";
import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import axiosInstance from "../../api/axiosInstance";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import useDataRefresh from "../../hooks/useDataRefresh";
import useAuth from "../../context/useAuth";
import PermissionNote from "../../components/layout/PermissionNote";

function AdminProjects() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_projects");
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  // ADD PROJECT
  const [showAddProject, setShowAddProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [formData, setFormData] = useState({
    projectName: "",
    teams: [],
  });

  // EDIT PROJECT
  const [showEditProject, setShowEditProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [editFormData, setEditFormData] = useState({
    projectName: "",
    teams: [],
    status: "Active",
  });

  // LOAD PROJECTS
  const fetchProjects = useCallback(async (isCurrent = () => true) => {
    try {
      setLoading(true);
      setError("");

      const params = {
        page,
        limit,
      };

      if (search.trim()) {
        params.search = search.trim();
      }

      if (status !== "") {
        params.status = status;
      }

      const response = await axiosInstance.get("/projects", {
        params,
      });

      const data = response.data;

      if (!isCurrent()) return;
      setProjects(data.projects || []);
      setTotalPages(data.totalPages || 1);
    } catch (requestError) {
      if (!isCurrent()) return;
      setError(
        getApiErrorMessage(
          requestError,
          "Unable to load projects."
        )
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [search, status, page, limit]);

  useEffect(() => {
    let active = true;
    void fetchProjects(() => active);
    return () => {
      active = false;
    };
  }, [fetchProjects]);
  useDataRefresh(fetchProjects);

  useEffect(() => {
    axiosInstance.get("/teams")
      .then((teamResponse) => {
        setTeams((teamResponse.data.teams || []).filter((team) => team.isActive));
      })
      .catch((requestError) => setError(getApiErrorMessage(requestError, "Unable to load project options.")));
  }, []);

  // SEARCH
  const handleSearch = (event) => {
    event.preventDefault();
    setPage(1);
    fetchProjects();
  };

  // DELETE
  const handleDelete = async (projectId) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this project?"
    );

    if (!confirmed) return;

    try {
      await axiosInstance.delete(`/projects/${projectId}`);
      setProjects((previous) => previous.filter((project) => project._id !== projectId));
    } catch (requestError) {
      window.alert(
        getApiErrorMessage(
          requestError,
          "Unable to delete project."
        )
      );
    }
  };

  // ADD FORM CHANGE
  const handleFormChange = (event) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const toggleTeam = (teamId, isEditing = false) => {
    const update = (previous) => ({
      ...previous,
      teams: previous.teams.includes(teamId)
        ? previous.teams.filter((id) => id !== teamId)
        : [...previous.teams, teamId],
    });
    if (isEditing) setEditFormData(update);
    else setFormData(update);
  };

  const closeAddProject = () => {
    setShowAddProject(false);

    setFormData({
      projectName: "",
      teams: [],
    });

    setFormError("");
  };

  // ADD PROJECT
  const handleAddProject = async (event) => {
    event.preventDefault();

    if (!formData.projectName.trim()) {
      setFormError("Project name is required.");
      return;
    }

    if (formData.teams.length === 0) {
      setFormError("Select at least one team.");
      return;
    }

    try {
      setSaving(true);
      setFormError("");

      await axiosInstance.post("/projects", {
        projectName: formData.projectName.trim(),
        teams: formData.teams,
      });

      closeAddProject();
      await fetchProjects();
    } catch (requestError) {
      setFormError(
        getApiErrorMessage(
          requestError,
          "Unable to add project."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  // OPEN EDIT MODAL
  const openEditProject = (project) => {
    setEditingProjectId(project._id);

    setEditFormData({
      projectName: project.projectName || "",
      teams: (project.teams || []).map((team) => typeof team === "string" ? team : team?._id).filter(Boolean),
      status: project.status || "Active",
    });

    setEditError("");
    setShowEditProject(true);
  };

  // EDIT FORM CHANGE
  const handleEditFormChange = (event) => {
    const { name, value } = event.target;

    setEditFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const closeEditProject = () => {
    setShowEditProject(false);
    setEditingProjectId(null);
    setEditError("");
  };

  // UPDATE PROJECT
  const handleUpdateProject = async (event) => {
    event.preventDefault();

    if (!editFormData.projectName.trim()) {
      setEditError("Project name is required.");
      return;
    }

    if (editFormData.teams.length === 0) {
      setEditError("Select at least one team.");
      return;
    }

    try {
      setEditSaving(true);
      setEditError("");

      await axiosInstance.put(
        `/projects/${editingProjectId}`,
        {
          projectName:
            editFormData.projectName.trim(),

          teams: editFormData.teams,

          status:
            editFormData.status,
        }
      );

      closeEditProject();

      await fetchProjects();
    } catch (requestError) {
      setEditError(
        getApiErrorMessage(
          requestError,
          "Unable to update project."
        )
      );
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <DashboardLayout title="Projects">
      <section className="admin-card projects-card">

        <div className="projects-page-heading">
          <div>
            <p className="admin-eyebrow">
              PROJECT MANAGEMENT
            </p>

            <h2>Projects</h2>
            {!canManage && <PermissionNote permissions={["manage_projects"]} />}
          </div>

          {canManage && <button
            className="add-project-button"
            type="button"
            onClick={() => setShowAddProject(true)}
          >
            + Add New Project
          </button>}
        </div>

        <div className="projects-toolbar">

          <form
            className="projects-search"
            onSubmit={handleSearch}
          >
            <label>Search:</label>

            <input
              type="search" aria-label="Search records"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />

            <button type="submit">
              Search
            </button>
          </form>

          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
            <option value="On Hold">On Hold</option>
          </select>
        </div>

        {error && (
          <div className="admin-error-box">
            {error}
          </div>
        )}

        <div className="projects-table-wrapper">
          <table className="projects-table">

            <thead>
              <tr>
                <th>Project Name</th>
                <th>Teams</th>
                <th>Status</th>
                {canManage && <th>Action</th>}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canManage ? 4 : 3}>
                    Loading projects...
                  </td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 4 : 3}>
                    No projects match your filters. Try a different search or create a project.
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <tr key={project._id}>

                    <td>
                      {project.projectName || "-"}
                    </td>

                    <td>
                      {(project.teams || []).map((team) => team.teamName || team).join(", ") || "All teams"}
                    </td>

                    <td>
                      <span
                        className={
                          project.status === "Active"
                            ? "employee-status active"
                            : "employee-status inactive"
                        }
                      >
                        {project.status || "Active"}
                      </span>
                    </td>

                    {canManage && <td>
                      <div className="project-actions">

                        <button
                          className="edit-action-button"
                          type="button"
                          onClick={() =>
                            openEditProject(project)
                          }
                        >
                          Edit
                        </button>

                        <button
                          className="delete-action-button"
                          type="button"
                          onClick={() =>
                            handleDelete(project._id)
                          }
                        >
                          Delete
                        </button>

                      </div>
                    </td>}
                  </tr>
                ))
              )}
            </tbody>

          </table>
        </div>

        <div className="projects-footer">

          <div className="records-per-page">
            <span>Records per page</span>

            <select
              value={limit}
              onChange={(event) => {
                setLimit(
                  Number(event.target.value)
                );

                setPage(1);
              }}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
            </select>
          </div>

          <div className="projects-pagination">
            <p>
              Page {page} of {totalPages}
            </p>

            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              «
            </button>

            <button
              type="button"
              disabled={page === 1}
              onClick={() =>
                setPage((previous) =>
                  Math.max(1, previous - 1)
                )
              }
            >
              ‹
            </button>

            <span className="current-page">
              {page}
            </span>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() =>
                setPage((previous) =>
                  Math.min(
                    totalPages,
                    previous + 1
                  )
                )
              }
            >
              ›
            </button>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() =>
                setPage(totalPages)
              }
            >
              »
            </button>

          </div>
        </div>
      </section>


      {/* ADD PROJECT MODAL */}
      {showAddProject && (
        <ModalFrame onClose={closeAddProject} label="Add project">
          <div className="employee-modal project-editor-modal">

            <div className="employee-modal-header">
              <div>
                <p className="admin-eyebrow">
                  PROJECT MANAGEMENT
                </p>

                <h2>Add Project</h2>
              </div>

              <button
                className="modal-close-button"
                type="button"
                onClick={closeAddProject}
              >
                ×
              </button>
            </div>

            {formError && (
              <div className="admin-error-box">
                {formError}
              </div>
            )}

            <form
              className="employee-form"
              onSubmit={handleAddProject}
            >
              <div>
                <label>Project Name</label>

                <input
                  name="projectName"
                  type="text"
                  value={formData.projectName}
                  onChange={handleFormChange}
                  required
                />
              </div>

              <div className="project-client-picker project-team-picker">
                <div className="project-client-picker-heading">
                  <label>Teams</label>
                  <span>{formData.teams.length} selected</span>
                </div>
                <p className="project-picker-help">This project will be available to employees in every selected team.</p>
                <div className="project-client-options" role="group" aria-label="Select teams">
                  {teams.map((team) => {
                    const selected = formData.teams.includes(team._id);
                    return <button type="button" key={team._id} className={`project-client-option ${selected ? "selected" : ""}`} onClick={() => toggleTeam(team._id)} aria-pressed={selected}>
                      <span className="project-client-check">{selected ? "✓" : ""}</span>{team.teamName}
                    </button>;
                  })}
                </div>
              </div>


              <div className="employee-form-actions">

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeAddProject}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : "Save Project"}
                </button>

              </div>
            </form>

          </div>
        </ModalFrame>
      )}


      {/* EDIT PROJECT MODAL */}
      {showEditProject && (
        <ModalFrame onClose={closeEditProject} label="Edit project">
          <div className="employee-modal project-editor-modal">

            <div className="employee-modal-header">
              <div>
                <p className="admin-eyebrow">
                  PROJECT MANAGEMENT
                </p>

                <h2>Edit Project</h2>
              </div>

              <button
                className="modal-close-button"
                type="button"
                onClick={closeEditProject}
              >
                ×
              </button>
            </div>

            {editError && (
              <div className="admin-error-box">
                {editError}
              </div>
            )}

            <form
              className="employee-form"
              onSubmit={handleUpdateProject}
            >

              <div>
                <label>Project Name</label>

                <input
                  name="projectName"
                  type="text"
                  value={editFormData.projectName}
                  onChange={handleEditFormChange}
                  required
                />
              </div>

              <div className="project-client-picker project-team-picker">
                <div className="project-client-picker-heading">
                  <label>Teams</label>
                  <span>{editFormData.teams.length} selected</span>
                </div>
                <p className="project-picker-help">Only employees in the selected teams can use this project.</p>
                <div className="project-client-options" role="group" aria-label="Select teams">
                  {teams.map((team) => {
                    const selected = editFormData.teams.includes(team._id);
                    return <button type="button" key={team._id} className={`project-client-option ${selected ? "selected" : ""}`} onClick={() => toggleTeam(team._id, true)} aria-pressed={selected}>
                      <span className="project-client-check">{selected ? "✓" : ""}</span>{team.teamName}
                    </button>;
                  })}
                </div>
              </div>

              <div>
                <label>Status</label>

                <select
                  name="status"
                  value={editFormData.status}
                  onChange={handleEditFormChange}
                >
                  <option value="Active">
                    Active
                  </option>

                  <option value="Completed">
                    Completed
                  </option>

                  <option value="On Hold">
                    On Hold
                  </option>
                </select>
              </div>


              <div className="employee-form-actions">

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeEditProject}
                  disabled={editSaving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={editSaving}
                >
                  {editSaving
                    ? "Updating..."
                    : "Update Project"}
                </button>

              </div>
            </form>

          </div>
        </ModalFrame>
      )}

    </DashboardLayout>
  );
}

export default AdminProjects;
