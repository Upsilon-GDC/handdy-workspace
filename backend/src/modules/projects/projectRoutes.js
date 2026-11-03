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
const { getActivityLinks, saveActivityLinks } = require('./activityLinkController');
const { activityOptionsForEmployee } = require('../../services/activitySelection');
const sendErrorResponse = require('../../utils/sendErrorResponse');

router.get('/:id/activity-options', protect, async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, status: 'Active', deletedAt: null }).lean();
    if (!project) return res.status(404).json({ success: false, message: 'Active project not found.' });
    const options = await activityOptionsForEmployee(project, req.user);
    if (!options) return res.status(403).json({ success: false, message: 'This project is not available to your team.' });
    return res.json({ success: true, project: project._id, ...options });
  } catch (error) { return sendErrorResponse(res, error, 'Unable to load project activity choices.'); }
});

// Dedicated linking permission. Non-HR delegated
// users remain limited to their own task teams inside the controller.
router.get('/activity-links', protect, requirePermission('manage_activity_links'), getActivityLinks);
router.post('/activity-links', protect, requirePermission('manage_activity_links'), saveActivityLinks);

// All logged-in users can view projects
router.get("/", protect, catalogCache([Project, Client, Team, Employee], { shared: true }), getAllProjects);
router.get("/:id", protect, getProjectById);

// Admin and Manager can manage projects
router.post("/", protect, requirePermission("manage_projects"), createProject);
router.put("/:id", protect, requirePermission("manage_projects"), updateProject);
router.delete("/:id", protect, requirePermission("manage_projects"), deleteProject);

module.exports = router;
