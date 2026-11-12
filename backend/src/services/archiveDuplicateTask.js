const mongoose = require('mongoose');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Mapping = require('../models/ActivityMapping');
const Log = require('../models/TaskTimeLog');
const Revision = require('../models/ProductionSettingsRevision');
const id = value => String(value?._id || value || '');
const sorted = values => [...new Set((values || []).map(id))].sort();
const fail = message => Object.assign(new Error(message), { statusCode: 409 });
function signature(task) {
  return JSON.stringify({ name: task.taskName.trim().replace(/\s+/g, ' ').toLowerCase(), type: task.taskType || 'work',
    primaryTeam: id(task.team), teams: sorted([task.team, ...(task.teams || [])].filter(Boolean)), project: id(task.project),
    assignedTo: sorted(task.assignedTo), allEmployees: !!task.assignToAllEmployees, idleLogout: !!task.idleLogout, description: task.description || '' });
}
async function archiveDuplicateTask({ keepId, retireId, apply = false, backup }) {
  if (!mongoose.isObjectIdOrHexString(keepId) || !mongoose.isObjectIdOrHexString(retireId) || id(keepId) === id(retireId)) throw fail('Choose two distinct valid task IDs.');
  if (apply && typeof backup !== 'function') throw fail('A before-change backup is required.');
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const tasks = await Task.find({ _id: { $in: [keepId, retireId] } }).session(session).lean();
      const keep = tasks.find(row => id(row) === id(keepId)), retire = tasks.find(row => id(row) === id(retireId));
      if (!keep || !retire || !keep.isActive || !retire.isActive || keep.deletedAt || retire.deletedAt) throw fail('Both tasks must still be active.');
      if (signature(keep) !== signature(retire)) throw fail('Task team, project, type, behavior or assignments differ; keep both.');
      if (![keep.team, ...(keep.teams || [])].some(Boolean)) throw fail('A team assignment is required to prove duplication.');
      if (await Log.exists({ task: retire._id, status: { $in: ['running', 'paused'] } }).session(session)) throw fail('The redundant task has a live timer; retry after it stops.');
      if (await Revision.exists({ kind: 'classification', $or: [{ 'values.target': retire._id }, { 'values.target': id(retire) }, { key: { $regex: `:task:${id(retire)}$` } }] }).session(session)) throw fail('The redundant task has classification history; review it separately.');
      const linked = await Project.find({ linkedTasks: retire._id }).select('linkedTasks').session(session).lean();
      if (linked.some(project => !project.linkedTasks.some(task => id(task) === id(keep)))) throw fail('A project links only to the redundant task; keep its existing relationship.');
      const mappings = await Mapping.find({ task: { $in: [keep._id, retire._id] } }).session(session).lean();
      const retiredMappings = mappings.filter(row => id(row.task) === id(retire) && row.isActive);
      if (retiredMappings.some(row => !mappings.some(other => id(other.task) === id(keep) && other.isActive && id(other.project) === id(row.project) && id(other.client) === id(row.client)))) throw fail('The redundant task has a distinct active client/project link.');
      const logCount = await Log.countDocuments({ task: retire._id }).session(session);
      result = { applied: apply, keepId: id(keep), retireId: id(retire), name: keep.taskName, historicalLogsPreserved: logCount, mappingsToDeactivate: retiredMappings.length };
      if (!apply) return;
      await backup({ tasks, mappings, plan: result });
      const changed = await Task.updateOne({ _id: retire._id, updatedAt: retire.updatedAt, isActive: true, deletedAt: null }, { $set: { isActive: false, deletedAt: new Date() } }, { session });
      if (changed.modifiedCount !== 1) throw fail('The task changed during cleanup; no cleanup was committed.');
      if (retiredMappings.length) await Mapping.updateMany({ _id: { $in: retiredMappings.map(row => row._id) } }, { $set: { isActive: false } }, { session });
    });
    return result;
  } finally { await session.endSession(); }
}
module.exports = { archiveDuplicateTask, signature };
