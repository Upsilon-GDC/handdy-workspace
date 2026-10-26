const TaskTimeLog = require("../models/TaskTimeLog");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Employee = require("../models/Employee");
const Team = require("../models/Team");
const Client = require("../models/Client");
const { getPagination } = require("../utils/requestUtils");
const { getBillingDateRange, getDateKeyInTimezone } = require("../utils/billingUtils");
const sendErrorResponse = require("../utils/sendErrorResponse");
const { isAdminRole } = require("../utils/roles");
const { closeStaleDesktopTimers } = require("../services/desktopTimerLease");
const { recordAttendanceActivity } = require("../services/attendanceService");
const { beginReportSync, changedTimeLogFilter, deltaRows } = require("../services/reportSync");

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
// Expose existing client relationships for reports; no new data or permissions.
const reportProjectPopulation = {
    path: "project",
    select: "projectCode projectName serviceType clientName client clients",
    populate: [
        { path: "client", select: "clientName" },
        { path: "clients", select: "clientName" },
    ],
};

// Builds a `startedAt` range filter from optional startDate/endDate query
// params (YYYY-MM-DD), using APP_TIMEZONE day boundaries — the same helper
// scheduleController.js uses — instead of the server's local time, so a
// report filter means the same calendar day everywhere it's deployed.
const getReportRange = (startDate, endDate) => {
  if (!startDate && !endDate) return null;
  const range = getBillingDateRange(startDate || endDate, endDate || startDate, APP_TIMEZONE);
  return {
    start: startDate ? range.start : null,
    endExclusive: endDate ? range.endExclusive : null,
  };
};

const getRequestedReportRange = ({ startDate, endDate, today }, now = new Date()) => {
    const dateKey = today === "true" ? getDateKeyInTimezone(now, APP_TIMEZONE) : null;
    return {
        dateKey,
        range: getReportRange(dateKey || startDate, dateKey || endDate),
    };
};

const applyReportRangeFilter = (filter, range) => {
  if (!range) return;
  if (range.endExclusive) filter.startedAt = { $lt: range.endExclusive };
  if (range.start) {
    filter.$or = [
      { stoppedAt: { $gt: range.start } },
      ...(range.start < new Date() ? [{ stoppedAt: null }] : []),
    ];
  }
};

const clipTimeLogToRange = (log, range, now = new Date()) => {
  if (log.manualEntry?.deletedAt) return null;
  if (!range) return log;

  const originalStart = new Date(log.startedAt);
  const originalEnd = log.stoppedAt ? new Date(log.stoppedAt) : now;
  const clippedStart = new Date(Math.max(
    originalStart.getTime(),
    range.start?.getTime() ?? originalStart.getTime(),
  ));
  const clippedEnd = new Date(Math.min(
    originalEnd.getTime(),
    range.endExclusive?.getTime() ?? originalEnd.getTime(),
  ));
  if (clippedEnd <= clippedStart) return null;

  const pauses = (log.pauses || []).flatMap((pause) => {
    const pauseStart = new Date(pause.pausedAt);
    const pauseEnd = pause.resumedAt ? new Date(pause.resumedAt) : originalEnd;
    const start = new Date(Math.max(pauseStart.getTime(), clippedStart.getTime()));
    const end = new Date(Math.min(pauseEnd.getTime(), clippedEnd.getTime()));
    if (end <= start) return [];
    return [{ ...pause, pausedAt: start, resumedAt: end }];
  });

  let pauseCursor = clippedStart.getTime();
  let totalPausedSeconds = 0;
  let totalIdleSeconds = 0;
  for (const pause of [...pauses].sort((a, b) => a.pausedAt - b.pausedAt)) {
    const effectiveStart = Math.max(pauseCursor, pause.pausedAt.getTime());
    const effectiveEnd = pause.resumedAt.getTime();
    if (effectiveEnd > effectiveStart) {
      const seconds = Math.floor((effectiveEnd - effectiveStart) / 1000);
      totalPausedSeconds += seconds;
      if (pause.reason === "idle") totalIdleSeconds += seconds;
    }
    pauseCursor = Math.max(pauseCursor, effectiveEnd);
  }
  const totalElapsedSeconds = Math.floor((clippedEnd - clippedStart) / 1000);
  const rangeClosed = Boolean(range.endExclusive && range.endExclusive <= now);
  const remainsOpen = !log.stoppedAt && !rangeClosed;

  return {
    ...log,
    startedAt: clippedStart,
    stoppedAt: remainsOpen ? null : clippedEnd,
    pauses,
    totalPausedSeconds,
    totalIdleSeconds,
    totalWorkedSeconds: Math.max(0, totalElapsedSeconds - totalPausedSeconds),
    status: remainsOpen ? log.status : "stopped",
    isActiveTimer: remainsOpen && log.isActiveTimer,
  };
};

