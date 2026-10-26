const express = require("express");
const router = express.Router();

const {
  checkIn,
  checkOut,
  getTodayAttendance,
  getAttendanceHistory,
  getMyTeamTodayAttendance,
  getMyTeamAttendanceHistory,
  getAllAttendanceHistory,
} = require("./attendanceController");

const { protect } = require("../../middleware/authMiddleware");
const { authorizeRolesOrPermissions } = require("../../middleware/authorizeRoles");

// Team leads always see their team's attendance; anyone else needs "View team
// timesheets" (own team) or "View all employee reports" (company).
const TEAM_ATTENDANCE = authorizeRolesOrPermissions({ roles: ["team_lead"], permissions: ["view_team_timesheets"] });
const COMPANY_ATTENDANCE = authorizeRolesOrPermissions({ roles: ["hr", "manager"], permissions: ["view_all_reports"] });

// Personal attendance
router.post("/check-in", protect, checkIn);
router.post("/check-out", protect, checkOut);

// Team Lead - today's attendance for assigned team only
router.get(
  "/team/today",
  protect,
  TEAM_ATTENDANCE,
  getMyTeamTodayAttendance
);
router.get(
  "/team/history",
  protect,
  TEAM_ATTENDANCE,
  getMyTeamAttendanceHistory
);
// Admin - company-wide attendance history
router.get(
  "/admin/history",
  protect,
  COMPANY_ATTENDANCE,
  getAllAttendanceHistory
);


// Personal attendance views
router.get("/today", protect, getTodayAttendance);
router.get("/history", protect, getAttendanceHistory);

module.exports = router;
