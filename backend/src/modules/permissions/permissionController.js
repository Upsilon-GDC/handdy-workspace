const mongoose = require("mongoose");
const Employee = require("../../models/Employee");
const RolePermission = require("../../models/RolePermission");
const {
  ALL_PERMISSION_KEYS,
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATEGORIES,
  isConfigurableRole,
  normalizePermissionList,
} = require("../../utils/permissions");
const {
  getEffectivePermissionsSync,
  getRolePermissionsSync,
  setRoleOverride,
} = require("../../services/permissionService");
const sendErrorResponse = require("../../utils/sendErrorResponse");

const ROLE_LABELS = { hr: "HR", team_lead: "Team Lead", employee: "Employee" };

// Any signed-in user: the keys the UI may use to show/hide controls. The
// backend still enforces every action independently.
const getMyPermissions = async (req, res) => {
  try {
    return res.status(200).json({ success: true, permissions: getEffectivePermissionsSync(req.user) });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to load your permissions.");
  }
};

const getPermissionConfig = async (req, res) => {
  try {
    const rows = await RolePermission.find({}).select("role updatedAt").lean();
    const customized = new Map(rows.map((row) => [row.role, row.updatedAt]));
    const roles = CONFIGURABLE_ROLES.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      permissions: getRolePermissionsSync(role),
      defaults: DEFAULT_ROLE_PERMISSIONS[role] || [],
      customizedAt: customized.get(role) || null,
    }));
    return res.status(200).json({
      success: true,
      categories: PERMISSION_CATEGORIES,
      roles,
      fixedRoles: ["alpha", "admin", "manager"],
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to load permissions.");
  }
};

const updateRolePermissions = async (req, res) => {
  try {
    const { role } = req.params;
    if (!isConfigurableRole(role)) {
      return res.status(400).json({
        success: false,
        message: "Administrator-level roles always have full access and cannot be edited.",
      });
    }
    const { permissions, invalid } = normalizePermissionList(req.body?.permissions, role);
    if (!permissions) {
      return res.status(400).json({
        success: false,
        message: invalid === "not-a-list" ? "Permissions must be provided as a list." : `Invalid permission: ${invalid}.`,
      });
    }

    const before = getRolePermissionsSync(role);
    await RolePermission.findOneAndUpdate(
      { role },
      { $set: { permissions, updatedBy: req.user._id } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    setRoleOverride(role, permissions);

    // Audit trail: who changed which role and exactly what was added/removed.
    console.info("[permissions] role updated", JSON.stringify({
      role,
      by: String(req.user._id),
      added: permissions.filter((key) => !before.includes(key)),
      removed: before.filter((key) => !permissions.includes(key)),
    }));

    return res.status(200).json({
      success: true,
      message: "Permissions saved.",
      role: { role, label: ROLE_LABELS[role], permissions, defaults: DEFAULT_ROLE_PERMISSIONS[role] || [] },
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to save permissions.");
  }
};

// ------------------------------------------------ per-employee exceptions

const PERSON_FIELDS = "employeeId fullName email role team isActive permissions"
  + " +permissionOverrides.granted +permissionOverrides.revoked";

// Keys no longer in the catalog (e.g. "assign_tasks", folded into
// "create_tasks") are left out, so the page never sends them back.
const currentKeys = (keys) => (keys || []).filter((key) => ALL_PERMISSION_KEYS.includes(key));

const describePerson = (employee) => ({
  id: String(employee._id),
  employeeId: employee.employeeId || "",
  fullName: employee.fullName || employee.email || "",
  email: employee.email || "",
  role: employee.role,
  team: employee.team?.name || "",
  granted: currentKeys(employee.permissionOverrides?.granted),
  revoked: currentKeys(employee.permissionOverrides?.revoked),
  permissions: getEffectivePermissionsSync(employee),
});

// Active employees whose access can be adjusted (configurable roles only;
// admin-level roles always have full access).
const listEmployeePermissions = async (req, res) => {
  try {
    const employees = await Employee.find({ isActive: true, role: { $in: CONFIGURABLE_ROLES } })
      .select(PERSON_FIELDS)
      .populate("team", "name")
      .sort({ fullName: 1 })
      .lean();
    return res.status(200).json({ success: true, employees: employees.map(describePerson) });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to load employees.");
  }
};

// Body: { granted: [...], revoked: [...] } - the person's complete set of
// exceptions; anything not listed follows the role again.
const updateEmployeePermissions = async (req, res) => {
  try {
    const { employeeId } = req.params;
    if (!mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee ID." });
    }
    const employee = await Employee.findById(employeeId).select(PERSON_FIELDS).populate("team", "name").lean();
    if (!employee || employee.isActive === false) {
      return res.status(404).json({ success: false, message: "Employee not found." });
    }
    if (!isConfigurableRole(employee.role)) {
      return res.status(400).json({
        success: false,
        message: "Administrator-level roles always have full access and cannot be edited.",
      });
    }

    const lists = {};
    for (const name of ["granted", "revoked"]) {
      const { permissions, invalid } = normalizePermissionList(req.body?.[name] ?? [], employee.role);
      if (!permissions) {
        return res.status(400).json({
          success: false,
          message: invalid === "not-a-list" ? "Permissions must be provided as a list." : `Invalid permission: ${invalid}.`,
        });
      }
      lists[name] = permissions;
    }
    const both = lists.granted.find((key) => lists.revoked.includes(key));
    if (both) {
      return res.status(400).json({ success: false, message: `A permission cannot be both on and off: ${both}.` });
    }

    const before = getEffectivePermissionsSync(employee);
    await Employee.updateOne({ _id: employee._id }, {
      $set: {
        "permissionOverrides.granted": lists.granted,
        "permissionOverrides.revoked": lists.revoked,
        "permissionOverrides.updatedBy": req.user._id,
        "permissionOverrides.updatedAt": new Date(),
      },
    });
    const person = describePerson({ ...employee, permissionOverrides: lists });

    // Audit trail, like role changes: who changed whose access and how.
    console.info("[permissions] employee updated", JSON.stringify({
      employee: person.id,
      role: employee.role,
      by: String(req.user._id),
      added: person.permissions.filter((key) => !before.includes(key)),
      removed: before.filter((key) => !person.permissions.includes(key)),
    }));

    return res.status(200).json({ success: true, message: "Permissions saved.", employee: person });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to save permissions.");
  }
};

module.exports = {
  getMyPermissions,
  getPermissionConfig,
  listEmployeePermissions,
  updateEmployeePermissions,
  updateRolePermissions,
};
