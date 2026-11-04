const mongoose = require('mongoose');
const Project = require('../../models/Project');
const Client = require('../../models/Client');
const Task = require('../../models/Task');
const ActivityMapping = require('../../models/ActivityMapping');
const ActivityLinkChange = require('../../models/ActivityLinkChange');
const { getPagination } = require('../../utils/requestUtils');
const { ownTeamIds, teamTaskMatch } = require('../../services/teamScope');
const { isAdminRole } = require('../../utils/roles');
const sendErrorResponse = require('../../utils/sendErrorResponse');

const id = value => String(value?._id || value || '');
const ids = values => [...new Set(values.map(id))];
const projectClients = project => ids([...(project.clients || []), project.client].filter(Boolean));
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const elevated = user => isAdminRole(user.role) || user.role === 'hr';
const taskScope = async user => elevated(user) ? {} : teamTaskMatch(await ownTeamIds(user));
const projectScope = async user => elevated(user) ? {} : { teams: { $in: await ownTeamIds(user) } };

function validateLinkRequest(body = {}) {
  if (!mongoose.isObjectIdOrHexString(body.project)) throw fail('Select a valid project.');
  if (!Number.isSafeInteger(body.version) || body.version < 0) throw fail('Refresh the project before saving.');
  if (!['clients', 'link', 'unlink', 'policy'].includes(body.action)) throw fail('Choose a valid linking action.');
  if (body.action === 'policy') {
    if (typeof body.enabled !== 'boolean') throw fail('Choose whether linked selection is enabled.');
    return { project: id(body.project), action: 'policy', version: body.version, enabled: body.enabled };
  }
  const field = body.action === 'clients' ? 'clientIds' : 'taskIds';
  if (!Array.isArray(body[field]) || body[field].length > 500 || body[field].some(value => !mongoose.isObjectIdOrHexString(value))) throw fail(`Select valid ${field === 'clientIds' ? 'clients' : 'tasks'} (maximum 500).`);
  if (body.action !== 'clients' && (!body.taskIds.length || !mongoose.isObjectIdOrHexString(body.client))) throw fail('Select a client and at least one task.');
  return { project: id(body.project), client: id(body.client), action: body.action, version: body.version, selectedIds: ids(body[field]) };
}

function validateTaskLinks(project, tasks, expectedCount) {
  if (tasks.length !== expectedCount) throw fail('Some selected tasks are inactive or outside your task permissions.', 403);
  const projectTeams = ids(project.teams || []);
  for (const task of tasks) {
    if (task.project && id(task.project) !== id(project) && !(project.linkedTasks || []).map(id).includes(id(task))) throw fail('A selected task belongs to another project.');
    const teams = ids(task.teams?.length ? task.teams : task.team ? [task.team] : []);
    // A mapping narrows a shared task to this project; it never changes assignments.
    if (projectTeams.length && !teams.some(team => projectTeams.includes(team))) throw fail('A selected task has no team in common with this project.');
  }
}

async function getActivityLinks(req, res) {
  try {
    const scope = await taskScope(req.user);
    const projectsScope = await projectScope(req.user);
    const [projects, clients, tasks] = await Promise.all([
      Project.find({ status: 'Active', deletedAt: null, ...projectsScope }).select('projectName projectCode client clients teams activityLinksVersion activityMappingEnabled linkedTasks').sort('projectName').lean(),
      Client.find({ status: 'Active' }).select('clientName').sort('clientName').lean(),
      Task.find({ isActive: true, deletedAt: null, ...scope }).select('taskName taskCode taskType project team teams assignToAllEmployees').populate('teams', 'teamName').populate('team', 'teamName').sort('taskName').lean(),
    ]);
    const mappings = await ActivityMapping.find({ isActive: true, project: { $in: projects.map(project => project._id) }, task: { $in: tasks.map(task => task._id) } }).select('project client task').lean();
    return res.json({ success: true, projects, clients, tasks, mappings });
  } catch (error) { return sendErrorResponse(res, error, 'Unable to load activity links.'); }
}

