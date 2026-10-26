const Employee = require("../../models/Employee");
const { escapeRegExp, getPagination } = require("../../utils/requestUtils");
const Team = require("../../models/Team");
const { syncEmployeeTeam, clearTeamsLedBy } = require("../../services/teamAssignmentService");
const { validateProjectRates, projectRatesRequiredForRole } = require("../../services/projectRateService");
const sendErrorResponse = require("../../utils/sendErrorResponse");
const { revokeEmployeeSessions } = require("../../services/authSessionService");
const generateToken = require("../../utils/generateToken");
const { isAdminRole, isAlphaRole } = require("../../utils/roles");
const { teamMemberFilter } = require("../../services/teamScope");

// What someone who is not the team's lead sees about teammates (task
// assignment, team reports): no rates, contact or account details.
const TEAMMATE_FIELDS = "employeeId fullName role team isActive";

const populateEmployeeRates = (query) => query.populate(
  "projectRates.project",
  "projectCode projectName status",
);

// A user acting only on the delegated "edit_employees" permission (not a
// true admin) can update basic details, team, and project rates, but can
// never touch these — that boundary is what keeps the permission from
// becoming a privilege-escalation or account-takeover path.
const FIELDS_RESTRICTED_TO_ADMIN = ["email", "role", "isActive", "password", "permissions"];

const alphaAccountIsProtected = (_actor, target) => isAlphaRole(target?.role);

const rejectProtectedAlphaMutation = (res, actor, target) => {
  if (!alphaAccountIsProtected(actor, target)) return false;
  res.status(403).json({
    success: false,
    message: "Alpha accounts can only be managed from the server terminal.",
  });
  return true;
};

const handleEmployeeError = (res, error) => {
  console.error("Employee controller error:", error);
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "Employee ID or email already exists.",
    });
  }
  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({ success: false, message: "Invalid employee data." });
  }
  if (error.statusCode >= 400 && error.statusCode < 500) return res.status(error.statusCode).json({ success: false, message: error.message });
  return res.status(500).json({
    success: false,
    message: "Unable to process the employee request.",
  });
};

