const express = require("express");
const { protect } = require("../../middleware/authMiddleware");
const {
  getMyPermissions,
  getPermissionConfig,
  listEmployeePermissions,
  updateEmployeePermissions,
  updateRolePermissions,
} = require("./permissionController");

const router = express.Router();

// Admin, alpha and manager decide who may do what (managers since
// 2026-10-26). HR, team leads and employees cannot change permissions.
const adminOnly = (req, res, next) =>
  ["admin", "alpha", "manager"].includes(req.user?.role)
    ? next()
    : res.status(403).json({ success: false, message: "Only an administrator or manager can manage permissions." });

router.get("/me", protect, getMyPermissions);
router.get("/", protect, adminOnly, getPermissionConfig);
router.put("/roles/:role", protect, adminOnly, updateRolePermissions);
router.get("/employees", protect, adminOnly, listEmployeePermissions);
router.put("/employees/:employeeId", protect, adminOnly, updateEmployeePermissions);

module.exports = router;
