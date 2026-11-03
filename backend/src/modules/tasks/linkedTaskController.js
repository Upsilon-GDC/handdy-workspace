const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Task = require('../../models/Task');
const Project = require('../../models/Project');
const Client = require('../../models/Client');
const Team = require('../../models/Team');
const Employee = require('../../models/Employee');
const ActivityMapping = require('../../models/ActivityMapping');
const { ownTeamIds } = require('../../services/teamScope');
const { userHasPermission } = require('../../services/permissionService');
const { getTeamsForTask, worksWithAllTeams } = require('./taskController');
const sendErrorResponse = require('../../utils/sendErrorResponse');

const id = value => String(value?._id || value || '');
const uniqueIds = values => [...new Set(values.map(id))];
const normalizeName = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
const clientIds = project => uniqueIds([...(project.clients || []), project.client].filter(Boolean));
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function validateLinkedTaskInput(body = {}) {
  if (!mongoose.isObjectIdOrHexString(body.project)) throw fail('Select a valid project.');
  if (body.client && !mongoose.isObjectIdOrHexString(body.client)) throw fail('Select a valid client.');
  const names = Array.isArray(body.taskNames) ? body.taskNames : [body.taskName];
  if (!names.length || names.length > 100 || names.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 200)) throw fail('Enter 1–100 task names, each at most 200 characters.');
  if (new Set(names.map(normalizeName)).size !== names.length) throw fail('Each task name in this batch must be unique.');
  const taskType = body.taskType || 'work';
  if (!['work', 'break'].includes(taskType)) throw fail('Select work time or break time.');
  if (body.assignToAllEmployees !== undefined && typeof body.assignToAllEmployees !== 'boolean') throw fail('Invalid assignment choice.');
  if (body.assignedTo !== undefined && (!Array.isArray(body.assignedTo) || body.assignedTo.length > 500 || body.assignedTo.some(value => !mongoose.isObjectIdOrHexString(value)))) throw fail('Select valid employees.');
  const teams = body.teams ?? (body.team ? [body.team] : []);
  if (!Array.isArray(teams) || teams.some(value => !mongoose.isObjectIdOrHexString(value))) throw fail('Select valid teams.');
  if (body.idleLogout !== undefined && typeof body.idleLogout !== 'boolean') throw fail('Invalid idle policy choice.');
  if (body.teamAssignment !== undefined && !['project', 'own', 'selected'].includes(body.teamAssignment)) throw fail('Choose a valid team assignment mode.');
  return { project: id(body.project), client: id(body.client), taskNames: names.map(name => name.trim()), taskType,
    teamAssignment: body.teamAssignment,
    teams: uniqueIds(teams), assignedTo: body.assignToAllEmployees === false ? uniqueIds(body.assignedTo || []) : [],
    assignToAllEmployees: body.assignToAllEmployees !== false, idleLogout: body.idleLogout === true };
}

function resolveCreationClient(project, activeClients, requestedClient) {
  const eligible = activeClients.filter(client => clientIds(project).includes(id(client)));
  const selected = requestedClient || (eligible.length === 1 ? id(eligible[0]) : '');
  if (!eligible.length) throw fail('This project has no active linked clients. Ask an administrator to configure its clients.');
  if (!selected) throw fail('Select a client for this project.');
  if (!eligible.some(client => id(client) === selected)) throw fail('The selected client is not active or linked to this project.');
  return selected;
}

async function getTaskCreationOptions(req, res) {
  try {
    const teamFilter = worksWithAllTeams(req.user) ? { isActive: true } : { _id: { $in: await ownTeamIds(req.user) }, isActive: true };
    const teams = await Team.find(teamFilter).select('teamName').sort('teamName').lean();
    const filter = { status: 'Active', deletedAt: null };
    if (!worksWithAllTeams(req.user)) {
      if (!teams.length) return res.json({ success: true, projects: [], clients: [], teams: [] });
      filter.$or = [{ teams: { $in: teams.map(team => team._id) } }, { teams: { $size: 0 } }, { teams: { $exists: false } }];
    }
    const projects = await Project.find(filter).select('projectName projectCode teams client clients').sort('projectName').lean();
    const clients = await Client.find({ _id: { $in: [...new Set(projects.flatMap(clientIds))] }, status: 'Active' }).select('clientName').sort('clientName').lean();
    const employees = userHasPermission(req.user, 'reassign_tasks')
      ? await Employee.find({ role: 'employee', isActive: true, team: { $in: teams.map(team => team._id) } }).select('employeeId fullName team').populate('team', 'teamName').sort('fullName').lean()
      : [];
    const activeClientIds = new Set(clients.map(id));
    return res.json({ success: true, teams, clients, employees, projects: projects.map(project => ({
      _id: project._id, projectName: project.projectName, projectCode: project.projectCode, teams: project.teams || [],
      clientIds: clientIds(project).filter(value => activeClientIds.has(value)),
    })) });
  } catch (error) { return sendErrorResponse(res, error, 'Unable to load task creation options.'); }
}