async function saveActivityLinks(req, res) {
  let session;
  try {
    const input = validateLinkRequest(req.body);
    const scope = await taskScope(req.user);
    const projectsScope = await projectScope(req.user);
    session = await mongoose.startSession();
    let nextVersion;
    await session.withTransaction(async () => {
      const project = await Project.findOne({ _id: input.project, status: 'Active', deletedAt: null, ...projectsScope }).session(session).lean();
      if (!project) throw fail('Active project not found.', 404);
      if ((project.activityLinksVersion || 0) !== input.version) throw fail('These links changed in another window. Refresh before saving.', 409);
      // All link writes on this project contend on one document. Transaction
      // retries re-read the version and reject stale concurrent submissions.
      const updates = { $inc: { activityLinksVersion: 1 } };
      if (input.action === 'policy') {
        if (!elevated(req.user)) throw fail('Only company task administrators can change selection enforcement.', 403);
        if (input.enabled && !projectClients(project).length) throw fail('Save project clients before enabling linked selection.');
        if (input.enabled && !await ActivityMapping.exists({ project: project._id, client: { $in: projectClients(project) }, isActive: true }).session(session)) throw fail('Link at least one task before enabling linked selection.');
        updates.$set = { activityMappingEnabled: input.enabled };
      } else if (input.action === 'clients') {
        const clients = await Client.find({ _id: { $in: input.selectedIds }, status: 'Active' }).session(session).lean();
        if (clients.length !== input.selectedIds.length) throw fail('Some clients are no longer active. Refresh and try again.');
        updates.$set = { clients: input.selectedIds, client: input.selectedIds[0] || null,
          clientName: input.selectedIds.map(value => clients.find(client => id(client) === value).clientName).join(', ') };
        if (!elevated(req.user)) {
          const editableTasks = await Task.find(scope).select('_id').session(session).lean();
          if (await ActivityMapping.exists({ project: project._id, client: { $nin: input.selectedIds }, task: { $nin: editableTasks.map(task => task._id) }, isActive: true }).session(session)) throw fail('Removing this client would change tasks outside your team. Ask an administrator.', 403);
        }
        await ActivityMapping.updateMany({ project: project._id, client: { $nin: input.selectedIds }, isActive: true }, { $set: { isActive: false, updatedBy: req.user._id } }, { session });
      } else {
        if (input.action === 'link') {
          if (!projectClients(project).includes(input.client) || !await Client.exists({ _id: input.client, status: 'Active' }).session(session)) throw fail('Save this client on the project before linking tasks.');
        }
        const tasks = await Task.find({ _id: { $in: input.selectedIds }, isActive: true, deletedAt: null, ...scope }).session(session).lean();
        if (input.action === 'link') validateTaskLinks(project, tasks, input.selectedIds.length);
        else if (tasks.length !== input.selectedIds.length) throw fail('Selected tasks are outside your task permissions.', 403);
        if (input.action === 'link') {
          await ActivityMapping.bulkWrite(input.selectedIds.map(task => ({ updateOne: {
            filter: { project: project._id, client: input.client, task }, update: { $set: { isActive: true, updatedBy: req.user._id }, $setOnInsert: { createdBy: req.user._id } }, upsert: true,
          } })), { session, ordered: true });
        } else {
          await ActivityMapping.updateMany({ project: project._id, client: input.client, task: { $in: input.selectedIds } }, { $set: { isActive: false, updatedBy: req.user._id } }, { session });
        }
      }
      await Project.updateOne({ _id: project._id }, updates, { session, runValidators: true });
      nextVersion = input.version + 1;
    });
    return res.json({ success: true, version: nextVersion, message: input.action === 'policy' ? (input.enabled ? 'Linked selection enabled for new entries.' : 'Legacy task selection restored.') : input.action === 'clients' ? 'Project clients saved.' : input.action === 'link' ? 'Selected tasks linked.' : 'Selected tasks unlinked.' });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Links changed while saving. Refresh and try again.' });
    return sendErrorResponse(res, error, 'Unable to save activity links. Refresh and try again.');
  } finally { if (session) await session.endSession(); }
}

