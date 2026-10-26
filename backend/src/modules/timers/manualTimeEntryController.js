const mongoose = require("mongoose");
const TaskTimeLog = require("../../models/TaskTimeLog");
const Project = require("../../models/Project");
const Task = require("../../models/Task");
const Employee = require("../../models/Employee");
const Team = require("../../models/Team");
const Client = require("../../models/Client");
const sendErrorResponse = require("../../utils/sendErrorResponse");
const { isAdminRole } = require("../../utils/roles");
const { recordAttendanceActivity } = require("../../services/attendanceService");

const MAX_ENTRY_SECONDS = 24 * 60 * 60;
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;
const ELEVATED_ROLES = ["manager", "hr"];

const isElevated = (employee) => isAdminRole(employee.role) || ELEVATED_ROLES.includes(employee.role);
const toId = (value) => String(value?._id || value || "");

// Validates the user-supplied fields and returns the cleaned values, or the
// first problem as `error`. Pure so it can be unit tested.
function validateManualEntryInput(body = {}, now = new Date()) {
  for (const field of ["employee", "project", "task"]) {
    if (!mongoose.isValidObjectId(body[field])) return { error: `Select a valid ${field}.` };
  }
  if (body.client && !mongoose.isValidObjectId(body.client)) return { error: "Select a valid client." };

  const startedAt = new Date(body.startedAt);
  const stoppedAt = new Date(body.stoppedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime())) {
    return { error: "Enter a valid start and end time." };
  }
  if (stoppedAt <= startedAt) return { error: "End time must be after start time." };
  if (stoppedAt > now) return { error: "Manual entries cannot end in the future." };
  const seconds = Math.floor((stoppedAt - startedAt) / 1000);
  if (seconds > MAX_ENTRY_SECONDS) return { error: "A single entry cannot be longer than 24 hours." };

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_REASON_LENGTH) return { error: `Enter a reason of at least ${MIN_REASON_LENGTH} characters.` };
  if (reason.length > MAX_REASON_LENGTH) return { error: `The reason cannot exceed ${MAX_REASON_LENGTH} characters.` };

  return {
    value: {
      employee: String(body.employee),
      project: String(body.project),
      task: String(body.task),
      client: body.client ? String(body.client) : null,
      startedAt,
      stoppedAt,
      seconds,
      reason,
    },
  };
}

// Who may correct whose time. Admin, alpha, manager and HR act on every
// employee (product decision, 2026-10-23); a team lead only on the employees
// of the team they lead; anyone else given the permission only on the
// employees of their own team. Nobody but the elevated roles acts on
// themselves. The route separately requires the add_manual_entries
// permission, which managers always hold.
async function canActOnEmployee(actor, target) {
  if (!actor?._id || !target?._id) return false;
  if (["alpha", "admin", "manager", "hr"].includes(actor.role)) return true;
  if (target.role !== "employee" || toId(actor) === toId(target)) return false;
  if (actor.role === "team_lead") {
    if (toId(target.teamLead) === toId(actor)) return true;
    if (!target.team) return false;
    return Boolean(await Team.exists({ _id: target.team, teamLead: actor._id, isActive: true }));
  }
  if (!actor.team || toId(actor.team) !== toId(target.team)) return false;
  return Boolean(await Team.exists({ _id: actor.team, isActive: true }));
}

// The same eligibility rules startTimer applies, so a manual entry can never
// book time against a project/task the employee could not have timed.
async function buildEmployeeScope(employee) {
  const hasActiveTeam = employee.team ? Boolean(await Team.exists({ _id: employee.team, isActive: true })) : false;
  const teamMatch = { $or: [{ team: employee.team }, { teams: employee.team }] };
  const projectFilter = { status: "Active", deletedAt: null };
  let taskScope = {};
  if (!isElevated(employee)) {
    taskScope = employee.role === "team_lead"
      ? (hasActiveTeam ? teamMatch : { _id: null })
      : { $or: [{ assignedTo: employee._id }, ...(hasActiveTeam ? [{ $and: [teamMatch, { assignToAllEmployees: true }] }] : [])] };
  }
  return { hasActiveTeam, projectFilter, taskScope, restrictProjectsToTeam: !isElevated(employee) };
}