async function createLinkedTasks(req, res) {
  let session;
  try {
    const input = validateLinkedTaskInput(req.body);
    if (input.assignedTo.length && !userHasPermission(req.user, 'reassign_tasks')) throw fail('You do not have permission to assign individual employees.', 403);
    if (!input.assignToAllEmployees && !input.assignedTo.length) throw fail('Select employees or assign the entire team.');
    const assignment = input.teamAssignment || (input.teams.length ? 'selected' : worksWithAllTeams(req.user) ? 'project' : 'own');
    if (assignment === 'project' && !worksWithAllTeams(req.user)) throw fail('Only company task administrators can assign all project teams.', 403);
    const resolved = assignment === 'project' ? null : await getTeamsForTask(req.user, input.teams);
    if (resolved && !resolved.teams) throw fail(resolved.error, 403);
    session = await mongoose.startSession();
    let created;
    let selectedClient;
    await session.withTransaction(async () => {
      const project = await Project.findOne({ _id: input.project, status: 'Active', deletedAt: null }).session(session).lean();
      if (!project) throw fail('Select an active project.');
      const projectTeams = (project.teams || []).map(id);
      const teamIds = assignment === 'project' ? uniqueIds(projectTeams) : resolved.teamIds;
      if (!teamIds.length) throw fail('This project has no configured teams. Configure its teams or choose Change team access.');
      if (projectTeams.length && teamIds.some(team => !projectTeams.includes(team))) throw fail('The project is not assigned to every selected team.', 403);
      const teamFilter = { _id: { $in: teamIds }, isActive: true };
      if (!worksWithAllTeams(req.user) && req.user.role === 'team_lead') teamFilter.teamLead = req.user._id;
      if (await Team.countDocuments(teamFilter).session(session) !== teamIds.length) throw fail('Your selected team assignments have changed. Refresh the form.', 403);
      const clients = await Client.find({ _id: { $in: clientIds(project) }, status: 'Active' }).session(session).lean();
      selectedClient = resolveCreationClient(project, clients, input.client);
      if (input.assignedTo.length && await Employee.countDocuments({ _id: { $in: input.assignedTo }, role: 'employee', isActive: true, team: { $in: teamIds } }).session(session) !== input.assignedTo.length) throw fail('Select only active employees from the selected teams.', 403);

      // Include disabled mappings/tasks too: reusing an existing task avoids
      // accidentally duplicating a task which an administrator can reactivate.
      const links = await ActivityMapping.find({ project: project._id, client: selectedClient }).select('task').session(session).lean();
      const candidates = await Task.find({ _id: { $in: links.map(link => link.task) }, deletedAt: null, taskType: input.taskType,
        $or: [{ team: { $in: teamIds } }, { teams: { $in: teamIds } }] }).select('taskName').session(session).lean();
      const names = new Set(input.taskNames.map(normalizeName));
      if (candidates.some(task => names.has(normalizeName(task.taskName)))) throw fail('A task with this name already exists for this project, client and team. Reuse or reactivate it.', 409);
      // Every create/link/client edit writes the same project document. A
      // concurrent transaction retries and rechecks links and duplicates.
      await Project.updateOne({ _id: project._id }, { $inc: { activityLinksVersion: 1 } }, { session });
      const documents = input.taskNames.map(taskName => ({
        taskCode: `TSK-${crypto.randomUUID().toUpperCase()}`, taskName, taskType: input.taskType,
        project: project._id, team: teamIds[0], teams: teamIds, assignedTo: input.assignedTo,
        assignToAllEmployees: input.assignToAllEmployees, idleLogout: input.idleLogout, isActive: true, createdBy: req.user._id,
      }));
      created = await Task.insertMany(documents, { session, ordered: true });
      await ActivityMapping.insertMany(created.map(task => ({ project: project._id, client: selectedClient, task: task._id,
        isActive: true, createdBy: req.user._id, updatedBy: req.user._id })), { session, ordered: true });
    });
    return res.status(201).json({ success: true, message: `${created.length} task${created.length === 1 ? '' : 's'} created and linked.`, tasks: created, client: selectedClient });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'A task or link changed while saving. Refresh before retrying.' });
    return sendErrorResponse(res, error, 'Unable to create tasks and links. No partial batch was saved.');
  } finally { if (session) await session.endSession(); }
}

module.exports = { getTaskCreationOptions, createLinkedTasks, validateLinkedTaskInput, resolveCreationClient };
