const express = require("express");

const {
  createTask,
  createTasksBulk,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  toggleTaskStatus,
  resolveProjectForTeams,
} = require("./taskController");

const {
  protect,
} = require("../../middleware/authMiddleware");

const {
  requirePermission,
} = require("../../middleware/authorizeRoles");
const {
  guardTaskAssignmentOnCreate,
  guardTaskReassignment,
} = require("./taskPermissions");

const router = express.Router();
const catalogCache = require("../../middleware/catalogCache");
const Task = require("../../models/Task");
const Project = require("../../models/Project");
const Team = require("../../models/Team");
const Employee = require("../../models/Employee");

// ==============================================
// CREATE TASK
// Admin + Team Lead
// ==============================================
router.post(
  "/",
  protect,
  requirePermission("create_tasks"),
  guardTaskAssignmentOnCreate,
  createTask
);

router.post(
  "/bulk",
  protect,
  requirePermission("create_tasks"),
  guardTaskAssignmentOnCreate,
  createTasksBulk
);

// ==============================================
// GET ALL TASKS
// Logged-in users
// ==============================================
router.get(
  "/",
  protect,
  catalogCache([Task, Project, Team, Employee]),
  getAllTasks
);

// ==============================================
// RESOLVE PROJECT FOR TEAM(S)
// IMPORTANT:
// Keep this BEFORE /:id
// ==============================================
router.get(
  "/resolve-project",
  protect,
  requirePermission("create_tasks", "edit_tasks"),
  resolveProjectForTeams
);

// ==============================================
// TOGGLE ACTIVE / INACTIVE
// IMPORTANT:
// Keep this BEFORE /:id
// ==============================================
router.patch(
  "/:id/toggle-status",
  protect,
  requirePermission("archive_tasks"),
  toggleTaskStatus
);

// ==============================================
// GET TASK
// ==============================================
router.get(
  "/:id",
  protect,
  getTaskById
);

// ==============================================
// UPDATE TASK
// ==============================================
router.put(
  "/:id",
  protect,
  requirePermission("edit_tasks"),
  guardTaskReassignment,
  updateTask
);

// ==============================================
// DELETE TASK
// ==============================================
router.delete(
  "/:id",
  protect,
  requirePermission("archive_tasks"),
  deleteTask
);

module.exports = router;
