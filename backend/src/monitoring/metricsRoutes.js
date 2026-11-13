const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authorizeRoles");
const trafficMetrics = require("./trafficMetrics");

const router = express.Router();

// Admin-level only: traffic counters since the server started and for the
// current 10-minute window (see trafficMetrics.js).
router.get("/", protect, authorizeRoles("admin"), (req, res) => {
  if (!trafficMetrics.enabled) {
    return res.status(404).json({ success: false, message: "Traffic metrics are off. Set METRICS_ENABLED=true on the server." });
  }
  const metrics = trafficMetrics.snapshot();
  // Keep existing aggregate access for admin-level roles. Named employee
  // diagnostics are restricted to actual administrators.
  if (!['admin', 'alpha'].includes(req.user.role)) {
    delete metrics.employeesSinceStartup;
    delete metrics.employeesCurrentWindow;
  }
  return res.status(200).json({ success: true, metrics });
});

module.exports = router;
