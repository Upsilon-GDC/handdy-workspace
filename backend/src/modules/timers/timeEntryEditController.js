const mongoose = require('mongoose');
const TaskTimeLog = require('../../models/TaskTimeLog');
const Employee = require('../../models/Employee');
const Project = require('../../models/Project');
const Client = require('../../models/Client');
const Task = require('../../models/Task');
const TimeEntryEdit = require('../../models/TimeEntryEdit');
const { isAdminRole } = require('../../utils/roles');
const { activityOptionsForEmployee, validateActivitySelection } = require('../../services/activitySelection');
const { normalizeEntrySegments, entrySnapshot, fail } = require('../../services/timeEntryEditing');
const { syncAttendanceForDay } = require('../../services/attendanceService');
const { getDateKeyInTimezone } = require('../../utils/billingUtils');
const sendErrorResponse = require('../../utils/sendErrorResponse');
const id = value => String(value?._id || value || '');
const allowed = (req, res) => {
  if (isAdminRole(req.user?.role)) return true;
  res.status(403).json({ success: false, message: 'Only Admin, Alpha and Managers can edit time entries.' });
  return false;
};
const editable = record => record && record.status === 'stopped' && record.stoppedAt && record.isActiveTimer !== true && !record.manualEntry?.deletedAt;
async function getTimeEntryForEdit(req, res) {
  if (!allowed(req, res)) return;
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw fail('Invalid time entry ID.');
    const record = await TaskTimeLog.findById(req.params.id).lean();
    if (!record || record.manualEntry?.deletedAt) throw fail('Time entry not found.', 404);
    if (!editable(record)) throw fail('Stop the active timer before editing this entry.', 409);
    const employee = await Employee.findById(record.employee).select('fullName employeeId role team isActive').lean();
    if (!employee) throw fail('The entry employee no longer exists.', 404);
    const projects = [], tasks = [], clientMap = new Map();
    if (employee.isActive) {
      const candidates = await Project.find({ status: 'Active', deletedAt: null }).select('projectName projectCode teams client clients activityMappingEnabled linkedTasks').sort('projectName').lean();
      const choices = await Promise.all(candidates.map(project => activityOptionsForEmployee(project, employee)));
      candidates.forEach((project, index) => {
        const options = choices[index];
        if (!options?.tasks.length) return;
        projects.push({ _id: project._id, projectName: project.projectName, clientIds: options.clients.map(client => id(client)), mappingEnabled: options.mappingEnabled });
        tasks.push(...options.tasks);
        options.clients.forEach(client => clientMap.set(id(client), client));
      });
    }
    const [oldProject, oldTask, oldClient, history] = await Promise.all([
      Project.findById(record.project).select('projectName').lean(),
      Task.findById(record.task).select('taskName taskCode taskType').lean(),
      record.client ? Client.findById(record.client).select('clientName').lean() : null,
      TimeEntryEdit.find({ timeLog: record._id }).sort({ revision: -1 }).limit(20).select('revision reason editedBy createdAt').populate('editedBy', 'fullName').lean(),
    ]);
    // Retain historical choices for time-only corrections, even if archived.
    const project = projects.find(project => id(project) === id(record.project));
    if (!project) projects.push({ _id: record.project, projectName: oldProject?.projectName || 'Previous project', clientIds: record.client ? [id(record.client)] : [], mappingEnabled: false });
    else if (record.client && !project.clientIds.includes(id(record.client))) project.clientIds.push(id(record.client));
    if (record.client && !clientMap.has(id(record.client))) clientMap.set(id(record.client), { _id: record.client, clientName: oldClient?.clientName || 'Previous client' });
    const task = tasks.find(task => id(task) === id(record.task) && id(task.project) === id(record.project));
    if (!task) tasks.push({ _id: record.task, taskName: oldTask?.taskName || 'Previous task', taskType: oldTask?.taskType || 'work', project: record.project, clientIds: record.client ? [id(record.client)] : [] });
    else if (record.client && task.clientIds && !task.clientIds.includes(id(record.client))) task.clientIds.push(id(record.client));
    return res.json({ success: true, record: { ...record, task: { _id: record.task, taskName: oldTask?.taskName || 'Previous task', taskType: oldTask?.taskType || 'work' } },
      employee, options: { projects, tasks, clients: [...clientMap.values()] }, history });
  } catch (error) { return respond(res, error); }
}
function respond(res, error) {
  if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
  return sendErrorResponse(res, error, 'Unable to edit the entry. No partial correction was saved.');
}
async function editTimeEntry(req, res) {
  if (!allowed(req, res)) return;
  let session;
  try {
    const body = req.body || {};
    if (!mongoose.isObjectIdOrHexString(req.params.id) || !mongoose.isObjectIdOrHexString(body.project) || !mongoose.isObjectIdOrHexString(body.task)
      || (body.client && !mongoose.isObjectIdOrHexString(body.client))) throw fail('Choose valid project, client and task IDs.');
    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || !body.expectedUpdatedAt || !Number.isFinite(+new Date(body.expectedUpdatedAt))) throw fail('Reload the entry before editing.');
    if (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 500) throw fail('Enter a correction reason of 5–500 characters.');
    if (typeof body.note !== 'string' || body.note.length > 2000) throw fail('The note must contain at most 2000 characters.');
    const initial = await TaskTimeLog.findById(req.params.id).select('employee').lean();
    if (!initial) throw fail('Time entry not found.', 404);
    session = await mongoose.startSession();
    let revision;
    await session.withTransaction(async () => {
      // Different entries for the same employee also contend, not just this ID.
      const locked = await Employee.updateOne({ _id: initial.employee }, { $inc: { timeEntryEditVersion: 1 } }, { session });
      if (!locked.matchedCount) throw fail('The entry employee no longer exists.', 404);
      const record = await TaskTimeLog.findById(req.params.id).session(session).lean();
      if (!editable(record)) throw fail('Only completed, non-deleted entries can be edited.', 409);
      if (id(record.employee) !== id(initial.employee) || (record.editVersion || 0) !== body.expectedVersion || +new Date(record.updatedAt) !== +new Date(body.expectedUpdatedAt)) throw fail('This entry changed in another window. Reload before saving.', 409);
      const unchangedTuple = id(record.project) === body.project && id(record.task) === body.task && id(record.client) === (body.client || '');
      let mapping = record.activityMapping;
      const selectedTask = await Task.findById(body.task).select('taskType').session(session).lean();
      if (!selectedTask) throw fail('The selected task no longer exists.');
      if (!unchangedTuple) {
        const employee = await Employee.findById(record.employee).select('role team isActive').session(session).lean();
        if (!employee?.isActive) throw fail('Keep the original activity for an inactive employee.');
        const project = await Project.findOne({ _id: body.project, status: 'Active', deletedAt: null }).session(session).lean();
        if (!project) throw fail('Select an active project.');
        const options = await activityOptionsForEmployee(project, employee);
        const task = options?.tasks.find(task => id(task) === body.task);
        if (!task || (body.client && !options.clients.some(client => id(client) === body.client))) throw fail('This activity is not available to the employee.');
        const selection = await validateActivitySelection(project, body.client, body.task, employee);
        if (selection.error) throw fail(selection.error);
        mapping = selection.mapping || undefined;
      }
      const values = normalizeEntrySegments(body.segments, selectedTask.taskType);
      const conflict = await TaskTimeLog.exists({ _id: { $ne: record._id }, employee: record.employee, 'manualEntry.deletedAt': null,
        startedAt: { $lt: values.stoppedAt }, $or: [{ stoppedAt: null }, { stoppedAt: { $gt: values.startedAt } }] }).session(session);
      if (conflict) throw fail('These times overlap another entry or active timer for this employee.', 409);
      const changes = { ...values, project: body.project, client: body.client || null, task: body.task, note: body.note.trim() };
      if (mapping) changes.activityMapping = mapping;
      revision = (record.editVersion || 0) + 1;
      const updated = await TaskTimeLog.updateOne({ _id: record._id, status: 'stopped', isActiveTimer: { $ne: true }, updatedAt: record.updatedAt },
        { $set: changes, $inc: { editVersion: 1 }, ...(!mapping ? { $unset: { activityMapping: '' } } : {}) }, { session, runValidators: true });
      if (!updated.matchedCount) throw fail('This entry changed while saving. Reload before retrying.', 409);
      // Snapshot the actual cast/persisted document, not browser string IDs.
      const after = await TaskTimeLog.findById(record._id).session(session).lean();
      await TimeEntryEdit.create([{ timeLog: record._id, employee: record.employee, revision, editedBy: req.user._id,
        reason: body.reason.trim(), before: entrySnapshot(record), after: entrySnapshot(after) }], { session });
      const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
      const days = new Set([getDateKeyInTimezone(record.startedAt, timezone), getDateKeyInTimezone(values.startedAt, timezone)]);
      for (const day of days) await syncAttendanceForDay(record.employee, day, timezone, session);
    });
    return res.json({ success: true, revision, message: 'Entry updated. Reports and attendance now use the corrected values.' });
  } catch (error) { return respond(res, error); }
  finally { if (session) await session.endSession(); }
}
async function ensureTimeEntryEditIndexes() {
  await TimeEntryEdit.createCollection();
  await TimeEntryEdit.createIndexes();
}
module.exports = { getTimeEntryForEdit, editTimeEntry, ensureTimeEntryEditIndexes };
