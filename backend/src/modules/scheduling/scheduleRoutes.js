const express = require("express");

const {
  createSchedule,
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
} = require("./scheduleController");

const {
  protect,
} = require("../../middleware/authMiddleware");

const {
  authorizeRoles,
} = require("../../middleware/authorizeRoles");

const router = express.Router();

// CREATE SCHEDULE
router.post(
  "/",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  createSchedule
);

// GET ALL SCHEDULES
router.get(
  "/",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  getAllSchedules
);

// GET ONE SCHEDULE
router.get(
  "/:id",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  getScheduleById
);

// UPDATE SCHEDULE
router.put(
  "/:id",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  updateSchedule
);

// DELETE SCHEDULE
router.delete(
  "/:id",
  protect,
  authorizeRoles("admin", "manager", "hr"),
  deleteSchedule
);

module.exports = router;