async function prepareTimeLogSync(req, res, filter, range, includeEmployee = false) {
    const sync = await beginReportSync(req, filter, [Project, Task, Client, Employee, Team]);
    if (!sync?.delta) return { sync, handled: false };
    let query = TaskTimeLog.find(changedTimeLogFilter(filter, sync.previous))
        .populate(reportProjectPopulation)
        .populate("client", "clientName")
        .populate("task", "taskCode taskName taskType");
    if (includeEmployee) query = query.populate("employee", "employeeId fullName email department designation role team teamLead");
    const rows = await query.sort("-startedAt").limit(101).lean();
    // Large reconnect batches fall back to the original complete pagination.
    if (rows.length > 100) return { sync, handled: false };
    const { records, removedIds } = deltaRows(rows, (log) =>
        filter.status && filter.status !== log.status ? null : clipTimeLogToRange(log, range));
    res.status(200).json({ success: true, delta: true, timeLogs: records, removedIds,
        sync: sync.marker, timezone: APP_TIMEZONE });
    return { sync, handled: true };
}

// Start Timer
const startTimer = async (req, res) => {
    try {
        const employeeId = req.user._id;
        await closeStaleDesktopTimers(new Date(), employeeId);
        const { project, task, note, client } = req.body;

        if (!project || !task) {
            return res.status(400).json({
                success: false,
                message: "Project and task are required.",
            });
        }

        const projectExists = await Project.findById(project);

        if (!projectExists || projectExists.status !== "Active" || projectExists.deletedAt) {
            return res.status(404).json({
                success: false,
                message: "Project not found.",
            });
        }

        if (client && !await Client.exists({ _id: client, status: "Active" })) {
            return res.status(400).json({ success: false, message: "Select a valid active client." });
        }

        const hasActiveTeam = req.user.team
            ? Boolean(await Team.exists({ _id: req.user.team, isActive: true }))
            : false;
        const teamMatch = { $or: [{ team: req.user.team }, { teams: req.user.team }] };
        const isElevatedRole = isAdminRole(req.user.role) || ["manager", "hr"].includes(req.user.role);
        const projectTeams = (projectExists.teams || []).map(String);
        if (!isElevatedRole && projectTeams.length
            && (!hasActiveTeam || !projectTeams.includes(String(req.user.team)))) {
            return res.status(403).json({ success: false, message: "This project is not available to your team." });
        }
        // A team lead's own team already proves they lead the task's team, so
        // they don't also need to appear in assignedTo (they never can — see
        // validateTaskRelations, which restricts assignedTo to role:"employee").
        const isTeamLead = req.user.role === "team_lead";
        // Being individually named in a task's assignedTo must be sufficient
        // on its own — it must not require the requester to currently have
        // an active team, and must not be gated behind the team-match check
        // the way assignToAllEmployees (which opens a task to a whole team)
        // legitimately is. Elevated roles (admin/manager/hr), who normally
        // carry no team at all, follow the same no-restriction convention
        // used by getTaskVisibility in taskController.js.
        const assignmentScope = isElevatedRole
            ? {}
            : isTeamLead
                ? (hasActiveTeam ? teamMatch : { _id: null })
                : {
                    $or: [
                        { assignedTo: employeeId },
                        ...(hasActiveTeam ? [{ $and: [teamMatch, { assignToAllEmployees: true }] }] : []),
                    ],
                };

        const taskExists = await Task.findOne({
            _id: task,
            isActive: true,
            deletedAt: null,
            $and: [
                assignmentScope,
                { $or: [
                    { project },
                    { project: null, taskType: "work" },
                    { project: null, taskType: "break" },
                ] },
            ],
        });

        if (!taskExists) {
            return res.status(404).json({
                success: false,
                message: "Task not found, not assigned to you, or does not belong to the selected project.",
            });
        }

        const activeTimer = await TaskTimeLog.findOne({
            employee: employeeId,
            status: { $in: ["running", "paused"] },
        });

        if (activeTimer) {
            return res.status(400).json({
                success: false,
                message: "You already have an active timer.",
            });
        }

        const startedAt = new Date();
        const timeLog = await TaskTimeLog.create({
            employee: employeeId,
            project,
            client: client || null,
            task,
            note: typeof note === "string" ? note.trim().slice(0, 2000) : undefined,
            startedAt,
            status: "running",
            isActiveTimer: true,
            desktopHeartbeatAt: req.body?.clientType === "desktop" ? startedAt : null,
        });
        await recordAttendanceActivity(employeeId, startedAt);

        await timeLog.populate("project", "projectCode projectName serviceType");
        await timeLog.populate("client", "clientName");
        await timeLog.populate("task", "taskCode taskName idleLogout taskType");

        return res.status(201).json({
            success: true,
            message: "Timer started successfully.",
            timeLog,
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "You already have an active timer.",
            });
        }
        return sendErrorResponse(res, error, "Unable to start timer.");
    }
};
// A new app instance cannot revive an expired desktop timer.
const heartbeatTimer = async (req, res) => {
    try {
        const employeeId = req.user._id;
        await closeStaleDesktopTimers(new Date(), employeeId);
        const timeLog = await TaskTimeLog.findOneAndUpdate(
            { employee: employeeId, isActiveTimer: true, status: { $in: ["running", "paused"] }, desktopHeartbeatAt: { $type: "date" } },
            { $set: { desktopHeartbeatAt: new Date() } },
            // The API acknowledges only the ID. Avoid downloading notes and
            // the complete pause history from Atlas every twenty seconds.
            { returnDocument: "after", projection: { _id: 1 } },
        );
        if (!timeLog) return res.status(404).json({ success: false, message: "No active desktop timer found." });
        return res.status(200).json({ success: true, timeLogId: timeLog._id });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to confirm desktop timer activity.");
    }
};

