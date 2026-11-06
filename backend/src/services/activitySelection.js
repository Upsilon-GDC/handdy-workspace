const ActivityMapping = require('../models/ActivityMapping');
const Client = require('../models/Client');
const Task = require('../models/Task');
const Project = require('../models/Project');
const { isAdminRole } = require('../utils/roles');
const { taskProjectScope } = require('./projectTasks');
const { allowedClientIds, clientAccessError, activeWorkTeams, workProjectIds } = require('./clientAccess');
const id = value => String(value?._id || value || '');
const projectClientIds = project => [...new Set([...(project.clients || []), project.client].filter(Boolean).map(id))];
async function buildEmployeeScope(employee, { projectId } = {}) {
  const { hasActiveTeam, teamIds } = await activeWorkTeams(employee);
  const elevated = isAdminRole(employee.role) || employee.role === 'hr';
  const teamValue = teamIds.length > 1 || !hasActiveTeam ? { $in: teamIds } : employee.team;
  const teamMatch = { $or: [{ team: teamValue }, { teams: teamValue }] };
  const extra = teamIds.filter(value => value !== id(employee.team));
  const leadScope = hasActiveTeam ? { $or: [{ team: employee.team }, { teams: employee.team }] } : { _id: null };
  let taskScope = elevated ? {} : employee.role === 'team_lead'
    ? extra.length ? { $or: [leadScope, { $and: [{ $or: [{ team: { $in: extra } }, { teams: { $in: extra } }] }, { assignToAllEmployees: true }] }] } : leadScope
    : { $or: [{ assignedTo: employee._id }, ...(teamIds.length ? [{ $and: [teamMatch, { assignToAllEmployees: true }] }] : [])] };
  const configuredProjects = elevated ? [] : workProjectIds(employee).filter(value => !projectId || value === id(projectId));
  const projects = configuredProjects.length ? await Project.find({ _id: { $in: configuredProjects }, status: 'Active', deletedAt: null })
    .select('_id teams linkedTasks').lean() : [];
  const projectTaskScopes = projects.map(project => ({ $and: [{ assignToAllEmployees: true }, { $or: [
    { project: project._id },
    ...(project.linkedTasks?.length ? [{ _id: { $in: project.linkedTasks } }] : []),
    ...(project.teams?.length ? [{ $and: [{ project: null }, { $or: [{ team: { $in: project.teams } }, { teams: { $in: project.teams } }] }] }] : []),
  ] }] }));
  if (projectTaskScopes.length) taskScope = { $or: [taskScope, ...projectTaskScopes] };
  return { hasActiveTeam, teamIds, projectIds: projects.map(id), projectTaskScopes, taskScope,
    projectFilter: { status: 'Active', deletedAt: null }, restrictProjectsToTeam: !elevated };
}
const projectAllowedForTeam = (project, scope, employee) => !scope.restrictProjectsToTeam || !(project.teams || []).length
  || (scope.projectIds || []).includes(id(project))
  || project.teams.map(id).some(team => (scope.teamIds || (scope.hasActiveTeam ? [id(employee.team)] : [])).includes(team));

async function validateActivitySelection(project, client, task, employee) {
  const accessError = employee && clientAccessError(employee, client);
  if (accessError) return { error: accessError };
  const clients = projectClientIds(project);
  if (client && clients.length && !clients.includes(id(client))) return { error: 'The client is not linked to the selected project.' };
  if (!project.activityMappingEnabled) return { mapping: null };
  if (!client || !clients.includes(id(client))) return { error: 'Select an active client linked to this project.' };
  const mapping = await ActivityMapping.findOne({ project: project._id, client, task, isActive: true }).select('_id').lean();
  return mapping ? { mapping: mapping._id } : { error: 'This task is not linked to the selected project and client. Refresh your choices.' };
}

async function activityOptionsForEmployee(project, employee, { workOnly = false, includeShared = true } = {}) {
  const scope = await buildEmployeeScope(employee, { projectId: project._id });
  if (!projectAllowedForTeam(project, scope, employee)) return null;
  const clientIds = projectClientIds(project);
  const access = allowedClientIds(employee);
  const restricted = clientIds.length || project.activityMappingEnabled;
  const permitted = access === null ? clientIds : restricted ? clientIds.filter(client => access.includes(client)) : access;
  const clients = await Client.find({ status: 'Active', ...((restricted || access !== null) ? { _id: { $in: permitted } } : {}) }).select('clientName status').sort('clientName').lean();
  const mappings = project.activityMappingEnabled ? await ActivityMapping.find({ project: project._id, client: { $in: clients.map(client => client._id) }, isActive: true }).select('client task').lean() : [];
  const tasks = await Task.find({ isActive: true, deletedAt: null, ...(workOnly ? { taskType: 'work' } : {}),
    ...(project.activityMappingEnabled ? { _id: { $in: mappings.map(mapping => mapping.task) } } : {}),
    $and: [scope.taskScope, taskProjectScope(project, { includeShared })],
  }).select('taskName taskCode taskType project idleLogout').sort('taskName').lean();
  return { clients, tasks: tasks.map(task => ({ ...task, project: project._id,
    ...(project.activityMappingEnabled ? { clientIds: [...new Set(mappings.filter(mapping => id(mapping.task) === id(task)).map(mapping => id(mapping.client)))] } : {}),
  })), mappingEnabled: project.activityMappingEnabled === true };
}
module.exports = { validateActivitySelection, activityOptionsForEmployee, projectClientIds, buildEmployeeScope, projectAllowedForTeam };
