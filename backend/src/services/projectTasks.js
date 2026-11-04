const mongoose = require('mongoose');
const Task = require('../models/Task');
const { isAdminRole } = require('../utils/roles');
const { ownTeamIds, teamTaskMatch } = require('./teamScope');
const { userHasPermission } = require('./permissionService');
const id = value => String(value?._id || value || '');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const taskScope = async user => isAdminRole(user.role) || user.role === 'hr' ? {} : teamTaskMatch(await ownTeamIds(user));

function taskProjectScope(project, { includeShared = true } = {}) {
  if (!includeShared && !(project.linkedTasks || []).length) return { project: project._id };
  return { $or: [
    { project: project._id },
    ...(includeShared ? [{ project: null }] : []),
    ...((project.linkedTasks || []).length ? [{ _id: { $in: project.linkedTasks } }] : []),
  ] };
}

async function validateProjectTasks(values, teams, user) {
  if (!userHasPermission(user, 'manage_activity_links')) throw fail('You need permission to manage task links.', 403);
  if (!Array.isArray(values) || values.length > 500 || values.some(value => !mongoose.isObjectIdOrHexString(value))) throw fail('Select up to 500 valid existing tasks.');
  const ids = [...new Set(values.map(id))];
  if (!ids.length) return ids;
  const tasks = await Task.find({ _id: { $in: ids }, isActive: true, deletedAt: null, ...await taskScope(user) }).select('team teams').lean();
  if (tasks.length !== ids.length) throw fail('Some selected tasks are inactive or outside your task permissions.', 403);
  if (tasks.some(task => !(task.teams?.length ? task.teams : [task.team]).filter(Boolean).some(team => teams.map(id).includes(id(team))))) throw fail('Each selected task must share a team with the project.');
  return ids;
}
module.exports = { taskProjectScope, validateProjectTasks, taskScope };
