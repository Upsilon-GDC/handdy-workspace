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
const { requirePermission } = require("../../middleware/authorizeRoles");

// Use the same effective permissions as time reports, including revocations.
// The controllers retain the caller's own-team/company scope boundaries.
const TEAM_ATTENDANCE = requirePermission("view_team_timesheets");
const COMPANY_ATTENDANCE = requirePermission("view_all_reports");

// Retired compatibility routes: authentication still applies; both return
// 410 ATTENDANCE_TIMER_MANAGED without reading or writing attendance.
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