// Get all employees
const getAllEmployees = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const search = req.query.search || "";
    const role = req.query.role || ""
    const department = req.query.department || "";
    const team = req.query.team || "";
    const isActive = req.query.isActive; // This can be 'true', 'false', or undefined
    const allowedSorts = new Set([
      "createdAt", "-createdAt", "fullName", "-fullName",
      "employeeId", "-employeeId", "email", "-email",
    ]);
    const sort = allowedSorts.has(req.query.sort)
      ? req.query.sort
      : "-createdAt";


    const filter = {};
    if (search) {
      const safeSearch = escapeRegExp(search);
      filter.$or = [
        { employeeId: { $regex: safeSearch, $options: "i" } },
        { fullName: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
        { role: { $regex: safeSearch, $options: "i" } },
        { department: { $regex: safeSearch, $options: "i" } },
        { designation: { $regex: safeSearch, $options: "i" } },
      ];
    }
    if (role) {
      filter.role = role;
    }

    if (department) {
      filter.department = department;
    }
    if (team) {
      filter.team = team;
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }
    const totalEmployees = await Employee.countDocuments(filter);

    const employees = await populateEmployeeRates(Employee.find(filter)
      .select("-password")
      .populate("team", "teamName isActive")
      .populate("teamLead", "employeeId fullName")
      .sort(sort)
      .skip(skip)
      .limit(limit));

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(totalEmployees / limit),
      count: employees.length,
      employees,
      totalEmployees,
    });
  } catch (error) {
    return handleEmployeeError(res, error);
  }
};
// Minimal, paginated identities for reports, task assignment and scheduling.
const getEmployeeOptions = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.team) filter.team = req.query.team;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === "true";
    const totalEmployees = await Employee.countDocuments(filter);
    const employees = await Employee.find(filter)
      .select("employeeId fullName email role department designation team teamLead isActive")
      .populate("team", "teamName isActive")
      .sort("fullName")
      .skip(skip)
      .limit(limit);
    return res.status(200).json({ success: true, page, limit,
      totalPages: Math.ceil(totalEmployees / limit), count: employees.length, totalEmployees, employees });
  } catch (error) {
    return handleEmployeeError(res, error);
  }
};
// Get one employee by MongoDB ID
const getEmployeeById = async (req, res) => {
  try {
    const employee = await populateEmployeeRates(Employee.findById(req.params.id).select("-password")
      .populate("team", "teamName isActive")
      .populate("teamLead", "employeeId fullName"));

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found.",
      });
    }

    return res.status(200).json({
      success: true,
      employee,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch employee.");
  }
};
// Update employee
const updateEmployee = async (req, res) => {
  try {
  
    const employee = await Employee.findById(req.params.id).select("+tokenVersion +rememberedSessionTokenHash +rememberedSessionExpires +rememberedSessions");

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found.",
      });
    }

    if (rejectProtectedAlphaMutation(res, req.user, employee)) return;

    if (!isAdminRole(req.user.role)) {
      const restrictedField = FIELDS_RESTRICTED_TO_ADMIN.find((field) => req.body[field] !== undefined);
      if (restrictedField) {
        return res.status(403).json({
          success: false,
          message: "Only an administrator can change email, role, status, password, or permissions.",
        });
      }
    }

    if (req.body.role === "alpha" || (employee.role === "alpha" && req.body.role && req.body.role !== "alpha")) {
      return res.status(403).json({ success: false, message: "Alpha role assignment is terminal-only." });
    }

    const allowedFields = [
      "employeeId", "fullName", "email", "role", "department",
      "designation", "companyName", "address1", "address2", "city",
      "state", "postalCode", "country", "phoneNumber", "isActive",
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) employee[field] = req.body[field];
    }

    if (req.body.projectRates !== undefined) {
      const existingProjectIds = employee.projectRates.map((assignment) => assignment.project);
      employee.projectRates = await validateProjectRates(req.body.projectRates, {
        existingProjectIds,
        required: projectRatesRequiredForRole(employee.role),
      });
    }

    if (req.body.password !== undefined) {
      if (typeof req.body.password !== "string" || req.body.password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "Password must contain at least 8 characters.",
        });
      }
      employee.password = req.body.password;
      employee.tokenVersion = (employee.tokenVersion || 0) + 1;
      employee.rememberedSessionTokenHash = null;
      employee.rememberedSessionExpires = null;
      employee.rememberedSessions = [];
    }

    if (req.body.isActive === false) {
      employee.rememberedSessionTokenHash = null;
      employee.rememberedSessionExpires = null;
      employee.rememberedSessions = [];
    }

    const requestedTeam = req.body.team !== undefined ? req.body.team : employee.team;
    await syncEmployeeTeam(employee, requestedTeam);

    // Changing your own password (or deactivating your own account, though
    // deleteEmployee already blocks self-deactivation there) bumps
    // tokenVersion, which invalidates every outstanding token — including
    // the one the admin is using right now. For a self password change,
    // exclude the acting session from the revocation and hand back a fresh
    // token in the response, mirroring authController.changePassword, so
    // the admin isn't logged out mid-session.
    const isSelfAccount = employee._id.equals(req.user._id);
    let freshToken;
    if (req.body.password !== undefined) {
      if (isSelfAccount) {
        await revokeEmployeeSessions(employee._id, "admin_password_reset", { excludeSessionId: req.authSession._id });
        freshToken = generateToken(employee._id, employee.tokenVersion, req.authSession);
      } else {
        await revokeEmployeeSessions(employee._id, "admin_password_reset");
      }
    }
    if (req.body.isActive === false) {
      await revokeEmployeeSessions(employee._id, "account_deactivated");
    }
    const updatedEmployee = await populateEmployeeRates(Employee.findById(employee._id)
      .populate("team", "teamName isActive")
      .populate("teamLead", "employeeId fullName"));

    return res.status(200).json({
      success: true,
      message: "Employee updated successfully.",
      employee: updatedEmployee,
      ...(freshToken ? { token: freshToken } : {}),
    });
  } catch (error) {
    return handleEmployeeError(res, error);
  }
};
// Admin - grant or revoke a delegated employee's permissions
const ASSIGNABLE_PERMISSIONS = new Set(["create_employees", "edit_employees"]);
const updateEmployeePermissions = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found.",
      });
    }

    if (rejectProtectedAlphaMutation(res, req.user, employee)) return;

    if (isAdminRole(employee.role)) {
      return res.status(400).json({
        success: false,
        message: "Administrators already have full access.",
      });
    }

    const requested = req.body.permissions;
    if (!Array.isArray(requested)) {
      return res.status(400).json({
        success: false,
        message: "Permissions must be provided as a list.",
      });
    }

    const invalid = requested.find((key) => !ASSIGNABLE_PERMISSIONS.has(key));
    if (invalid) {
      return res.status(400).json({
        success: false,
        message: `Invalid permission: ${invalid}.`,
      });
    }

    employee.permissions = [...new Set(requested)];
    await employee.save();

    return res.status(200).json({
      success: true,
      message: "Permissions updated successfully.",
      permissions: employee.permissions,
    });
  } catch (error) {
    return handleEmployeeError(res, error);
  }
};
// Admin - reset an employee's password directly
const resetEmployeePassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters.",
      });
    }

    const employee = await Employee.findById(req.params.id).select("+tokenVersion +rememberedSessionTokenHash +rememberedSessionExpires +rememberedSessions");

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found.",
      });
    }

    if (rejectProtectedAlphaMutation(res, req.user, employee)) return;

    employee.password = password;
    employee.tokenVersion = (employee.tokenVersion || 0) + 1;
    employee.rememberedSessionTokenHash = null;
    employee.rememberedSessionExpires = null;
    employee.rememberedSessions = [];
    await employee.save();

    // Same self-account guard as updateEmployee above: don't strand the
    // admin's own session when they reset their own password this way.
    const isSelfAccount = employee._id.equals(req.user._id);
    let freshToken;
    if (isSelfAccount) {
      await revokeEmployeeSessions(employee._id, "admin_password_reset", { excludeSessionId: req.authSession._id });
      freshToken = generateToken(employee._id, employee.tokenVersion, req.authSession);
    } else {
      await revokeEmployeeSessions(employee._id, "admin_password_reset");
    }

    return res.status(200).json({
      success: true,
      message: "Password reset successfully.",
      ...(freshToken ? { token: freshToken } : {}),
    });
  } catch (error) {
    return handleEmployeeError(res, error);
  }
};
// Admin - assign or remove a Team Lead for an employee
const assignTeamLead = async (req, res) => {
  try {
    const employeeId = req.params.id;
    const { teamLeadId } = req.body;

    const employee = await Employee.findById(employeeId);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found.",
      });
    }

    if (rejectProtectedAlphaMutation(res, req.user, employee)) return;

    // Remove Team Lead assignment
    if (!teamLeadId) {
      await clearTeamsLedBy(employee._id);
      employee.teamLead = null;
      employee.team = null;
      await employee.save();

      return res.status(200).json({
        success: true,
        message: "Team Lead assignment removed successfully.",
        employee,
      });
    }

    const teamLead = await Employee.findOne({
      _id: teamLeadId,
      role: "team_lead",
      isActive: true,
    });

    if (!teamLead) {
      return res.status(400).json({
        success: false,
        message: "Selected Team Lead is invalid or inactive.",
      });
    }

    if (employee._id.toString() === teamLead._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "An employee cannot be assigned as their own Team Lead.",
      });
    }

    // Clear any team this employee currently leads before moving them under
    // a different lead, so the old team isn't left pointing at a stale lead.
    await clearTeamsLedBy(employee._id);
    employee.teamLead = teamLead._id;
    const leadTeam = await Team.findOne({ teamLead: teamLead._id, isActive: true });
    employee.team = leadTeam?._id || null;
    await employee.save();

    return res.status(200).json({
      success: true,
      message: "Team Lead assigned successfully.",
      employee,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to assign Team Lead.");
  }
};
// Deactivate an employee instead of deleting linked historical records.
const deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id).select("+tokenVersion +rememberedSessionTokenHash +rememberedSessionExpires +rememberedSessions");

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found.",
      });
    }

    if (rejectProtectedAlphaMutation(res, req.user, employee)) return;

    if (employee._id.equals(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account.",
      });
    }

    employee.isActive = false;
    employee.teamLead = null;
    employee.team = null;
    employee.tokenVersion = (employee.tokenVersion || 0) + 1;
    employee.rememberedSessionTokenHash = null;
    employee.rememberedSessionExpires = null;
    employee.rememberedSessions = [];
    await employee.save();
    await revokeEmployeeSessions(employee._id, "account_deactivated");

    await Employee.updateMany(
      { teamLead: employee._id },
      { $set: { teamLead: null } }
    );
    await Team.updateMany(
      { teamLead: employee._id },
      { $set: { teamLead: null } }
    );

    return res.status(200).json({
      success: true,
      message: "Employee deactivated successfully.",
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to deactivate employee.");
  }
};
// The signed-in person's team: a team lead's assigned employees (full
// profile, as before), or for anyone else with a team duty the employees of
// their own team (names only).
const getMyTeam = async (req, res) => {
  try {
    const isLead = req.user.role === "team_lead";
    const { page, limit, skip } = getPagination(req.query);

    const filter = await teamMemberFilter(req.user);

    const totalEmployees = await Employee.countDocuments(filter);

    const query = Employee.find(filter)
      .select(isLead ? "-password" : TEAMMATE_FIELDS)
      .populate("team", "teamName")
      .sort("fullName")
      .skip(skip)
      .limit(limit);
    const employees = isLead ? await populateEmployeeRates(query) : await query.lean();

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(totalEmployees / limit),
      count: employees.length,
      employees,
      totalEmployees,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch your team.");
  }
};
// One member of the signed-in person's team (same scope and fields as getMyTeam).
const getMyTeamMemberById = async (req, res) => {
  try {
    const isLead = req.user.role === "team_lead";
    const query = Employee.findOne({ ...await teamMemberFilter(req.user), _id: req.params.id })
      .select(isLead ? "-password" : TEAMMATE_FIELDS);
    const employee = isLead ? await populateEmployeeRates(query) : await query.populate("team", "teamName").lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Team member not found or not assigned to you.",
      });
    }

    return res.status(200).json({
      success: true,
      employee,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch team member.");
  }
};
module.exports = {
  getAllEmployees,
  getEmployeeOptions,
  getMyTeam,
  getMyTeamMemberById,
  getEmployeeById,
  updateEmployee,
  updateEmployeePermissions,
  resetEmployeePassword,
  deleteEmployee,
  assignTeamLead,
};
