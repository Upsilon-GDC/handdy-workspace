const express = require("express");

const {
  getAllEmployees,
  getEmployeeOptions,
  getMyTeam,
  getMyTeamMemberById,
  getEmployeeById,
  updateEmployee,
  updateEmployeePermissions,
  resetEmployeePassword,
  assignTeamLead,
  deleteEmployee,
} = require("./employeeController");

const { protect } = require("../../middleware/authMiddleware");
const { authorizeRoles, authorizeAccess, authorizeRolesOrPermissions } = require("../../middleware/authorizeRoles");

const router = express.Router();

// Operational selectors need identity/team data, not account administration:
// employee filters on company reports and team-lead choices on Teams.
router.get(
  "/options",
  protect,
  authorizeRolesOrPermissions({ roles: ["hr"], permissions: [
    "create_employees", "edit_employees", "view_all_reports", "create_teams", "edit_teams", "assign_team_leads",
  ] }),
  getEmployeeOptions
);

// Admin, or anyone granted create_employees/edit_employees - get all employees
router.get(
  "/",
  protect,
  authorizeAccess("create_employees", "edit_employees"),
  getAllEmployees
);

// Own team (task assignment, team reports): team leads, or anyone given a
// team duty. Non-leads get names only (see getMyTeam).
const TEAM_MEMBERS = authorizeRolesOrPermissions({ roles: ["team_lead"], permissions: ["view_team_timesheets", "create_tasks", "edit_tasks", "reassign_tasks", "add_manual_entries"] });

router.get(
  "/my-team",
  protect,
  TEAM_MEMBERS,
  getMyTeam
);

router.get(
  "/my-team/:id",
  protect,
  TEAM_MEMBERS,
  getMyTeamMemberById
);

// Admin - assign or remove Team Lead for an employee
router.put(
  "/:id/team-lead",
  protect,
  authorizeRoles("admin"),
  assignTeamLead
);

// Admin, or anyone granted create_employees/edit_employees - get employee by ID
router.get(
  "/:id",
  protect,
  authorizeAccess("create_employees", "edit_employees"),
  getEmployeeById
);

// Admin, or anyone granted edit_employees - update employee
router.put(
  "/:id",
  protect,
  authorizeAccess("edit_employees"),
  updateEmployee
);

// Admin - grant or revoke a delegated employee's permissions
router.put(
  "/:id/permissions",
  protect,
  authorizeRoles("admin"),
  updateEmployeePermissions
);

// Admin - reset an employee's password
router.put(
  "/:id/reset-password",
  protect,
  authorizeRoles("admin"),
  resetEmployeePassword
);

// Admin - delete employee
router.delete(
  "/:id",
  protect,
  authorizeRoles("admin"),
  deleteEmployee
);

module.exports = router;
