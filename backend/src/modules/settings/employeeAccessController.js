const mongoose = require('mongoose');
const Employee = require('../../models/Employee');
const Project = require('../../models/Project');
const { refreshClientAccessIfStale } = require('../../services/clientAccess');
const { buildEmployeeScope, projectAllowedForTeam, activityOptionsForEmployee } = require('../../services/activitySelection');
const sendError = require('../../utils/sendErrorResponse');

async function getEmployeeLinks(req, res) {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.employeeId)) {
      return res.status(400).json({ success: false, message: 'Choose a valid employee.' });
    }
    const employee = await Employee.findOne({ _id: req.params.employeeId, isActive: true, role: { $ne: 'alpha' } })
      .select('fullName employeeId role team').lean();
    if (!employee) return res.status(404).json({ success: false, message: 'Active employee not found.' });
    await refreshClientAccessIfStale();
    const scope = await buildEmployeeScope(employee);
    const projects = await Project.find({ status: 'Active', deletedAt: null })
      .select('projectName projectCode teams clients client activityMappingEnabled linkedTasks').sort('projectName').limit(501).lean();
    if (projects.length > 500) return res.status(413).json({ success: false, message: 'Too many projects to preview employee access.' });
    const links = [];
    for (const project of projects) {
      if (!projectAllowedForTeam(project, scope, employee)) continue;
      const options = await activityOptionsForEmployee(project, employee, { scope });
      links.push({ _id: project._id, projectName: project.projectName, projectCode: project.projectCode,
        clients: options.clients, tasks: options.tasks, mappingEnabled: options.mappingEnabled });
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, employee: { _id: employee._id, fullName: employee.fullName, employeeId: employee.employeeId },
      projects: links, checkedAt: new Date().toISOString() });
  } catch (error) { return sendError(res, error, 'Unable to load current employee access.'); }
}

module.exports = { getEmployeeLinks };
