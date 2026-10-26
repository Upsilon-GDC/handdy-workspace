import ModalFrame from "../../components/layout/ModalFrame";
import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import axiosInstance from "../../api/axiosInstance";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import useDataRefresh from "../../hooks/useDataRefresh";
import { getAllEmployeeOptions } from "../../api/employeeApi";
import useAuth from "../../context/useAuth";
import PermissionNote from "../../components/layout/PermissionNote";
import { missingPermissionHint } from "../../utils/permissions";

function AdminTeams() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("create_teams");
  const canEdit = hasPermission("edit_teams");
  const canAssignLead = hasPermission("assign_team_leads");
  const missingTeamPermissions = [
    ...(canCreate ? [] : ["create_teams"]),
    ...(canEdit ? [] : ["edit_teams"]),
  ];
  const [teams, setTeams] = useState([]);
  const [teamLeads, setTeamLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");

  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [teamName, setTeamName] = useState("");
  const [teamLeadId, setTeamLeadId] = useState("");

  const loadTeams = async ({ background = false } = {}) => {
    try {
      if (!background) setLoading(true);
      setError("");
      const { data } = await axiosInstance.get("/teams");
      setTeams((data.teams || []).map((team) => ({
        id: team._id,
        teamName: team.teamName,
        teamLead: team.teamLead?.fullName || "Not assigned",
        teamLeadId: team.teamLead?._id || "",
        status: team.isActive ? "Active" : "Inactive",
      })));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load teams."));
    } finally {
      if (!background) setLoading(false);
    }
  };

  useEffect(() => {
    void loadTeams();
  }, []);
  useDataRefresh(() => loadTeams({ background: true }));

  useEffect(() => {
    getAllEmployeeOptions({ role: "team_lead", isActive: true })
      .then(setTeamLeads)
      .catch((requestError) => setError(getApiErrorMessage(requestError, "Unable to load team leads.")));
  }, []);

  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const matchesSearch = team.teamName
        .toLowerCase()
        .includes(search.trim().toLowerCase());

      const matchesStatus =
        statusFilter === "All" ||
        team.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [teams, search, statusFilter]);

  const openAddTeam = () => {
    setTeamName("");
    setTeamLeadId("");
    setShowAddTeam(true);
  };

  const closeAddTeam = () => {
    setShowAddTeam(false);
    setTeamName("");
    setTeamLeadId("");
  };

  const handleAddTeam = async (event) => {
    event.preventDefault();

    if (!teamName.trim()) {
      window.alert("Team name is required.");
      return;
    }

    try {
      setError("");
      await axiosInstance.post("/teams", { teamName: teamName.trim(), teamLead: teamLeadId || undefined });
      closeAddTeam();
      await loadTeams();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to add team."));
    }
  };

  const handleDelete = async (teamId) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this team?"
    );

    if (!confirmed) {
      return;
    }

    try {
      await axiosInstance.delete(`/teams/${teamId}`);
      await loadTeams();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to deactivate team."));
    }
  };

  const openEditTeam = (team) => {
    setEditingTeamId(team.id);
    setTeamName(team.teamName);
    setTeamLeadId(team.teamLeadId);
    setShowEditTeam(true);
  };

  const closeEditTeam = () => {
    setShowEditTeam(false);
    setEditingTeamId(null);
    setTeamName("");
    setTeamLeadId("");
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!teamName.trim()) return;
    try {
      await axiosInstance.put(`/teams/${editingTeamId}`, { teamName: teamName.trim(), teamLead: teamLeadId || null });
      closeEditTeam();
      await loadTeams();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to update team."));
    }
  };

  return (
    <DashboardLayout title="Team">
      <section className="admin-card team-management-card">
        {error && <p className="admin-error-box" role="alert">{error}</p>}
        {missingTeamPermissions.length > 0 && <PermissionNote permissions={missingTeamPermissions}>
          {canCreate || canEdit ? "Some team actions are hidden." : "View only."}
        </PermissionNote>}
        <div className="team-toolbar">
          <div className="team-search-box">
            <label htmlFor="team-search">
              Search:
            </label>

            <input
              id="team-search"
              type="search" aria-label="Search records"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          {canCreate && <button
            type="button"
            className="team-add-button"
            onClick={openAddTeam}
          >
            Add New Team
          </button>}
        </div>

        <div className="team-table-wrapper">
          <table className="team-table">
            <thead>
              <tr>
                <th>
                  Team name
                </th>

                <th>Team Lead</th>

                {canEdit && <th>
                  Action
                </th>}

                <th className="team-status-header">
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value)
                    }
                  >
                    <option value="All">All</option>
                    <option value="Active">
                      Active
                    </option>
                    <option value="Inactive">
                      Inactive
                    </option>
                  </select>
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={canEdit ? 4 : 3} className="team-empty">Loading teams...</td></tr>
              ) : filteredTeams.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 4 : 3} className="team-empty">
                    No teams found. Create a team to organize your employees.
                  </td>
                </tr>
              ) : (
                filteredTeams.map((team) => (
                  <tr key={team.id}>
                    <td>
                      {team.teamName}
                    </td>

                    <td>{team.teamLead}</td>

                    {canEdit && <td>
                      <div className="team-actions">
                        <button
                          type="button"
                          className="team-edit-button"
                          onClick={() => openEditTeam(team)}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          className="team-delete-button"
                          onClick={() =>
                            handleDelete(team.id)
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </td>}

                    <td>
                      <span
                        className={
                          team.status === "Active"
                            ? "team-status active"
                            : "team-status inactive"
                        }
                      >
                        {team.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="team-table-footer">
          <div className="team-records-control">
            <span>Records per page</span>

            <select defaultValue="10">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          <div className="team-pagination">
            <button type="button" disabled>
              «
            </button>

            <button type="button" disabled>
              ‹
            </button>

            <button
              type="button"
              className="active"
            >
              1
            </button>

            <button type="button" disabled>
              ›
            </button>

            <button type="button" disabled>
              »
            </button>
          </div>
        </div>
      </section>

      {showAddTeam && (
        <ModalFrame onClose={closeAddTeam} label="Teams details">
          <div className="team-modal">
            <div className="team-modal-header">
              <h2>Add New Team</h2>

              <button
                type="button"
                className="team-modal-close"
                onClick={closeAddTeam}
              >
                ×
              </button>
            </div>

            <form
              className="team-modal-form"
              onSubmit={handleAddTeam}
            >
              <label htmlFor="add-team-name">Team Name</label>
              <input
                id="add-team-name"
                type="text"
                value={teamName}
                onChange={(event) =>
                  setTeamName(event.target.value)
                }
                placeholder="Enter team name"
                autoFocus
              />

              <label htmlFor="add-team-lead">Team Lead <span>(optional)</span></label>
              <select id="add-team-lead" value={teamLeadId} onChange={(event) => setTeamLeadId(event.target.value)}>
                <option value="">Assign later</option>
                {teamLeads.map((lead) => <option key={lead._id} value={lead._id}>{lead.fullName} ({lead.employeeId})</option>)}
              </select>

              <div className="team-modal-actions">
                <button
                  type="button"
                  className="team-cancel-button"
                  onClick={closeAddTeam}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="team-save-button"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </ModalFrame>
      )}

      {showEditTeam && (
        <ModalFrame onClose={closeEditTeam} label="Teams details">
          <div className="team-modal">
            <div className="team-modal-header">
              <div><p className="admin-eyebrow">TEAM MANAGEMENT</p><h2>Edit Team</h2></div>
              <button type="button" className="team-modal-close" onClick={closeEditTeam}>×</button>
            </div>
            <form className="team-modal-form" onSubmit={handleEdit}>
              <label htmlFor="edit-team-name">Team name</label>
              <input id="edit-team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} required autoFocus />
              <label htmlFor="edit-team-lead">Team Lead</label>
              <select id="edit-team-lead" value={teamLeadId} onChange={(event) => setTeamLeadId(event.target.value)}
                disabled={!canAssignLead} title={canAssignLead ? undefined : missingPermissionHint(["assign_team_leads"])}>
                <option value="">No team lead assigned</option>
                {teamLeads.map((lead) => <option key={lead._id} value={lead._id}>{lead.fullName} ({lead.employeeId})</option>)}
              </select>
              <p className="team-form-help">{canAssignLead
                ? "Changing the Team Lead updates the team assignment for its active members."
                : missingPermissionHint(["assign_team_leads"])}</p>
              <div className="team-modal-actions">
                <button type="button" className="team-cancel-button" onClick={closeEditTeam}>Cancel</button>
                <button type="submit" className="team-save-button">Save changes</button>
              </div>
            </form>
          </div>
        </ModalFrame>
      )}
    </DashboardLayout>
  );
}

export default AdminTeams;
