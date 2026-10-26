const express = require("express");

const {
  getIdlePolicy,
  updateIdlePolicy,
  getEmployeeIdlePolicies,
  updateEmployeeIdlePolicy,
} = require("./settingsController");
const { protect } = require("../../middleware/authMiddleware");
const { authorizeRoles } = require("../../middleware/authorizeRoles");

const router = express.Router();

router.get("/idle-policy", protect, getIdlePolicy);
router.put(
  "/idle-policy",
  protect,
  authorizeRoles("admin"),
  updateIdlePolicy
);
router.get(
  "/employee-idle-policies",
  protect,
  authorizeRoles("alpha"),
  getEmployeeIdlePolicies
);
router.put(
  "/employee-idle-policies/:employeeId",
  protect,
  authorizeRoles("alpha"),
  updateEmployeeIdlePolicy
);

module.exports = router;
