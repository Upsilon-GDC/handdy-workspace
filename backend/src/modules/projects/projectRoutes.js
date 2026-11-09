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
const { getActivityLinks, saveActivityLinks, saveBatchActivityLinks, getActivityLinkHistory } = require('./activityLinkController');
const { activityOptionsForEmployee } = require('../../services/activitySelection');
const sendErrorResponse = require('../../utils/sendErrorResponse');
const Task = require('../../models/Task');
const { taskScope } = require('../../services/projectTasks');
const ActivityMapping = require('../../models/ActivityMapping');
const { allowedClientIds, workTeamIds, workProjectIds } = require('../../services/clientAccess');

router.get('/task-options', protect, requirePermission('manage_projects'), requirePermission('manage_activity_links'), catalogCache([Task, Project, Team, Employee]), async (req, res) => {
  try {
    const tasks = await Task.find({ isActive: true, deletedAt: null, ...await taskScope(req.user) })
      .select('taskName taskCode taskType project team teams').populate('project', 'projectName').sort('taskName').lean();
    return res.json({ success: true, tasks });
  } catch (error) { return sendErrorResponse(res, error, 'Unable to load existing tasks.'); }
});

router.get('/:id/activity-options', protect,
  catalogCache([Project, Client, Task, Team, Employee, ActivityMapping], {
    scopeKey: req => [allowedClientIds(req.user)?.slice().sort() || null, workTeamIds(req.user).sort(), workProjectIds(req.user).sort()],
  }), async (req, res) => {
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
router.get('/activity-links/history', protect, requirePermission('manage_activity_links'), getActivityLinkHistory);
router.post('/activity-links', protect, requirePermission('manage_activity_links'), saveActivityLinks);
router.post('/activity-links/batch', protect, requirePermission('manage_activity_links'), saveBatchActivityLinks);

// All logged-in users can view projects
router.get("/", protect, catalogCache([Project, Client, Team, Employee], { shared: true, scopeKey: req => [workTeamIds(req.user).sort(), workProjectIds(req.user).sort()] }), getAllProjects);
router.get("/:id", protect, getProjectById);

// Admin and Manager can manage projects
router.post("/", protect, requirePermission("manage_projects"), createProject);
router.put("/:id", protect, requirePermission("manage_projects"), updateProject);
router.delete("/:id", protect, requirePermission("manage_projects"), deleteProject);

module.exports = router;
