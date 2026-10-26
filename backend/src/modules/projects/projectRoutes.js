const express = require("express");

const {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
} = require("./projectController");

const { protect } = require("../../middleware/authMiddleware");
const { requirePermission } = require("../../middleware/authorizeRoles");

const router = express.Router();
const catalogCache = require("../../middleware/catalogCache");
const Project = require("../../models/Project");
const Client = require("../../models/Client");
const Team = require("../../models/Team");
const Employee = require("../../models/Employee");

// All logged-in users can view projects
router.get("/", protect, catalogCache([Project, Client, Team, Employee], { shared: true }), getAllProjects);
router.get("/:id", protect, getProjectById);

// Admin and Manager can manage projects
router.post("/", protect, requirePermission("manage_projects"), createProject);
router.put("/:id", protect, requirePermission("manage_projects"), updateProject);
router.delete("/:id", protect, requirePermission("manage_projects"), deleteProject);

module.exports = router;
