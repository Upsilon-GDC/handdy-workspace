const mongoose = require("mongoose");
const Employee = require("../../models/Employee");
const Project = require("../../models/Project");
const Task = require("../../models/Task");
const TaskTimeLog = require("../../models/TaskTimeLog");
const Team = require("../../models/Team");
const Client = require("../../models/Client");
const { aggregateBillingLogs, aggregateBillingMembers, DEFAULT_TIMEZONE, getBillingDateRange, getBillingEmployeeAccess } = require("../../utils/billingUtils");

// Billing needs both relationships: `team` is the authoritative assignment
// used by the Team filter, while `teamLead` is retained for access checks and
// older employee records.
const employeeFields = "employeeId fullName email department designation role isActive team teamLead projectRates";

const getAuthorizedEmployee = async (user, requestedId) => {
  const access = getBillingEmployeeAccess(user, requestedId);
  const { targetId } = access;
  if (!mongoose.isValidObjectId(targetId)) return { status: 400, message: "Select a valid employee." };
  if (access.forbidden) {
    return { status: 403, message: "You do not have permission to view billing reports." };
  }
  const employee = await Employee.findOne(access.filter).select(employeeFields).lean();
  if (!employee) {
    return { status: user.role === "team_lead" ? 403 : 404, message: "Employee not found or not available to you." };
  }
  return { employee };
};

const getBillingEmployees = async (req, res) => {
  try {
    const filter = {};
    const employees = await Employee.find(filter).select(employeeFields).sort("fullName").lean();

    const teams = await Team.find({ isActive: true })
        .select("teamName description teamLead isActive")
        .populate("teamLead", "employeeId fullName")
        .sort("teamName")
        .lean();

    return res.status(200).json({ success: true, count: employees.length, employees, teams });
  } catch {
    return res.status(500).json({ success: false, message: "Unable to load billing employees." });
  }
};

const getBillingReport = async (req, res) => {
  try {
    const { employee: employeeId, startDate, endDate } = req.query;
    const allMembers = employeeId === 'all';
    let employees, scope;
    if (allMembers) {
      if (getBillingEmployeeAccess(req.user, '').forbidden) return res.status(403).json({ success: false, message: 'You do not have permission to view billing reports.' });
      const teamId = req.query.team || 'all';
      if (typeof teamId !== 'string' || (!['all', 'unassigned'].includes(teamId) && !mongoose.isValidObjectId(teamId))) return res.status(400).json({ success: false, message: 'Select a valid team.' });
      let team;
      if (!['all', 'unassigned'].includes(teamId)) {
        team = await Team.findById(teamId).select('teamName').lean();
        if (!team) return res.status(404).json({ success: false, message: 'Team not found.' });
      }
      employees = await Employee.find(teamId === 'all' ? {} : { team: teamId === 'unassigned' ? null : teamId }).select(employeeFields).sort('fullName').lean();
      scope = { type: teamId === 'all' ? 'company' : 'team', teamId, label: team?.teamName || (teamId === 'unassigned' ? 'Unassigned employees' : 'All teams') };
    } else {
      const authorization = await getAuthorizedEmployee(req.user, employeeId);
      if (!authorization.employee) return res.status(authorization.status).json({ success: false, message: authorization.message });
      employees = [authorization.employee];
    }

    const timezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
    let range;
    try {
      range = getBillingDateRange(startDate, endDate, timezone);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const logs = await TaskTimeLog.find({
      employee: allMembers ? { $in: employees.map(employee => employee._id) } : employees[0]._id,
      status: "stopped",
      "manualEntry.deletedAt": null,
      startedAt: { $lt: range.endExclusive },
      stoppedAt: { $gt: range.start },
    }).select("employee project task client startedAt stoppedAt pauses totalWorkedSeconds").sort("startedAt").lean();

    const taskIds = [...new Set(logs.map((log) => String(log.task)))];
    const projectIds = [...new Set(logs.map((log) => String(log.project)))];
    const [tasks, projects] = await Promise.all([
      Task.find({ _id: { $in: taskIds } }).select("taskCode taskName description taskType project isActive").lean(),
      Project.find({ _id: { $in: projectIds } }).select("projectCode projectName clientName client clients serviceType status").lean(),
    ]);
    // Preserve missing client references so deleting one client cannot make
    // ambiguous historical work on a shared project look single-client.
    const clientIds = [...new Set([
      ...logs.map((log) => log.client),
      ...projects.flatMap((project) => [...(project.clients || []), project.client]),
    ].filter(Boolean).map(String))];
    const clients = await Client.find({ _id: { $in: clientIds } }).select("clientName").lean();
    const tasksById = new Map(tasks.map((task) => [String(task._id), task]));
    const clientsById = new Map(clients.map((client) => [String(client._id), client]));
    const clientReference = (id) => id ? (clientsById.get(String(id)) || { _id: id, clientName: "Deleted client" }) : null;
    const projectsById = new Map(projects.map((project) => [String(project._id), {
      ...project,
      client: clientReference(project.client),
      clients: (project.clients || []).map(clientReference),
    }]));
    const enrichedLogs = logs.map((log) => ({
      ...log,
      taskRecord: tasksById.get(String(log.task)),
      projectRecord: projectsById.get(String(log.project)),
      clientRecord: clientsById.get(String(log.client)),
    }));

    const logsByEmployee = new Map();
    for (const log of enrichedLogs) {
      const key = String(log.employee); if (!logsByEmployee.has(key)) logsByEmployee.set(key, []);
      logsByEmployee.get(key).push(log);
    }
    const reports = employees.map(employee => aggregateBillingLogs({
      logs: logsByEmployee.get(String(employee._id)) || [],
      employee,
      startDate,
      endDate,
      timezone,
      rangeStart: range.start,
      rangeEnd: range.endExclusive,
    }));
    const report = allMembers ? aggregateBillingMembers({ reports, scope, period: { startDate, endDate, timezone } }) : reports[0];
    return res.status(200).json({ success: true, report });
  } catch (error) {
    return res.status(error.name === "CastError" ? 400 : 500).json({
      success: false,
      message: error.name === "CastError" ? "A billing filter is invalid." : "Unable to generate the billing report.",
    });
  }
};

module.exports = { getBillingEmployees, getBillingReport };
