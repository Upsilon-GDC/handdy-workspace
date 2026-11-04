const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Task = require('../../models/Task');
const Project = require('../../models/Project');
const Team = require('../../models/Team');
const Employee = require('../../models/Employee');
const Client = require('../../models/Client');
const ActivityMapping = require('../../models/ActivityMapping');
const { ownTeamIds, teamTaskMatch } = require('../../services/teamScope');
const { userHasPermission } = require('../../services/permissionService');
const { worksWithAllTeams, getTeamsForTask } = require('./taskController');
const { validateLinkedTaskInput, resolveCreationClient } = require('./linkedTaskController');
const sendErrorResponse = require('../../utils/sendErrorResponse');
const id = value => String(value?._id || value || '');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const linksRevision = (task, projects, mappings) => crypto.createHash('sha256').update(JSON.stringify([
  id(task.project), projects.map(id).sort(), mappings.map(mapping => `${id(mapping.project)}:${id(mapping.client)}`).sort(),
])).digest('hex');
const scopedTask = async (user, taskId) => ({ _id: taskId, deletedAt: null,
  ...(!worksWithAllTeams(user) ? teamTaskMatch(await ownTeamIds(user)) : {}) });

function validateProjectSelections(body) {
  const rows = body.projectSelections;
  if (!Array.isArray(rows) || !rows.length || rows.length > 50) throw fail('Select 1–50 projects.');
  if (rows.some(row => !row || !mongoose.isObjectIdOrHexString(row.project)
    || (row.client && !mongoose.isObjectIdOrHexString(row.client)))) throw fail('Select valid projects and clients.');
  if (new Set(rows.map(row => row.project)).size !== rows.length) throw fail('Select each project only once.');
  return rows.map(row => ({ project: row.project, client: row.client || '' }));
}

async function getTaskProjectSelections(req, res) {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw fail('Invalid task ID.');
    const task = await Task.findOne(await scopedTask(req.user, req.params.id)).select('project updatedAt').lean();
    if (!task) throw fail('Task not found.', 404);
    const mappings = await ActivityMapping.find({ task: task._id, isActive: true }).select('project client').lean();
    const projects = await Project.find({ $or: [{ _id: { $in: [task.project, ...mappings.map(mapping => mapping.project)].filter(Boolean) } }, { linkedTasks: task._id }] }).select('client clients').lean();
    return res.json({ success: true, expectedUpdatedAt: task.updatedAt, expectedProjectLinks: linksRevision(task, projects, mappings),
      projectSelections: projects.map(project => ({ project: id(project), client: id(mappings.find(mapping => id(mapping.project) === id(project))?.client || project.client || project.clients?.[0]) })) });
  } catch (error) { return respond(res, error); }
}

function respond(res, error) {
  if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
  return sendErrorResponse(res, error, 'Unable to save tasks and project links. No partial changes were saved.');
}

