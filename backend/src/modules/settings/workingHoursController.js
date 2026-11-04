const mongoose = require('mongoose');
const Employee = require('../../models/Employee');
const Attendance = require('../../models/Attendance');
const TaskTimeLog = require('../../models/TaskTimeLog');
const WorkingHoursPolicy = require('../../models/WorkingHoursPolicy');
const { getDateKeyInTimezone, dateKeyToUtc, addDateKeyDays } = require('../../utils/billingUtils');
const { fail, id, validDate, hoursToSeconds, policyOnDate, buildWorkingHoursOverview } = require('../../services/workingHours');
const sendErrorResponse = require('../../utils/sendErrorResponse');
const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const today = () => getDateKeyInTimezone(new Date(), timezone);
function sendError(res, error) {
  if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
  if (error.code === 11000) return res.status(409).json({ success: false, message: 'Working hours changed in another window. Reload and try again.' });
  return sendErrorResponse(res, error, 'Unable to process working hours.');
}
function selectedEmployees(body) {
  if (!Array.isArray(body.employeeIds) || !body.employeeIds.length || body.employeeIds.length > 500
    || body.employeeIds.some(value => typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value))) throw fail('Select 1–500 valid employees.');
  const values = body.employeeIds.map(value => value.toLowerCase());
  if (new Set(values).size !== values.length) throw fail('Select each employee once.');
  return values;
}
async function employeesQuery(filter = {}) {
  return Employee.find({ role: { $ne: 'alpha' }, ...filter }).select('employeeId fullName role team isActive').populate('team', 'teamName').sort('fullName').lean();
}
async function getWorkingHoursSettings(req, res) {
  try {
    const date = validDate(req.query.date || today());
    const [employees, policies, attendance] = await Promise.all([employeesQuery(), WorkingHoursPolicy.find({}).lean(), Attendance.find({ date }).select('employee workingHoursAdjustments').lean()]);
    const policyMap = new Map(policies.map(row => [id(row.employee), row]));
    const attendanceMap = new Map(attendance.map(row => [id(row.employee), row]));
    return res.json({ success: true, date, timezone, employees: employees.map(employee => ({ ...employee,
      version: policyMap.get(id(employee))?.version || 0,
      policy: policyOnDate(policyMap.get(id(employee)), date),
      history: policyMap.get(id(employee))?.revisions || [],
      adjustment: attendanceMap.get(id(employee))?.workingHoursAdjustments?.at(-1) || null,
    })) });
  } catch (error) { return sendError(res, error); }
}
async function saveWorkingHoursSettings(req, res) {
  let session;
  try {
    const employeeIds = selectedEmployees(req.body);
    const effectiveFrom = validDate(req.body.effectiveFrom);
    if (effectiveFrom < today()) throw fail('Changes must start today or later to preserve past requirements.');
    const requiredSeconds = hoursToSeconds(req.body.requiredHours);
    const halfDayPercent = req.body.halfDayPercent;
    if (!Number.isInteger(halfDayPercent) || halfDayPercent < 1 || halfDayPercent > 100) throw fail('Half-day percentage must be an integer from 1 to 100.');
    if (!Array.isArray(req.body.versions) || req.body.versions.length !== employeeIds.length
      || req.body.versions.some(row => !row || !employeeIds.includes(row.employee) || !Number.isSafeInteger(row.version) || row.version < 0)
      || new Set(req.body.versions.map(row => row.employee)).size !== employeeIds.length) throw fail('Reload current employee versions before saving.');
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const employees = await Employee.find({ _id: { $in: employeeIds }, role: { $ne: 'alpha' } }).select('_id').session(session).lean();
      if (employees.length !== employeeIds.length) throw fail('Some employees no longer exist. Reload the list.', 409);
      const policies = await WorkingHoursPolicy.find({ employee: { $in: employeeIds } }).session(session).lean();
      for (const employee of [...employeeIds].sort()) {
        const policy = policies.find(row => id(row.employee) === employee);
        const expected = req.body.versions.find(row => row.employee === employee).version;
        if ((policy?.version || 0) !== expected) throw fail('Working hours changed in another window. Reload before saving.', 409);
        const revision = { effectiveFrom, requiredSeconds, halfDayPercent, changedBy: req.user._id, changedAt: new Date() };
        if (policy) await WorkingHoursPolicy.updateOne({ _id: policy._id, version: expected }, { $push: { revisions: revision }, $inc: { version: 1 } }, { session, runValidators: true });
        else await WorkingHoursPolicy.create([{ employee, version: 1, revisions: [revision] }], { session });
      }
    });
    return res.json({ success: true, message: `Working hours saved for ${employeeIds.length} employees from ${effectiveFrom}.` });
  } catch (error) { return sendError(res, error); }
  finally { if (session) await session.endSession(); }
}
async function saveWorkingHoursAdjustment(req, res) {
  let session;
  try {
    const employeeIds = selectedEmployees(req.body), date = validDate(req.body.date);
    if (!['normal', 'half_day', 'leave', 'absent'].includes(req.body.type)) throw fail('Choose normal attendance, half day, approved leave or absent.');
    if (typeof req.body.reason !== 'string' || req.body.reason.trim().length < 3 || req.body.reason.trim().length > 500) throw fail('Enter a reason of 3–500 characters.');
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      if (await Employee.countDocuments({ _id: { $in: employeeIds }, role: { $ne: 'alpha' } }).session(session) !== employeeIds.length) throw fail('Some employees no longer exist.', 409);
      for (const employee of [...employeeIds].sort()) {
        await Attendance.updateOne({ employee, date }, {
          $setOnInsert: { status: 'Absent', source: 'check_in' },
          $push: { workingHoursAdjustments: { type: req.body.type, reason: req.body.reason.trim(), changedBy: req.user._id, changedAt: new Date() } },
        }, { session, upsert: true, runValidators: true });
      }
    });
    return res.json({ success: true, message: `Daily exceptions saved for ${employeeIds.length} employees. Existing check-in and timer records are preserved.` });
  } catch (error) { return sendError(res, error); }
  finally { if (session) await session.endSession(); }
}
async function getWorkingHoursOverview(req, res) {
  try {
    const date = validDate(req.query.date || today());
    if (date > today()) throw fail('Choose today or an earlier date for productivity.');
    const team = req.query.team;
    if (team && team !== 'unassigned' && !mongoose.isObjectIdOrHexString(team)) throw fail('Choose a valid team.');
    const now = Date.now(), start = dateKeyToUtc(date, timezone), end = dateKeyToUtc(addDateKeyDays(date, 1), timezone);
    const employees = await employeesQuery(team ? { team: team === 'unassigned' ? null : team } : {});
    const employeeIds = employees.map(row => row._id);
    const [policies, attendance, logs] = await Promise.all([
      WorkingHoursPolicy.find({ employee: { $in: employeeIds } }).lean(),
      Attendance.find({ employee: { $in: employeeIds }, date }).select('employee status workingHoursAdjustments').lean(),
      TaskTimeLog.find({ employee: { $in: employeeIds }, startedAt: { $lt: end },
        $or: [{ stoppedAt: { $gt: start } }, { stoppedAt: null, status: { $in: ['running', 'paused'] } }],
        'manualEntry.deletedAt': null }).select('employee startedAt stoppedAt status desktopHeartbeatAt pauses task manualEntry.deletedAt').populate('task', 'taskType').lean(),
    ]);
    return res.json({ success: true, timezone, ...buildWorkingHoursOverview({ employees, policies, attendance, logs, date, start, end, now }) });
  } catch (error) { return sendError(res, error); }
}
async function ensureWorkingHoursIndexes() {
  await WorkingHoursPolicy.createCollection();
  await WorkingHoursPolicy.createIndexes();
}
module.exports = { getWorkingHoursSettings, saveWorkingHoursSettings, saveWorkingHoursAdjustment, getWorkingHoursOverview, ensureWorkingHoursIndexes };
