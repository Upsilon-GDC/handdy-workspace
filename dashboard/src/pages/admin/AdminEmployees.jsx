import TeamIdentity from "../../components/teams/TeamIdentity";
import CollectionHeading from "../../components/layout/CollectionHeading";
import ModalFrame from "../../components/layout/ModalFrame";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { getEmployees, resetEmployeePassword } from "../../api/employeeApi";
import axiosInstance from "../../api/axiosInstance";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import EmployeeForm from "../../components/employees/EmployeeForm";
import { getAllActiveProjects } from "../../api/projectApi";
import { projectRatesRequiredForRole, validateEmployeeForm } from "../../utils/employeeFormValidation";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import useDataRefresh from "../../hooks/useDataRefresh";
import useAuth from "../../context/useAuth";

const PERMISSION_LABELS = {
  create_employees: "Create employees",
  edit_employees: "Edit employee details",
};

// Drops still-blank placeholder rows when switching to a role that doesn't
// require a project rate, without discarding any rate the admin already
// filled in (e.g. an HR employee who does some billable client work too).
const dropBlankProjectRates = (projectRates) =>
  projectRates.filter((assignment) => assignment.project || assignment.chargeRate !== "");

const getEmployeeInitials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "—";

function AdminEmployees() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isAdmin = ["admin", "alpha", "manager"].includes(currentUser?.role);
  const currentPermissions = currentUser?.permissions || [];
  const canCreateEmployees = isAdmin || currentPermissions.includes("create_employees");
  const canEditEmployees = isAdmin || currentPermissions.includes("edit_employees");
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEmployees, setTotalEmployees] = useState(0);

  // ADD EMPLOYEE
  const [showAddEmployee, setShowAddEmployee] = useState(
    Boolean(location.state?.openAddEmployee),
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [formData, setFormData] = useState({
    employeeId: "",
    fullName: "",
    email: "",
    password: "",
    role: "employee",
    team: "",
    projectRates: [],
  });

  // EDIT EMPLOYEE
  const [showEditEmployee, setShowEditEmployee] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [editFormData, setEditFormData] = useState({
    employeeId: "",
    fullName: "",
    email: "",
    role: "employee",
    team: "",
    isActive: true,
    projectRates: [],
  });

  // RESET PASSWORD
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordEmployee, setResetPasswordEmployee] = useState(null);
  const [resetPasswordSaving, setResetPasswordSaving] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState("");
  const [resetPasswordFormData, setResetPasswordFormData] = useState({
    password: "",
    confirmPassword: "",
  });
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // LOAD EMPLOYEES
  const fetchEmployees = useCallback(async (isCurrent = () => true, background = false) => {
    try {
      if (!background) setLoading(true);
      setError("");

      const params = { page, limit };

      if (search.trim()) {
        params.search = search.trim();
      }

      if (teamFilter) {
        params.team = teamFilter;
      }

      if (statusFilter !== "all") {
        params.isActive = statusFilter === "active" ? "true" : "false";
      }

      const data = await getEmployees(params);

      if (!isCurrent()) return;
      setEmployees(data.employees || []);
      setTotalPages(Math.max(data.totalPages || 1, 1));
      setTotalEmployees(data.totalEmployees || 0);
    } catch (requestError) {
      if (!isCurrent()) return;
      setError(
        getApiErrorMessage(
          requestError,
          "Unable to load employees."
        )
      );
    } finally {
      if (isCurrent() && !background) setLoading(false);
    }
  }, [search, teamFilter, statusFilter, page, limit]);

  useEffect(() => {
    let active = true;
    void fetchEmployees(() => active);
    return () => {
      active = false;
    };
  }, [fetchEmployees]);
  useDataRefresh(() => fetchEmployees(undefined, true));

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const response = await axiosInstance.get("/teams");
        setTeams((response.data.teams || []).filter((team) => team.isActive));
      } catch (requestError) {
        setError(getApiErrorMessage(requestError, "Unable to load teams."));
      }
    };
    void fetchTeams();
  }, []);

  useEffect(() => {
    getAllActiveProjects()
      .then(setProjects)
      .catch((requestError) => setError(getApiErrorMessage(requestError, "Unable to load projects.")));
  }, []);

  useEffect(() => {
    if (location.state?.openAddEmployee) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  // SEARCH
  const handleSearch = (event) => {
    event.preventDefault();
    setPage(1);
  };

  // DELETE
  const handleDelete = async (employeeId) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this employee?"
    );

    if (!confirmed) return;

    try {
      await axiosInstance.delete(
        `/employees/${employeeId}`
      );

      await fetchEmployees();
    } catch (requestError) {
      window.alert(
        getApiErrorMessage(
          requestError,
          "Unable to delete employee."
        )
      );
    }
  };

  // ADD FORM CHANGE
  const handleFormChange = (name, value) => {
    setFormData((previous) => {
      const updatedData = {
        ...previous,
        [name]: value,
      };

      if (name === "role" && ["admin", "hr", "manager"].includes(value)) {
        updatedData.team = "";
        updatedData.projectRates = dropBlankProjectRates(previous.projectRates);
      }

      return updatedData;
    });
  };

  // RESET ADD FORM
  const resetForm = () => {
    setFormData({
      employeeId: "",
      fullName: "",
      email: "",
      password: "",
      role: "employee",
      team: "",
      projectRates: [],
    });

    setFormError("");
  };

  // CLOSE ADD MODAL
  const closeAddEmployeeModal = () => {
    setShowAddEmployee(false);
    resetForm();
  };

  // ADD EMPLOYEE
  const handleAddEmployee = async (event) => {
    event.preventDefault();

    const validationError = validateEmployeeForm(formData, { passwordRequired: true });
    if (validationError) {
      setFormError(validationError);
      return;
    }

    try {
      setSaving(true);
      setFormError("");

      await axiosInstance.post("/auth/register", {
        employeeId: formData.employeeId.trim(),
        fullName: formData.fullName.trim(),
        email: formData.email.trim(),
        password: formData.password,
        role: formData.role,
        team: ["admin", "hr", "manager"].includes(formData.role) ? null : formData.team,
        projectRates: formData.projectRates.map((assignment) => ({
          project: assignment.project,
          chargeRate: Number(assignment.chargeRate),
        })),
      });

      closeAddEmployeeModal();

      await fetchEmployees();
    } catch (requestError) {
      setFormError(
        getApiErrorMessage(
          requestError,
          "Unable to add employee."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  // OPEN EDIT
  const openEditEmployee = (employee) => {
    setEditingEmployeeId(employee._id);

    setEditFormData({
      employeeId: employee.employeeId || "",
      fullName: employee.fullName || "",
      email: employee.email || "",
      role: employee.role || "employee",
      team: employee.team?._id || employee.team || "",
      isActive: employee.isActive ?? true,
      projectRates: employee.projectRates?.length
        ? employee.projectRates.map((assignment) => ({
            project: assignment.project?._id || assignment.project || "",
            projectName: assignment.project?.projectName || "Archived project",
            projectStatus: assignment.project?.status || "Completed",
            chargeRate: assignment.chargeRate ?? "",
          }))
        : [],
    });

    setEditError("");
    setShowEditEmployee(true);
  };

  // EDIT FORM CHANGE
  const handleEditFormChange = (name, value) => {
    setEditFormData((previous) => {
      const updatedData = {
        ...previous,
        [name]: value,
      };

      if (name === "role" && ["admin", "hr", "manager"].includes(value)) {
        updatedData.team = "";
        updatedData.projectRates = dropBlankProjectRates(previous.projectRates);
      }

      return updatedData;
    });
  };

  // CLOSE EDIT MODAL
  const closeEditEmployeeModal = () => {
    setShowEditEmployee(false);
    setEditingEmployeeId(null);
    setEditError("");
  };

  // UPDATE EMPLOYEE
  const handleUpdateEmployee = async (event) => {
    event.preventDefault();

    const validationError = validateEmployeeForm(editFormData);
    if (validationError) {
      setEditError(validationError);
      return;
    }

    try {
      setEditSaving(true);
      setEditError("");

      await axiosInstance.put(
        `/employees/${editingEmployeeId}`,
        {
          employeeId:
            editFormData.employeeId.trim(),

          fullName:
            editFormData.fullName.trim(),

          // Email, role and status are admin-only fields on the backend — the request
          // is rejected outright if a delegated (non-admin) editor sends them
          // at all, even unchanged, so they must be omitted entirely here.
          ...(isAdmin ? { email: editFormData.email.trim(), role: editFormData.role, isActive: editFormData.isActive } : {}),

          team: ["admin", "hr", "manager"].includes(editFormData.role) ? null : editFormData.team,

          projectRates: editFormData.projectRates.map((assignment) => ({
            project: assignment.project,
            chargeRate: Number(assignment.chargeRate),
          })),
        }
      );

      closeEditEmployeeModal();

      await fetchEmployees();
    } catch (requestError) {
      setEditError(
        getApiErrorMessage(
          requestError,
          "Unable to update employee."
        )
      );
    } finally {
      setEditSaving(false);
    }
  };

  // OPEN RESET PASSWORD
  const openResetPassword = (employee) => {
    setResetPasswordEmployee(employee);
    setResetPasswordFormData({ password: "", confirmPassword: "" });
    setResetPasswordError("");
    setResetPasswordSuccess("");
    setShowResetPassword(true);
  };

  // CLOSE RESET PASSWORD MODAL
  const closeResetPasswordModal = () => {
    setShowResetPassword(false);
    setResetPasswordEmployee(null);
  };

  // RESET PASSWORD FORM CHANGE
  const handleResetPasswordFormChange = (event) => {
    const { name, value } = event.target;

    setResetPasswordFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // SUBMIT RESET PASSWORD
  const handleResetPassword = async (event) => {
    event.preventDefault();

    setResetPasswordError("");
    setResetPasswordSuccess("");

    if (resetPasswordFormData.password.length < 8) {
      setResetPasswordError("Password must contain at least 8 characters.");
      return;
    }

    if (resetPasswordFormData.password !== resetPasswordFormData.confirmPassword) {
      setResetPasswordError("Passwords do not match.");
      return;
    }

    try {
      setResetPasswordSaving(true);

      await resetEmployeePassword(
        resetPasswordEmployee._id,
        resetPasswordFormData.password
      );

      setResetPasswordSuccess("Password reset successfully.");
      setResetPasswordFormData({ password: "", confirmPassword: "" });
      setTimeout(closeResetPasswordModal, 1200);
    } catch (requestError) {
      setResetPasswordError(
        getApiErrorMessage(requestError, "Unable to reset password.")
      );
    } finally {
      setResetPasswordSaving(false);
    }
  };

  return (
    <DashboardLayout title="Employees">

      {/* EMPLOYEE LIST */}
      <section className="admin-card employees-card collection-panel">
        <CollectionHeading kind="employees" title="Company directory" description="The people behind your work. Find employees, teams and account details."
          detail={`${totalEmployees} employee${totalEmployees === 1 ? '' : 's'} in this view`}>
          {canCreateEmployees && <button className="add-employee-button" type="button" onClick={() => setShowAddEmployee(true)}><UserPlus size={17} aria-hidden="true" />Add employee</button>}
        </CollectionHeading>

        {/* SEARCH AND FILTER */}
        <div className="employees-toolbar">
          <form
            className="employees-search"
            onSubmit={handleSearch}
          >
            <label className="employees-filter-field employees-search-field">
              <span>Search</span>
              <span className="employees-input-wrap">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Name, email or employee ID"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                />
              </span>
            </label>

            <button type="submit">
              Search
            </button>
          </form>

          <label className="employees-filter-field">
            <span>Team</span>
            <select
              className="employees-team-filter"
              value={teamFilter}
              onChange={(event) => { setTeamFilter(event.target.value); setPage(1); }}
            >
              <option value="">All teams</option>
              {teams.map((team) => (
                <option key={team._id} value={team._id}>
                  {team.teamName}
                </option>
              ))}
            </select>
          </label>

          <label className="employees-filter-field employees-status-field">
            <span>Status</span>
            <select
              className="employees-status-filter"
              value={statusFilter}
              onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All statuses</option>
            </select>
          </label>
        </div>

        {/* ERROR */}
        {error && (
          <p
            className="admin-error-box"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* EMPLOYEE TABLE */}
        <div className="employees-table-wrapper">
          <table className="employees-table">

            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Contact</th>
                <th scope="col">Role</th>
                <th scope="col">Team</th>
                <th scope="col">Project rates</th>
                <th scope="col">Status</th>
                <th scope="col" className="employees-actions-heading">Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="employees-table-message">
                    Loading employees...
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan="7" className="employees-table-message">
                    No employees match your filters. Try a different search or add an employee.
                  </td>
                </tr>
              ) : (
                employees.map((employee) => (
                  <tr key={employee._id}>

                    <td data-label="Employee">
                      <div className="employee-identity">
                        <span className="employee-list-avatar" aria-hidden="true">
                          {getEmployeeInitials(employee.fullName)}
                        </span>
                        <span>
                          <strong>{employee.fullName || "Unnamed employee"}</strong>
                          <small>ID {employee.employeeId || "—"}</small>
                        </span>
                      </div>
                    </td>

                    <td data-label="Contact">
                      {employee.email ? (
                        <a className="employee-email" href={`mailto:${employee.email}`}>
                          {employee.email}
                        </a>
                      ) : "—"}
                    </td>

                    <td data-label="Role">
                      <span className="employee-role-badge">
                        {employee.role?.replaceAll("_", " ") || "—"}
                      </span>
                      {employee.permissions?.length > 0 && (
                        <div className="employee-permission-badges">
                          {employee.permissions.map((key) => (
                            <span key={key} className="employee-permission-badge">
                              {PERMISSION_LABELS[key] || key}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td data-label="Team">{employee.team?.teamName ? <TeamIdentity name={employee.team.teamName} /> : '—'}</td>

                    <td data-label="Project rates">
                      {employee.projectRates?.length
                        ? <div className="employee-rate-list">
                            {employee.projectRates.map((assignment, index) => (
                              <span key={`${assignment.project?._id || "archived"}-${index}`}>
                                {assignment.project?.projectName || "Archived project"}
                                <strong>${Number(assignment.chargeRate).toFixed(2)}/hr</strong>
                              </span>
                            ))}
                          </div>
                        : <span className="employee-not-configured">Not configured</span>}
                    </td>

                    <td data-label="Status">
                      <span
                        className={
                          employee.isActive
                            ? "employee-status active"
                            : "employee-status inactive"
                        }
                      >
                        {employee.isActive
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    <td data-label="Actions">
                      <div className="employee-actions">

                        {canEditEmployees && employee.role !== "alpha" && (
                          <button
                            className="edit-action-button"
                            type="button"
                            onClick={() =>
                              openEditEmployee(employee)
                            }
                          >
                            <Pencil size={15} aria-hidden="true" />
                            Edit
                          </button>
                        )}

                        {isAdmin && employee.role !== "alpha" && (
                          <button
                            className="edit-action-button"
                            type="button"
                            onClick={() =>
                              openResetPassword(employee)
                            }
                          >
                            <KeyRound size={15} aria-hidden="true" />
                            Reset
                          </button>
                        )}

                        {isAdmin && employee.role !== "alpha" && (
                          <button
                            className="delete-action-button"
                            type="button"
                            onClick={() =>
                              handleDelete(employee._id)
                            }
                          >
                            <Trash2 size={15} aria-hidden="true" />
                            Delete
                          </button>
                        )}

                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="employees-pagination" aria-label="Employee table pagination">
          <div className="employees-page-size">
            <span>{totalEmployees} employee{totalEmployees === 1 ? "" : "s"}</span>
            <label htmlFor="employee-page-size">Show</label>
            <select
              id="employee-page-size"
              value={limit}
              onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
            <span>per page</span>
          </div>

          <div className="employees-page-controls">
            <span>Page {page} of {totalPages}</span>
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
              <ChevronLeft size={15} aria-hidden="true" />
              Previous
            </button>
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
              Next
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>


      {/* =========================
          ADD EMPLOYEE MODAL
      ========================== */}

      {showAddEmployee && (
        <ModalFrame onClose={closeAddEmployeeModal} label="Add employee">

          <div className="employee-modal employee-editor-modal">

            <div className="employee-modal-header">

              <div>
                <p className="admin-eyebrow">
                  EMPLOYEE MANAGEMENT
                </p>

                <h2>Add Employee</h2>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeAddEmployeeModal}
              >
                ×
              </button>

            </div>

            <EmployeeForm
              mode="create"
              formData={formData}
              teams={teams}
              projects={projects}
              saving={saving}
              error={formError}
              isAdmin={isAdmin}
              projectRatesRequired={projectRatesRequiredForRole(formData.role)}
              onFieldChange={handleFormChange}
              onSubmit={handleAddEmployee}
              onCancel={closeAddEmployeeModal}
            />

          </div>
        </ModalFrame>
      )}


      {/* =========================
          EDIT EMPLOYEE MODAL
      ========================== */}

      {showEditEmployee && (
        <ModalFrame onClose={closeEditEmployeeModal} label="Edit employee">

          <div className="employee-modal employee-editor-modal">

            <div className="employee-modal-header">

              <div>
                <p className="admin-eyebrow">
                  EMPLOYEE MANAGEMENT
                </p>

                <h2>Edit Employee</h2>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeEditEmployeeModal}
              >
                ×
              </button>

            </div>

            <EmployeeForm
              mode="edit"
              formData={editFormData}
              teams={teams}
              projects={projects}
              saving={editSaving}
              error={editError}
              isAdmin={isAdmin}
              projectRatesRequired={projectRatesRequiredForRole(editFormData.role)}
              onFieldChange={handleEditFormChange}
              onSubmit={handleUpdateEmployee}
              onCancel={closeEditEmployeeModal}
            />

          </div>
        </ModalFrame>
      )}


      {/* =========================
          RESET PASSWORD MODAL
      ========================== */}

      {showResetPassword && (
        <ModalFrame onClose={closeResetPasswordModal} label="Reset employee password">

          <div className="employee-modal password-reset-modal">

            <div className="employee-modal-header">

              <div className="password-field-group">
                <p className="admin-eyebrow">
                  EMPLOYEE MANAGEMENT
                </p>

                <h2>
                  Reset Password
                  {resetPasswordEmployee?.fullName
                    ? ` — ${resetPasswordEmployee.fullName}`
                    : ""}
                </h2>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeResetPasswordModal}
              >
                ×
              </button>

            </div>

            {resetPasswordError && (
              <div
                className="admin-error-box"
                role="alert"
              >
                {resetPasswordError}
              </div>
            )}

            {resetPasswordSuccess && (
              <div className="profile-success-box">
                {resetPasswordSuccess}
              </div>
            )}

            <form
              className="employee-form"
              onSubmit={handleResetPassword}
            >

              <div className="password-field-group">
                <label htmlFor="resetPassword">
                  New Password
                </label>

                <div className="password-input-wrap"><input
                  id="resetPassword"
                  name="password"
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Enter new password"
                  value={resetPasswordFormData.password}
                  onChange={handleResetPasswordFormChange}
                  autoComplete="new-password"
                /><button type="button" className="password-visibility" onClick={() => setShowNewPassword((value) => !value)} aria-label={showNewPassword ? "Hide new password" : "Show new password"}>{showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              </div>

              <div className="password-field-group">
                <label htmlFor="resetConfirmPassword">
                  Confirm New Password
                </label>

                <div className="password-input-wrap"><input
                  id="resetConfirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm new password"
                  value={resetPasswordFormData.confirmPassword}
                  onChange={handleResetPasswordFormChange}
                  autoComplete="new-password"
                /><button type="button" className="password-visibility" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}>{showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              </div>

              <div className="employee-form-actions">

                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeResetPasswordModal}
                  disabled={resetPasswordSaving}
                >
                  Close
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={resetPasswordSaving}
                >
                  {resetPasswordSaving
                    ? "Saving..."
                    : "Reset Password"}
                </button>

              </div>

            </form>

          </div>
        </ModalFrame>
      )}

    </DashboardLayout>
  );
}

export default AdminEmployees;
