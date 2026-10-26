const mongoose = require("mongoose");
const RolePermission = require("../models/RolePermission");
const { isAdminRole } = require("../utils/roles");
const {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  isConfigurableRole,
  permissionAppliesToRole,
} = require("../utils/permissions");

// Role grants change rarely, so permission checks read an in-memory snapshot
// instead of querying MongoDB on every guarded request. The snapshot is loaded
// at startup, replaced immediately when an administrator saves a role, and
// refreshed in the background at most every REFRESH_INTERVAL_MS so other
// server instances converge. Until a snapshot exists the built-in defaults
// apply, which mirror the access the routes granted before this feature.
const REFRESH_INTERVAL_MS = 30_000;
let overrides = new Map();
let lastRefreshAt = 0;
let refreshing = null;

const clearPermissionCache = () => { lastRefreshAt = 0; };

function setRoleOverride(role, permissions) {
  overrides = new Map(overrides).set(role, [...permissions]);
}

async function refreshPermissionOverrides() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const rows = await RolePermission.find({}).select("role permissions").lean();
      overrides = new Map(rows.map((row) => [row.role, row.permissions || []]));
      lastRefreshAt = Date.now();
    } catch (error) {
      // Keep serving the last known grants; never fail a request over this.
      console.error("Unable to refresh role permissions:", error.message);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function refreshIfStale() {
  if (Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  if (mongoose.connection.readyState !== 1) return;
  void refreshPermissionOverrides();
}

function getRolePermissionsSync(role) {
  if (isAdminRole(role)) return [...ALL_PERMISSION_KEYS];
  if (!isConfigurableRole(role)) return [];
  refreshIfStale();
  const granted = overrides.has(role) ? overrides.get(role) : DEFAULT_ROLE_PERMISSIONS[role] || [];
  return granted.filter((key) => permissionAppliesToRole(key, role));
}

// Effective permissions = role grants, adjusted by the person's own
// exceptions (Employee.permissionOverrides), + the older per-employee
// delegations (create_employees / edit_employees), which are left untouched.
// A personal grant only counts where the permission can apply to the person's
// role, and admin-level roles keep everything.
function getEffectivePermissionsSync(user) {
  if (!user) return [];
  const effective = new Set(getRolePermissionsSync(user.role));
  if (isConfigurableRole(user.role)) {
    const { granted, revoked } = user.permissionOverrides || {};
    for (const key of granted || []) {
      if (permissionAppliesToRole(key, user.role)) effective.add(key);
    }
    for (const key of revoked || []) effective.delete(key);
  }
  for (const key of user.permissions || []) effective.add(key);
  return [...effective];
}

function userHasPermission(user, ...keys) {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  const effective = getEffectivePermissionsSync(user);
  return keys.some((key) => effective.includes(key));
}

module.exports = {
  clearPermissionCache,
  getEffectivePermissionsSync,
  getRolePermissionsSync,
  refreshPermissionOverrides,
  setRoleOverride,
  userHasPermission,
};