function validateBatchLinkRequest(body = {}) {
  const mode = body.mode || 'tasks';
  if (!['tasks', 'clients'].includes(mode)) throw fail('Choose project/client links or task links.');
  if (mode === 'clients' && body.taskIds !== undefined && (!Array.isArray(body.taskIds) || body.taskIds.length)) throw fail('Client/project-only changes must not include tasks.');
  if (!['link', 'unlink'].includes(body.action)) throw fail('Choose link or unlink.');
  if (!Array.isArray(body.projects) || !body.projects.length || body.projects.length > 50
    || body.projects.some(row => !row || typeof row.project !== 'string' || !mongoose.isObjectIdOrHexString(row.project) || !Number.isSafeInteger(row.version) || row.version < 0)) throw fail('Select 1–50 projects with current versions.');
  if (new Set(body.projects.map(row => row.project.toLowerCase())).size !== body.projects.length) throw fail('Select each project only once.');
  for (const field of mode === 'clients' ? ['clientIds'] : ['clientIds', 'taskIds']) {
    if (!Array.isArray(body[field]) || !body[field].length || body[field].length > 500
      || body[field].some(value => typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value))) throw fail('Select valid clients and tasks (up to 500 each).');
  }
  const clients = ids(body.clientIds.map(value => value.toLowerCase()));
  const tasks = mode === 'clients' ? [] : ids(body.taskIds.map(value => value.toLowerCase()));
  if (body.projects.length * clients.length * (mode === 'clients' ? 1 : tasks.length) > 5000) throw fail('Select at most 5,000 combinations per save.');
  return { mode, action: body.action, projects: body.projects.map(row => ({ project: row.project.toLowerCase(), version: row.version })), clients, tasks };
}

