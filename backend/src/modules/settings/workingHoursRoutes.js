const router = require('express').Router();
const { protect } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../middleware/authorizeRoles');
const controller = require('./workingHoursController');

// Configuration and attendance exceptions are available to Admin and Manager.
const settingsAdmin = (req, res, next) => ['admin', 'alpha', 'manager'].includes(req.user?.role)
  ? next() : res.status(403).json({ success: false, message: 'Only Admin and Manager users can configure working hours.' });
const reportStaff = (req, res, next) => ['admin', 'alpha', 'manager'].includes(req.user?.role)
  ? next() : res.status(403).json({ success: false, message: 'Only authorized Admin and Manager users can view productivity.' });
router.use(protect);
router.get('/overview', reportStaff, requirePermission('view_all_reports'), controller.getWorkingHoursOverview);
router.get('/team-overview', requirePermission('view_team_timesheets'), controller.getTeamWorkingHoursOverview);
router.get('/settings', settingsAdmin, controller.getWorkingHoursSettings);
router.put('/settings', settingsAdmin, controller.saveWorkingHoursSettings);
router.put('/adjustments', settingsAdmin, controller.saveWorkingHoursAdjustment);
module.exports = router;
