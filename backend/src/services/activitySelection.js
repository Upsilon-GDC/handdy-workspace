const ActivityMapping = require('../models/ActivityMapping');
const Client = require('../models/Client');
const Task = require('../models/Task');
const Team = require('../models/Team');
const { isAdminRole } = require('../utils/roles');
const id = value => String(value?._id || value || '');
const projectClientIds = project => [...new Set([...(project.clients || []), project.client].filter(Boolean).map(id))];
async function buildEmployeeScope(employee) {
  const hasActiveTeam = employee.team ? Boolean(await Team.exists({ _id: employee.team, isActive: true })) : false;
  const elevated = isAdminRole(employee.role) || employee.role === 'hr';
  const teamMatch = { $or: [{ team: employee.team }, { teams: employee.team }] };
  const taskScope = elevated ? {} : employee.role === 'team_lead'
    ? hasActiveTeam ? teamMatch : { _id: null }
    : { $or: [{ assignedTo: employee._id }, ...(hasActiveTeam ? [{ $and: [teamMatch, { assignToAllEmployees: true }] }] : [])] };
  return { hasActiveTeam, taskScope, projectFilter: { status: 'Active', deletedAt: null }, restrictProjectsToTeam: !elevated };
}
const projectAllowedForTeam = (project, scope, employee) => !scope.restrictProjectsToTeam || !(project.teams || []).length
  || (scope.hasActiveTeam && project.teams.map(id).includes(id(employee.team)));

async function validateActivitySelection(project, client, task) {
  const clients = projectClientIds(project);
  if (client && clients.length && !clients.includes(id(client))) return { error: 'The client is not linked to the selected project.' };
  if (!project.activityMappingEnabled) return { mapping: null };
  if (!client || !clients.includes(id(client))) return { error: 'Select an active client linked to this project.' };
  const mapping = await ActivityMapping.findOne({ project: project._id, client, task, isActive: true }).select('_id').lean();
  return mapping ? { mapping: mapping._id } : { error: 'This task is not linked to the selected project and client. Refresh your choices.' };
}

async function activityOptionsForEmployee(project, employee, { workOnly = false, includeShared = true } = {}) {
  const scope = await buildEmployeeScope(employee);
  if (!projectAllowedForTeam(project, scope, employee)) return null;
  const clientIds = projectClientIds(project);
  const clients = await Client.find({ status: 'Active', ...((clientIds.length || project.activityMappingEnabled) ? { _id: { $in: clientIds } } : {}) }).select('clientName status').sort('clientName').lean();
  const mappings = project.activityMappingEnabled ? await ActivityMapping.find({ project: project._id, client: { $in: clients.map(client => client._id) }, isActive: true }).select('client task').lean() : [];
  const tasks = await Task.find({ isActive: true, deletedAt: null, ...(workOnly ? { taskType: 'work' } : {}),
    ...(project.activityMappingEnabled ? { _id: { $in: mappings.map(mapping => mapping.task) } } : {}),
    $and: [scope.taskScope, includeShared ? { $or: [{ project: project._id }, { project: null }] } : { project: project._id }],
  }).select('taskName taskCode taskType project idleLogout').sort('taskName').lean();
  return { clients, tasks: tasks.map(task => ({ ...task, project: project._id,
    ...(project.activityMappingEnabled ? { clientIds: [...new Set(mappings.filter(mapping => id(mapping.task) === id(task)).map(mapping => id(mapping.client)))] } : {}),
  })), mappingEnabled: project.activityMappingEnabled === true };
}
module.exports = { validateActivitySelection, activityOptionsForEmployee, projectClientIds, buildEmployeeScope, projectAllowedForTeam };