async function saveMultiProjectTask(req, res) {
  let session;
  try {
    const editing = Boolean(req.params.id);
    const selections = validateProjectSelections(req.body || {});
    const input = validateLinkedTaskInput({ ...req.body, project: selections[0].project, client: selections[0].client });
    if (editing && input.taskNames.length !== 1) throw fail('Edit one task at a time.');
    if (editing && (!mongoose.isObjectIdOrHexString(req.params.id) || !req.body.expectedUpdatedAt || !Number.isFinite(+new Date(req.body.expectedUpdatedAt)))) throw fail('Reload the task before editing.');
    if (editing && (typeof req.body.expectedProjectLinks !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.expectedProjectLinks))) throw fail('Reload project selections before editing.');
    if (!input.assignToAllEmployees && !input.assignedTo.length) throw fail('Select employees or assign the entire team.');
    if (!editing && input.assignedTo.length && !userHasPermission(req.user, 'reassign_tasks')) throw fail('You do not have permission to assign individual employees.', 403);
    const assignment = editing ? 'selected' : input.teamAssignment || (worksWithAllTeams(req.user) ? 'project' : 'own');
    if (assignment === 'project' && !worksWithAllTeams(req.user)) throw fail('Only company task administrators can assign project teams.', 403);
    const resolved = assignment === 'project' ? null : await getTeamsForTask(req.user, input.teams);
    if (resolved && !resolved.teams) throw fail(resolved.error, 403);
    const filter = editing ? await scopedTask(req.user, req.params.id) : null;
    session = await mongoose.startSession();
    let saved;
    await session.withTransaction(async () => {
      const existing = editing ? await Task.findOne(filter).session(session).lean() : null;
      if (editing && !existing) throw fail('Task not found.', 404);
      if (editing && +new Date(existing.updatedAt) !== +new Date(req.body.expectedUpdatedAt)) throw fail('This task changed in another window. Reload before saving.', 409);
      if (editing && !userHasPermission(req.user, 'reassign_tasks')) {
        const same = input.assignToAllEmployees === existing.assignToAllEmployees
          && JSON.stringify([...input.assignedTo].sort()) === JSON.stringify((existing.assignedTo || []).map(id).sort());
        if (!same) throw fail('You do not have permission to assign tasks.', 403);
      }
      if (editing && req.body.isActive !== undefined && typeof req.body.isActive !== 'boolean') throw fail('Invalid task status.');
      if (editing && req.body.isActive !== undefined && req.body.isActive !== existing.isActive && !userHasPermission(req.user, 'archive_tasks')) throw fail('You do not have permission to activate or deactivate tasks.', 403);
      const projectIds = selections.map(row => row.project);
      const oldMappings = editing ? await ActivityMapping.find({ task: existing._id, isActive: true }).select('project client').session(session).lean() : [];
      const oldProjects = editing ? await Project.find({ $or: [{ _id: { $in: [existing.project, ...oldMappings.map(mapping => mapping.project)].filter(Boolean) } }, { linkedTasks: existing._id }] }).select('teams').session(session).lean() : [];
      if (editing && linksRevision(existing, oldProjects, oldMappings) !== req.body.expectedProjectLinks) throw fail('Project links changed in another window. Reload before saving.', 409);
      if (editing && !worksWithAllTeams(req.user)) {
        const own = (await ownTeamIds(req.user)).map(id);
        if (oldProjects.some(project => !projectIds.includes(id(project)) && !(project.teams || []).some(team => own.includes(id(team))))) throw fail('You cannot remove project links outside your team.', 403);
      }
      const projects = await Project.find({ _id: { $in: projectIds }, status: 'Active', deletedAt: null }).session(session).lean();
      if (projects.length !== selections.length) throw fail('Select active projects.');
      const teamIds = assignment === 'project'
        ? [...new Set((projects.find(project => id(project) === projectIds[0]).teams || []).map(id))]
          .filter(team => projects.every(project => (project.teams || []).map(id).includes(team)))
        : resolved.teamIds;
      if (!teamIds.length) throw fail('The selected projects need a common team. Choose projects for the same team or change team access.');
      for (const project of projects) {
        const allowed = (project.teams || []).map(id);
        if (allowed.length && teamIds.some(team => !allowed.includes(team))) throw fail('Every selected project must allow all selected task teams.', 403);
      }
      const teamFilter = { _id: { $in: teamIds }, isActive: true };
      if (!worksWithAllTeams(req.user) && req.user.role === 'team_lead') teamFilter.teamLead = req.user._id;
      if (await Team.countDocuments(teamFilter).session(session) !== teamIds.length) throw fail('Team assignments changed. Refresh before saving.', 403);
      if (input.assignedTo.length && await Employee.countDocuments({ _id: { $in: input.assignedTo }, role: 'employee', isActive: true, team: { $in: teamIds } }).session(session) !== input.assignedTo.length) throw fail('Select active employees from the selected teams.', 403);
      const activeClients = await Client.find({ status: 'Active', _id: { $in: projects.flatMap(project => [...(project.clients || []), project.client].filter(Boolean)) } }).session(session).lean();
      for (const row of selections) row.client = resolveCreationClient(projects.find(project => id(project) === row.project), activeClients, row.client);
      const names = new Set(input.taskNames.map(normalize));
      for (const row of selections) {
        const unchangedIdentity = editing && normalize(existing.taskName) === normalize(input.taskNames[0]) && existing.taskType === input.taskType
          && JSON.stringify((existing.teams?.length ? existing.teams : [existing.team]).filter(Boolean).map(id).sort()) === JSON.stringify([...teamIds].sort());
        if (unchangedIdentity && oldProjects.some(project => id(project) === row.project)) continue;
        const project = projects.find(project => id(project) === row.project);
        const mappings = await ActivityMapping.find({ project: project._id, client: row.client }).select('task').session(session).lean();
        const candidates = await Task.find({ deletedAt: null, taskType: input.taskType,
          ...(editing ? { _id: { $ne: existing._id } } : {}),
          $and: [{ $or: [{ team: { $in: teamIds } }, { teams: { $in: teamIds } }] },
            { $or: [{ project: project._id }, { project: null }, { _id: { $in: [...(project.linkedTasks || []), ...mappings.map(mapping => mapping.task)] } }] }] }).select('taskName').session(session).lean();
        if (candidates.some(task => names.has(normalize(task.taskName)))) throw fail(`A task with this name already exists for the selected team in ${project.projectName}. Reuse or reactivate it.`, 409);
      }
      const values = { taskName: input.taskNames[0], taskType: input.taskType, project: selections[0].project,
        team: teamIds[0], teams: teamIds, assignedTo: input.assignedTo, assignToAllEmployees: input.assignToAllEmployees,
        idleLogout: input.idleLogout };
      if (editing) {
        const result = await Task.updateOne({ _id: existing._id, updatedAt: existing.updatedAt }, { $set: { ...values,
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}) } }, { session, runValidators: true });
        if (!result.matchedCount) throw fail('This task changed. Reload before saving.', 409);
        saved = [await Task.findById(existing._id).session(session).lean()];
        // Remove only this task's links; mappings remain as historical audit records.
        await Project.updateMany({ _id: { $in: oldProjects.filter(project => !projectIds.includes(id(project))).map(project => project._id) } }, { $pull: { linkedTasks: existing._id }, $inc: { activityLinksVersion: 1 } }, { session });
        await ActivityMapping.updateMany({ task: existing._id, project: { $nin: projectIds }, isActive: true }, { $set: { isActive: false, updatedBy: req.user._id } }, { session });
      } else {
        saved = await Task.insertMany(input.taskNames.map(taskName => ({ ...values, taskName, taskCode: `TSK-${crypto.randomUUID().toUpperCase()}`, isActive: true, createdBy: req.user._id })), { session });
      }
      for (const projectId of [...projectIds].sort()) {
        await Project.updateOne({ _id: projectId }, { $addToSet: { linkedTasks: { $each: saved.map(task => task._id) } }, $inc: { activityLinksVersion: 1 } }, { session });
      }
      await ActivityMapping.bulkWrite(selections.flatMap(row => saved.map(task => ({ updateOne: {
        filter: { project: row.project, client: row.client, task: task._id },
        update: { $set: { isActive: true, updatedBy: req.user._id }, $setOnInsert: { createdBy: req.user._id } }, upsert: true,
      } }))), { session, ordered: true });
    });
    return res.status(req.params.id ? 200 : 201).json({ success: true, tasks: saved, task: saved[0], message: 'Tasks and selected projects saved.' });
  } catch (error) { return respond(res, error); }
  finally { if (session) await session.endSession(); }
}
module.exports = { getTaskProjectSelections, saveMultiProjectTask, validateProjectSelections };