// Pause Timer
const pauseTimer = async (req, res) => {
    try {
        const employeeId = req.user._id;
        await closeStaleDesktopTimers(new Date(), employeeId);
        const requestedReason = req.body?.reason;
        const reason = requestedReason === "idle" ? "idle" : requestedReason === "break" ? "break" : "manual";

        const runningTimer = await TaskTimeLog.findOne({ employee: employeeId, status: "running" }).select("task project");

        if (reason === "idle") {
            const taskAllowsIdleLogout = runningTimer
                ? Boolean(await Task.exists({ _id: runningTimer.task, idleLogout: true }))
                : false;
            if (req.user.idleTrackingExempt || !taskAllowsIdleLogout) {
                return res.status(200).json({
                    success: true,
                    skipped: true,
                    message: "Idle tracking is disabled for this employee or task.",
                });
            }
        }

        // Deliberately no re-check here that runningTimer's project is still
        // assigned to the user's team. That check used to 403 pause when a
        // team/project reassignment happened mid-session, but resume/stop
        // have no equivalent check — so a user who hit the 403 on pause
        // could never end their own already-running timer. Eligibility is
        // enforced once, up front, in startTimer's assignmentScope; a later
        // reassignment shouldn't be able to trap a timer the user legitimately
        // started. (This only affects control of an already-running timer —
        // it does not loosen who can *start* a new one.)

        const activeTimer = await TaskTimeLog.findOneAndUpdate(
            {
                employee: employeeId,
                status: "running",
            },
            {
                $push: {
                    pauses: {
                        pausedAt: new Date(),
                        resumedAt: null,
                        reason,
                    },
                },
                $set: { status: "paused" },
            },
            { returnDocument: "after" }
        );

        if (!activeTimer) {
            return res.status(404).json({
                success: false,
                message: "No running timer found.",
            });
        }

        if (typeof activeTimer.populate === "function") {
            await activeTimer.populate("task", "taskCode taskName idleLogout taskType");
        }

        return res.status(200).json({
            success: true,
            message: reason === "idle"
                ? "Timer paused because the system is idle."
                : "Timer paused successfully.",
            timeLog: activeTimer,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to pause timer.");
    }
};
// Resume Timer
const resumeTimer = async (req, res) => {
    try {
        const employeeId = req.user._id;
        await closeStaleDesktopTimers(new Date(), employeeId);
        const requestedReason = req.body?.reason;
        const reason = requestedReason === "idle" ? "idle" : requestedReason === "break" ? "break" : "manual";
        const filter = {
            employee: employeeId,
            status: "paused",
            pauses: {
                $elemMatch: {
                    resumedAt: null,
                    ...(reason === "idle" ? { reason: "idle" } : reason === "break" ? { reason: { $in: ["break", "manual"] } } : {}),
                },
            },
        };
        const pauseFilter = {
            "elem.resumedAt": null,
            ...(reason === "idle" ? { "elem.reason": "idle" } : reason === "break" ? { "elem.reason": { $in: ["break", "manual"] } } : {}),
        };

        const pausedTimer = await TaskTimeLog.findOneAndUpdate(
            filter,
            {
                $set: {
                    "pauses.$[elem].resumedAt": new Date(),
                    status: "running",
                },
            },
            {
                arrayFilters: [pauseFilter],
                returnDocument: "after",
            }
        );

        if (!pausedTimer) {
            return res.status(404).json({
                success: false,
                message: "No paused timer found.",
            });
        }


        if (typeof pausedTimer.populate === "function") {
            await pausedTimer.populate("task", "taskCode taskName idleLogout taskType");
        }

        return res.status(200).json({
            success: true,
            message: reason === "idle"
                ? "Activity detected. Timer resumed automatically."
                : "Timer resumed successfully.",
            timeLog: pausedTimer,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to resume timer.");
    }
};
// Update the note on the employee's own running/paused timer. Notes are no
// longer write-once-at-start: the desktop/web clients let the note be
// edited while the timer is active, so this keeps that edit in sync.
const updateNote = async (req, res) => {
    try {
        const employeeId = req.user._id;
        await closeStaleDesktopTimers(new Date(), employeeId);
        const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";

        const activeTimer = await TaskTimeLog.findOneAndUpdate(
            { employee: employeeId, status: { $in: ["running", "paused"] } },
            { $set: { note } },
            { returnDocument: "after" }
        )
            .populate("project", "projectCode projectName serviceType")
            .populate("task", "taskCode taskName idleLogout taskType");

        if (!activeTimer) {
            return res.status(404).json({
                success: false,
                message: "No active timer found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Note updated successfully.",
            timeLog: activeTimer,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to update note.");
    }
};
// Stop Timer
const stopTimer = async (req, res) => {
    try {
        const employeeId = req.user._id;
        await closeStaleDesktopTimers(new Date(), employeeId);

        const activeTimer = await TaskTimeLog.findOne({
            employee: employeeId,
            status: { $in: ["running", "paused"] },
        });

        if (!activeTimer) {
            return res.status(404).json({
                success: false,
                message: "No active timer found.",
            });
        }

        const stoppedAt = new Date();
        const reportedIdleSeconds = Number(req.body?.idleSeconds);
        if (activeTimer.status === "running" && Number.isInteger(reportedIdleSeconds) && reportedIdleSeconds > 0) {
            const lastPauseEnd = (activeTimer.pauses || []).reduce((latest, pause) =>
                Math.max(latest, new Date(pause.resumedAt || pause.pausedAt).getTime()), activeTimer.startedAt.getTime());
            const idleStart = Math.max(lastPauseEnd, stoppedAt.getTime() - Math.min(reportedIdleSeconds, 12 * 60 * 60) * 1000);
            if (idleStart < stoppedAt.getTime()) {
                activeTimer.pauses.push({ pausedAt: new Date(idleStart), resumedAt: stoppedAt, reason: "idle" });
            }
        }
        let totalPausedSeconds = 0;
        let totalIdleSeconds = 0;

        for (const pause of activeTimer.pauses) {
            const pauseEnd = pause.resumedAt || stoppedAt;

            const pauseSeconds = Math.floor(
                (pauseEnd.getTime() - pause.pausedAt.getTime()) / 1000
            );
            totalPausedSeconds += pauseSeconds;

            if (pause.reason === "idle") {
                totalIdleSeconds += pauseSeconds;
            }

            if (!pause.resumedAt) {
                pause.resumedAt = stoppedAt;
            }
        }

        const totalElapsedSeconds = Math.floor(
            (stoppedAt.getTime() - activeTimer.startedAt.getTime()) / 1000
        );

        const totalWorkedSeconds = Math.max(
            totalElapsedSeconds - totalPausedSeconds,
            0
        );

        activeTimer.stoppedAt = stoppedAt;
        activeTimer.totalPausedSeconds = totalPausedSeconds;
        activeTimer.totalIdleSeconds = totalIdleSeconds;
        activeTimer.totalWorkedSeconds = totalWorkedSeconds;
        activeTimer.status = "stopped";
        activeTimer.isActiveTimer = false;
        if (req.body?.logoutReason === "inactivity") {
            activeTimer.logoutReason = "inactivity";
            activeTimer.autoLogoutAt = stoppedAt;
        } else if (req.body?.logoutReason === "manual") {
            activeTimer.logoutReason = "manual";
        }

        await activeTimer.save();
        await recordAttendanceActivity(employeeId, activeTimer.startedAt);

        return res.status(200).json({
            success: true,
            message: "Timer stopped successfully.",
            timeLog: activeTimer,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to stop timer.");
    }
};
// Get logged-in user's personal time-log history
const getMyTimeLogs = async (req, res) => {
    try {
        await closeStaleDesktopTimers(new Date(), req.user._id);
        const employeeId = req.user._id;

        const { page, limit, skip } = getPagination(req.query);

        const {
            startDate,
            endDate,
            today,
            project,
            task,
            status,
        } = req.query;

        const filter = {
            employee: employeeId,
            "manualEntry.deletedAt": null,
        };

        // Date range filter
        const { dateKey: todayDateKey, range: reportRange } = getRequestedReportRange({
            startDate,
            endDate,
            today,
        });
        applyReportRangeFilter(filter, reportRange);

        // Project filter
        if (project) {
            filter.project = project;
        }

        // Task filter
        if (task) {
            filter.task = task;
        }

        // Timer status filter
        if (status) {
            filter.status = status;
        }

        const { sync, handled } = await prepareTimeLogSync(req, res, filter, reportRange);
        if (handled) return;
        const totalRecords = await TaskTimeLog.countDocuments(filter);

        const rawTimeLogs = await TaskTimeLog.find(filter)
            .populate(reportProjectPopulation)
            .populate("client", "clientName")
            .populate("task", "taskCode taskName taskType")
            .sort("-startedAt")
            .skip(skip)
            .limit(limit)
            .lean();
        const timeLogs = rawTimeLogs
            .map((log) => clipTimeLogToRange(log, reportRange))
            .filter(Boolean);

        return res.status(200).json({
            success: true,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit),
            count: timeLogs.length,
            totalRecords,
            timezone: APP_TIMEZONE,
            date: todayDateKey || undefined,
            ...(sync ? { sync: sync.marker } : {}),
            timeLogs,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch time logs.");
    }
};
// Get Active Timer
const getActiveTimer = async (req, res) => {
    try {
        await closeStaleDesktopTimers(new Date(), req.user._id);
        const employeeId = req.user._id;

        const activeTimer = await TaskTimeLog.findOne({
            employee: employeeId,
            status: { $in: ["running", "paused"] },
        })
            .populate("project", "projectCode projectName serviceType")
            .populate("client", "clientName")
            .populate("task", "taskCode taskName idleLogout taskType");

        return res.status(200).json({
            success: true,
            timeLog: activeTimer || null,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch active timer.");
    }
};

// Active company/team timers used by the live web task trackers.
const getLiveTimers = async (req, res) => {
    try {
        await closeStaleDesktopTimers();
        const filter = { status: { $in: ["running", "paused"] }, isActiveTimer: true };
        if (req.user.role === "team_lead") {
            const teamIds = await Team.find({ teamLead: req.user._id, isActive: true }).distinct("_id");
            const employeeIds = await Employee.find({ team: { $in: teamIds }, isActive: true }).distinct("_id");
            filter.employee = { $in: employeeIds };
        }

        const timeLogs = await TaskTimeLog.find(filter)
            .populate({
                path: "employee",
                select: "employeeId fullName email team",
                populate: { path: "team", select: "teamName" },
            })
            .populate("project", "projectCode projectName clientName")
            .populate("task", "taskCode taskName taskType")
            .sort("-startedAt")
            .lean();

        return res.status(200).json({ success: true, count: timeLogs.length, timeLogs });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch live timers.");
    }
};
// Get time logs for employees assigned to the logged-in Team Lead
const getMyTeamTimeLogs = async (req, res) => {
    try {
        await closeStaleDesktopTimers();
        const teamLeadId = req.user._id;

        const { page, limit, skip } = getPagination(req.query);

        const teamMembers = await Employee.find({
            teamLead: teamLeadId,
            isActive: true,
        }).select("_id");

        const teamMemberIds = teamMembers.map((employee) => employee._id);

        const { startDate, endDate, employee, project, task, status } = req.query;
        const filter = { employee: { $in: teamMemberIds }, "manualEntry.deletedAt": null };

        if (employee) {
            if (!teamMemberIds.some((id) => id.toString() === employee)) {
                return res.status(403).json({ success: false, message: "You cannot view time logs for this employee." });
            }
            filter.employee = employee;
        }
        const reportRange = getReportRange(startDate, endDate);
        applyReportRangeFilter(filter, reportRange);
        if (project) filter.project = project;
        if (task) filter.task = task;
        if (status) filter.status = status;

        const { sync, handled } = await prepareTimeLogSync(req, res, filter, reportRange, true);
        if (handled) return;
        const totalRecords = await TaskTimeLog.countDocuments(filter);
        const rawTimeLogs = await TaskTimeLog.find(filter)
            .populate(
                "employee",
                "employeeId fullName email department designation role team teamLead"
            )
            .populate(reportProjectPopulation)
            .populate("client", "clientName")
            .populate("task", "taskCode taskName taskType")
            .sort("-startedAt")
            .skip(skip)
            .limit(limit)
            .lean();
        const timeLogs = rawTimeLogs
            .map((log) => clipTimeLogToRange(log, reportRange))
            .filter(Boolean);

        return res.status(200).json({
            success: true,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit),
            count: timeLogs.length,
            totalRecords,
            ...(sync ? { sync: sync.marker } : {}),
            timeLogs,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch team time logs.");
    }
};

// Admin - company-wide time logs with report filters
const getAllTimeLogs = async (req, res) => {
    try {
        await closeStaleDesktopTimers();
        const { page, limit, skip } = getPagination(req.query);
        const { startDate, endDate, employee, team, project, task, status } = req.query;
        const filter = { "manualEntry.deletedAt": null };

        const reportRange = getReportRange(startDate, endDate);
        applyReportRangeFilter(filter, reportRange);

        if (team) {
            const teamEmployees = await Employee.find({ team }).select("_id").lean();
            filter.employee = { $in: teamEmployees.map((member) => member._id) };
        }
        if (employee) {
            if (team && !filter.employee.$in.some((id) => String(id) === employee)) {
                return res.status(400).json({ success: false, message: "Employee does not belong to the selected team." });
            }
            filter.employee = employee;
        }
        if (project) filter.project = project;
        if (task) filter.task = task;
        if (status) filter.status = status;

        const { sync, handled } = await prepareTimeLogSync(req, res, filter, reportRange, true);
        if (handled) return;
        const totalRecords = await TaskTimeLog.countDocuments(filter);
        const rawTimeLogs = await TaskTimeLog.find(filter)
            .populate("employee", "employeeId fullName email department designation role team teamLead")
            .populate(reportProjectPopulation)
            .populate("client", "clientName")
            .populate("task", "taskCode taskName taskType")
            .sort("-startedAt")
            .skip(skip)
            .limit(limit)
            .lean();
        const timeLogs = rawTimeLogs
            .map((log) => clipTimeLogToRange(log, reportRange))
            .filter(Boolean);

        return res.status(200).json({
            success: true,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit),
            count: timeLogs.length,
            totalRecords,
            ...(sync ? { sync: sync.marker } : {}),
            timeLogs,
        });
    } catch (error) {
        return sendErrorResponse(res, error, "Unable to fetch time logs.");
    }
};
module.exports = {
    startTimer,
    heartbeatTimer,
    pauseTimer,
    resumeTimer,
    updateNote,
    stopTimer,
    getMyTeamTimeLogs,
    getActiveTimer,
    getLiveTimers,
    getMyTimeLogs,
    getAllTimeLogs,
    clipTimeLogToRange,
    getRequestedReportRange,
};