const projectAllowedForTeam = (project, scope, employee) => {
  const teams = (project.teams || []).map(toId);
  return !scope.restrictProjectsToTeam || teams.length === 0
    || (scope.hasActiveTeam && teams.includes(toId(employee.team)));
};

const projectClientIds = (project) => [...new Set(
  [...(project.clients || []), project.client].filter(Boolean).map(toId),
)];

const loadTargetEmployee = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return Employee.findById(id).select("employeeId fullName role team teamLead isActive");
};

// GET /api/time-logs/manual/options?employee=<id>
// One request supplies the whole Client -> Project -> Task picker for an
// employee, so the modal filters locally instead of calling per selection.
const getManualEntryOptions = async (req, res) => {
  try {
    const employee = await loadTargetEmployee(req.query.employee);
    if (!employee || !employee.isActive) return res.status(404).json({ success: false, message: "Active employee not found." });
    if (!await canActOnEmployee(req.user, employee)) {
      return res.status(403).json({ success: false, message: "You cannot add entries for this employee." });
    }

    const scope = await buildEmployeeScope(employee);
    const allProjects = await Project.find(scope.projectFilter)
      .select("projectCode projectName client clients clientName teams").sort("projectName").lean();
    const candidateProjects = allProjects.filter((project) => projectAllowedForTeam(project, scope, employee));
    const projectIds = candidateProjects.map((project) => project._id);
    const tasks = projectIds.length === 0 ? [] : await Task.find({
      isActive: true,
      deletedAt: null,
      taskType: "work",
      project: { $in: projectIds },
      ...scope.taskScope,
    }).select("taskCode taskName project").sort("taskName").lean();

    // Show only projects with a real, eligible linked work task. An open
    // project without assignments is not an employee's work option.
    const taskProjectIds = new Set(tasks.map((task) => toId(task.project)));
    const projects = candidateProjects.filter((project) => taskProjectIds.has(toId(project)));
    const clientIds = [...new Set(projects.flatMap(projectClientIds))];
    const clients = await Client.find({ _id: { $in: clientIds }, status: "Active" })
      .select("clientName").sort("clientName").lean();
    const activeClientIds = new Set(clients.map(toId));

    return res.status(200).json({
      success: true,
      employee: { _id: employee._id, employeeId: employee.employeeId, fullName: employee.fullName },
      clients,
      projects: projects.map((project) => ({
        _id: project._id,
        projectCode: project.projectCode,
        projectName: project.projectName,
        clientIds: projectClientIds(project).filter((id) => activeClientIds.has(id)),
      })),
      tasks: tasks.map((task) => ({ _id: task._id, taskCode: task.taskCode, taskName: task.taskName, project: task.project })),
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to load the manual entry options.");
  }
};

// POST /api/time-logs/manual
const createManualEntry = async (req, res) => {
  try {
    const { value, error } = validateManualEntryInput(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const employee = await loadTargetEmployee(value.employee);
    if (!employee || !employee.isActive) {
      return res.status(404).json({ success: false, message: "Active employee not found." });
    }
    if (!await canActOnEmployee(req.user, employee)) {
      return res.status(403).json({ success: false, message: "You cannot add entries for this employee." });
    }

    const scope = await buildEmployeeScope(employee);
    const project = await Project.findOne({ _id: value.project, ...scope.projectFilter })
      .select("client clients teams").lean();
    if (!project || !projectAllowedForTeam(project, scope, employee)) {
      return res.status(400).json({ success: false, message: "This project is not available to the selected employee." });
    }
    const task = await Task.findOne({
      _id: value.task, isActive: true, deletedAt: null, taskType: "work", project: value.project, ...scope.taskScope,
    }).select("_id").lean();
    if (!task) {
      return res.status(400).json({ success: false, message: "This task is not assigned to the employee or does not belong to the selected project." });
    }
    if (value.client) {
      const belongs = projectClientIds(project).includes(value.client);
      if (!belongs || !await Client.exists({ _id: value.client, status: "Active" })) {
        return res.status(400).json({ success: false, message: "The selected client does not belong to this project." });
      }
    }

    // Overlap (which also covers exact duplicates). An open timer has no
    // stoppedAt and is treated as running to the present.
    const conflict = await TaskTimeLog.findOne({
      employee: employee._id,
      "manualEntry.deletedAt": null,
      startedAt: { $lt: value.stoppedAt },
      $or: [{ stoppedAt: null }, { stoppedAt: { $gt: value.startedAt } }],
    }).select("startedAt stoppedAt entrySource").lean();
    if (conflict) {
      return res.status(409).json({
        success: false,
        message: "This entry overlaps an existing time record for the employee. Choose a time range with no existing session.",
        conflict: { startedAt: conflict.startedAt, stoppedAt: conflict.stoppedAt, manual: conflict.entrySource === "manual" },
      });
    }

    const createdAt = new Date();
    const timeLog = await TaskTimeLog.create({
      employee: employee._id,
      project: value.project,
      client: value.client,
      task: value.task,
      startedAt: value.startedAt,
      stoppedAt: value.stoppedAt,
      status: "stopped",
      isActiveTimer: false,
      totalWorkedSeconds: value.seconds,
      totalPausedSeconds: 0,
      totalIdleSeconds: 0,
      pauses: [],
      note: `Manual entry: ${value.reason}`.slice(0, 2000),
      entrySource: "manual",
      manualEntry: { createdBy: req.user._id, createdAt, reason: value.reason },
    });
    await recordAttendanceActivity(employee._id, value.startedAt);

    console.info("[manual-entry] created", JSON.stringify({
      log: String(timeLog._id), employee: String(employee._id), by: String(req.user._id), seconds: value.seconds,
    }));

    const populated = await TaskTimeLog.findById(timeLog._id)
      .populate({
        path: "project",
        select: "projectCode projectName serviceType clientName client clients",
        populate: [{ path: "client", select: "clientName" }, { path: "clients", select: "clientName" }],
      })
      .populate("client", "clientName")
      .populate("task", "taskCode taskName taskType")
      .populate("employee", "employeeId fullName email department designation")
      .lean();

    return res.status(201).json({ success: true, message: "Manual entry added.", timeLog: populated });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to add the manual entry.");
  }
};

// DELETE /api/time-logs/manual/:id. Retain the entry and its authorship as an
// audit record, but remove its hours from reports and billing. Timer records
// can never be deleted through this endpoint.
const deleteManualEntry = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Select a valid manual entry." });
    }
    const entry = await TaskTimeLog.findOne({ _id: req.params.id, entrySource: "manual", "manualEntry.deletedAt": null })
      .select("employee status isActiveTimer startedAt").lean();
    if (!entry) return res.status(404).json({ success: false, message: "Manual entry not found." });
    const employee = await loadTargetEmployee(toId(entry.employee));
    if (!employee || !await canActOnEmployee(req.user, employee)) {
      return res.status(403).json({ success: false, message: "You cannot delete entries for this employee." });
    }
    if (entry.status !== "stopped" || entry.isActiveTimer) {
      return res.status(409).json({ success: false, message: "Only completed manual entries can be deleted." });
    }
    const deleted = await TaskTimeLog.findOneAndUpdate({
      _id: entry._id, employee: employee._id, entrySource: "manual", status: "stopped", isActiveTimer: false,
      "manualEntry.deletedAt": null,
    }, { $set: { "manualEntry.deletedAt": new Date(), "manualEntry.deletedBy": req.user._id } },
    { returnDocument: "after", projection: { _id: 1 } });
    if (!deleted) return res.status(409).json({ success: false, message: "This manual entry has already changed. Refresh the report." });
    await recordAttendanceActivity(employee._id, entry.startedAt);
    console.info("[manual-entry] deleted", JSON.stringify({ log: toId(deleted), employee: toId(employee), by: toId(req.user) }));
    return res.status(200).json({ success: true, message: "Manual entry deleted.", timeLogId: deleted._id });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to delete the manual entry.");
  }
};

module.exports = {
  MAX_ENTRY_SECONDS,
  canActOnEmployee,
  createManualEntry,
  deleteManualEntry,
  getManualEntryOptions,
  validateManualEntryInput,
};