async function saveBatchActivityLinks(req, res) {
  let session;
  let history;
  try {
    const input = validateBatchLinkRequest(req.body);
    const [scope, projectsScope] = await Promise.all([taskScope(req.user), projectScope(req.user)]);
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const projects = await Project.find({ _id: { $in: input.projects.map(row => row.project) }, status: 'Active', deletedAt: null, ...projectsScope }).session(session).lean();
      if (projects.length !== input.projects.length) throw fail('Some projects are inactive or outside your team access.', 403);
      for (const project of projects) {
        if ((project.activityLinksVersion || 0) !== input.projects.find(row => row.project === id(project)).version) throw fail('Project links changed in another window. Reload before saving.', 409);
      }
      const clients = await Client.find({ _id: { $in: input.clients }, status: 'Active' }).session(session).lean();
      if (clients.length !== input.clients.length) throw fail('Some selected clients are inactive or missing.');
      const tasks = input.mode === 'clients' ? [] : await Task.find({ _id: { $in: input.tasks }, isActive: true, deletedAt: null, ...scope }).session(session).lean();
      if (tasks.length !== input.tasks.length) throw fail('Some tasks are inactive or outside your task permissions.', 403);
      if (input.mode === 'clients' && input.action === 'unlink' && !elevated(req.user)) {
        const editableTasks = await Task.find(scope).select('_id').session(session).lean();
        if (await ActivityMapping.exists({ project: { $in: projects.map(project => project._id) }, client: { $in: input.clients }, task: { $nin: editableTasks.map(task => task._id) }, isActive: true }).session(session)) throw fail('Removing these client links would affect tasks outside your team. Ask an administrator.', 403);
      }
      if (input.mode === 'tasks' && input.action === 'link') {
        for (const project of projects) {
          // Explicit reuse adds project references; it never moves tasks or grants teams.
          validateTaskLinks({ ...project, linkedTasks: ids([...(project.linkedTasks || []), ...input.tasks]) }, tasks, input.tasks.length);
        }
      }
      for (const project of [...projects].sort((a, b) => id(a).localeCompare(id(b)))) {
        const update = { $inc: { activityLinksVersion: 1 } };
        if (input.action === 'link' || input.mode === 'clients') {
          const union = input.action === 'link' ? ids([...projectClients(project), ...input.clients]) : projectClients(project).filter(value => !input.clients.includes(value));
          const allClients = await Client.find({ _id: { $in: union } }).select('clientName').session(session).lean();
          update.$set = { clients: union, client: union.includes(id(project.client)) ? project.client : union[0] || null,
            clientName: union.map(value => allClients.find(client => id(client) === value)?.clientName).filter(Boolean).join(', ') };
          if (input.mode === 'tasks') update.$addToSet = { linkedTasks: { $each: input.tasks } };
        }
        await Project.updateOne({ _id: project._id }, update, { session, runValidators: true });
      }
      if (input.mode === 'clients') {
        if (input.action === 'unlink') await ActivityMapping.updateMany({ project: { $in: input.projects.map(row => row.project) }, client: { $in: input.clients }, isActive: true }, { $set: { isActive: false, updatedBy: req.user._id } }, { session });
      } else if (input.action === 'link') {
        await ActivityMapping.bulkWrite(input.projects.flatMap(row => input.clients.flatMap(client => input.tasks.map(task => ({ updateOne: {
          filter: { project: row.project, client, task }, update: { $set: { isActive: true, updatedBy: req.user._id }, $setOnInsert: { createdBy: req.user._id } }, upsert: true,
        } })))), { session, ordered: true });
      } else {
        await ActivityMapping.updateMany({ project: { $in: input.projects.map(row => row.project) }, client: { $in: input.clients }, task: { $in: input.tasks }, isActive: true }, { $set: { isActive: false, updatedBy: req.user._id } }, { session });
      }
      [history] = await ActivityLinkChange.create([{ action: input.action, mode: input.mode, actor: req.user._id,
        actorName: req.user.fullName || req.user.employeeId || 'User',
        projects: projects.map(project => ({ id: project._id, name: project.projectName })),
        clients: clients.map(client => ({ id: client._id, name: client.clientName })),
        tasks: tasks.map(task => ({ id: task._id, name: task.taskName })),
        combinationCount: input.projects.length * input.clients.length * (input.mode === 'clients' ? 1 : input.tasks.length),
      }], { session });
    });
    const combinationCount = input.projects.length * input.clients.length * (input.mode === 'clients' ? 1 : input.tasks.length);
    return res.json({ success: true, combinationCount, history, message: `Saved ${combinationCount} selected combinations.`, versions: input.projects.map(row => ({ project: row.project, version: row.version + 1 })) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Links changed while saving. Reload before retrying.' });
    return sendErrorResponse(res, error, 'Unable to save this batch. No partial changes were saved.');
  } finally { if (session) await session.endSession(); }
}

async function getActivityLinkHistory(req, res) {
  try {
    if (!['tasks', 'clients'].includes(req.query.mode)) throw fail('Choose a link history type.');
    const { page, limit, skip } = getPagination(req.query);
    const filter = { mode: req.query.mode, ...(!elevated(req.user) ? { actor: req.user._id } : {}) };
    const [history, totalRecords] = await Promise.all([
      ActivityLinkChange.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      ActivityLinkChange.countDocuments(filter),
    ]);
    return res.json({ success: true, history, page, totalRecords, totalPages: Math.max(1, Math.ceil(totalRecords / limit)) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    return sendErrorResponse(res, error, 'Unable to load linking history.');
  }
}

async function ensureActivityLinkHistoryIndexes() {
  await ActivityLinkChange.createCollection();
  await ActivityLinkChange.createIndexes();
}

module.exports = { getActivityLinks, saveActivityLinks, validateLinkRequest, validateTaskLinks, saveBatchActivityLinks, validateBatchLinkRequest, getActivityLinkHistory, ensureActivityLinkHistoryIndexes };
