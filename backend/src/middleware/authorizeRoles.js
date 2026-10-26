const { isAdminRole } = require("../utils/roles");
const { userHasPermission } = require("../services/permissionService");

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    const allowed = allowedRoles.includes(req.user.role)
      || (isAdminRole(req.user.role) && allowedRoles.includes("admin"));
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
    }

    next();
  };
};

// Admin-level roles always pass. Anyone else needs at least one of the named
// permissions explicitly granted on their employee record (see
// Employee.permissions). Used for actions an admin can delegate to a
// specific non-admin user.
const authorizeAccess = (...permissionKeys) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    const granted = req.user.permissions || [];
    if (isAdminRole(req.user.role) || permissionKeys.some((key) => granted.includes(key))) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "You do not have permission to access this resource.",
    });
  };
};

// Role-configurable permission gate (see utils/permissions.js). Admin-level
// roles always pass; other roles need one of the named permissions in their
// saved role configuration (or the built-in default that matches the roles the
// route used to hard-code).
const requirePermission = (...permissionKeys) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication is required." });
  }
  if (userHasPermission(req.user, ...permissionKeys)) return next();
  return res.status(403).json({
    success: false,
    message: "You do not have permission to access this resource.",
  });
};

module.exports = {
  authorizeRoles,
  authorizeAccess,
  requirePermission,
  // Passes the listed roles, or anyone holding one of the permissions (role
  // grants, personal exceptions or the older per-employee delegations).
  authorizeRolesOrPermissions: ({ roles = [], permissions = [] }) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication is required." });
    if (isAdminRole(req.user.role) || roles.includes(req.user.role)
        || (permissions.length > 0 && userHasPermission(req.user, ...permissions))) return next();
    return res.status(403).json({ success: false, message: "You do not have permission to access this resource." });
  },
};
