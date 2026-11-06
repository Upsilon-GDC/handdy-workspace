const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../middleware/authorizeRoles');
const { isAdminRole } = require('../../utils/roles');
const Team = require('../../models/Team');
const Employee = require('../../models/Employee');
const Client = require('../../models/Client');
const Policy = require('../../models/ClientAccessPolicy');
const Project = require('../../models/Project');
const sendError = require('../../utils/sendErrorResponse');
const { saveSingle, saveBatch, getHistory } = require('./clientAccessController');
const router = express.Router();
router.use(protect, (req, res, next) => isAdminRole(req.user.role) ? next()
  : res.status(403).json({ success: false, message: 'Only company administrators can configure client access.' }), requirePermission('manage_activity_links'));
router.get('/history', getHistory);
router.post('/employees/batch', saveBatch);
router.get('/', async (req, res) => {
  try {
    const [teams, employees, clients, policies, projects] = await Promise.all([
      Team.find({ isActive: true }).select('teamName').sort('teamName').lean(),
      Employee.find({ isActive: true, role: { $ne: 'alpha' } }).select('employeeId fullName team').sort('fullName').lean(),
      Client.find({ status: 'Active' }).select('clientName').sort('clientName').lean(),
      Policy.find({}).lean(),
      Project.find({ status: 'Active', deletedAt: null }).select('projectName projectCode teams clients client').sort('projectName').lean(),
    ]);
    res.json({ success: true, teams, employees, clients, policies, projects });
  } catch (error) { sendError(res, error, 'Unable to load client access.'); }
});
router.put('/:type/:id', saveSingle);
module.exports = router;
