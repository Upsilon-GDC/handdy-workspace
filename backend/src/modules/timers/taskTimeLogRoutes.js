const express = require("express");

const {
  startTimer,
  heartbeatTimer,
  pauseTimer,
  resumeTimer,
  updateNote,
  stopTimer,
  getActiveTimer,
  getMyTeamTimeLogs,
  getMyTimeLogs,
  getAllTimeLogs,
  getLiveTimers,
} = require("./taskTimeLogController");

const { protect } = require("../../middleware/authMiddleware");
const { authorizeRoles, requirePermission } = require("../../middleware/authorizeRoles");
const { createManualEntry, deleteManualEntry, getManualEntryOptions } = require("./manualTimeEntryController");

const router = express.Router();

router.get(
  "/live",
  protect,
  authorizeRoles("admin", "team_lead"),
  getLiveTimers
);

router.get(
  "/admin",
  protect,
  requirePermission("view_all_reports"),
  getAllTimeLogs
);

// Own team only: a team lead's assigned employees, or the employees of the
// team the person belongs to (services/teamScope.js).
router.get(
  "/team",
  protect,
  requirePermission("view_team_timesheets"),
  getMyTeamTimeLogs
);

// Manual (back-filled) entries: permission-gated, scope-checked in the controller.
router.get("/manual/options", protect, requirePermission("add_manual_entries"), getManualEntryOptions);
router.post("/manual", protect, requirePermission("add_manual_entries"), createManualEntry);
router.delete("/manual/:id", protect, requirePermission("add_manual_entries"), deleteManualEntry);

// Admin, Team Lead, and Employee can control their own timer
router.post("/start", protect, startTimer);
router.post("/heartbeat", protect, heartbeatTimer);
router.post("/pause", protect, pauseTimer);
router.post("/resume", protect, resumeTimer);
router.post("/stop", protect, stopTimer);
router.patch("/note", protect, updateNote);
router.get("/active", protect, getActiveTimer);
router.get("/history", protect, getMyTimeLogs);
router.get("/my", protect, getMyTimeLogs);

module.exports = router;
