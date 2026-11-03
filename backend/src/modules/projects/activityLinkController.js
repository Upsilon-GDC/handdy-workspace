const mongoose = require('mongoose');
const Project = require('../../models/Project');
const Client = require('../../models/Client');
const Task = require('../../models/Task');
const ActivityMapping = require('../../models/ActivityMapping');
const { ownTeamIds, teamTaskMatch } = require('../../services/teamScope');
const { isAdminRole } = require('../../utils/roles');
const sendErrorResponse = require('../../utils/sendErrorResponse');

const id = value => String(value?._id || value || '');
const ids = values => [...new Set(values.map(id))];
const projectClients = project => ids([...(project.clients || []), project.client].filter(Boolean));
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const elevated = user => isAdminRole(user.role) || user.role === 'hr';
const taskScope = async user => elevated(user) ? {} : teamTaskMatch(await ownTeamIds(user));

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
    if (task.project && id(task.project) !== id(project)) throw fail('A selected task belongs to another project.');
    const teams = ids(task.teams?.length ? task.teams : task.team ? [task.team] : []);
    // A mapping narrows a shared task to this project; it never changes assignments.
    if (projectTeams.length && !teams.some(team => projectTeams.includes(team))) throw fail('A selected task has no team in common with this project.');
  }
}

async function getActivityLinks(req, res) {
  try {
    const scope = await taskScope(req.user);
    const [projects, clients, tasks] = await Promise.all([
      Project.find({ status: 'Active', deletedAt: null }).select('projectName projectCode client clients teams activityLinksVersion activityMappingEnabled').sort('projectName').lean(),
      Client.find({ status: 'Active' }).select('clientName').sort('clientName').lean(),
      Task.find({ isActive: true, deletedAt: null, ...scope }).select('taskName taskCode taskType project team teams assignToAllEmployees').populate('teams', 'teamName').populate('team', 'teamName').sort('taskName').lean(),
    ]);
    const mappings = await ActivityMapping.find({ isActive: true, task: { $in: tasks.map(task => task._id) } }).select('project client task').lean();
    return res.json({ success: true, projects, clients, tasks, mappings });
  } catch (error) { return sendErrorResponse(res, error, 'Unable to load activity links.'); }
}

async function saveActivityLinks(req, res) {
  let session;
  try {
    const input = validateLinkRequest(req.body);
    const scope = await taskScope(req.user);
    session = await mongoose.startSession();
    let nextVersion;
    await session.withTransaction(async () => {
      const project = await Project.findOne({ _id: input.project, status: 'Active', deletedAt: null }).session(session).lean();
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

module.exports = { getActivityLinks, saveActivityLinks, validateLinkRequest, validateTaskLinks };
