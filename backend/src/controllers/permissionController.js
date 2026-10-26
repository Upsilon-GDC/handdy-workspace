const RolePermission = require("../models/RolePermission");
const {
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATEGORIES,
  isConfigurableRole,
  normalizePermissionList,
} = require("../utils/permissions");
const {
  getEffectivePermissionsSync,
  getRolePermissionsSync,
  setRoleOverride,
} = require("../services/permissionService");
const sendErrorResponse = require("../utils/sendErrorResponse");

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

module.exports = { getMyPermissions, getPermissionConfig, updateRolePermissions };
