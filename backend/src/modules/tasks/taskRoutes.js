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
const { workTeamIds, workProjectIds } = require('../../services/clientAccess');
const { getTaskCreationOptions, createLinkedTasks } = require('./linkedTaskController');
const { getTaskProjectSelections, saveMultiProjectTask } = require('./multiProjectTaskController');

router.get('/creation-options', protect, requirePermission('create_tasks'), getTaskCreationOptions);
router.get('/project-options', protect, requirePermission('create_tasks', 'edit_tasks'), getTaskCreationOptions);
router.get('/:id/project-selections', protect, requirePermission('edit_tasks'), getTaskProjectSelections);
router.post('/multi-project', protect, requirePermission('create_tasks'), guardTaskAssignmentOnCreate, saveMultiProjectTask);
router.put('/:id/multi-project', protect, requirePermission('edit_tasks'), guardTaskReassignment, saveMultiProjectTask);
router.post('/linked', protect, requirePermission('create_tasks'), guardTaskAssignmentOnCreate, createLinkedTasks);

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
  catalogCache([Task, Project, Team, Employee], { scopeKey: req => [workTeamIds(req.user).sort(), workProjectIds(req.user).sort()] }),
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
