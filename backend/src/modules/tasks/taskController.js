const Task = require("../../models/Task");
const Employee = require("../../models/Employee");
const Project = require("../../models/Project");
const Team = require("../../models/Team");
const { escapeRegExp, getPagination } = require("../../utils/requestUtils");
const { resolveTeamsProject } = require("../../utils/taskProjectResolution");
const { isAdminRole } = require("../../utils/roles");
const { userHasPermission } = require("../../services/permissionService");
const { ownTeamIds, teamTaskMatch } = require("../../services/teamScope");

// Admin-level roles and HR work with every team's tasks; team leads and
// employees given task duties work with their own team (services/teamScope.js).
const worksWithAllTeams = (user) => isAdminRole(user.role) || ["manager", "hr"].includes(user.role);
const TASK_DUTIES = ["create_tasks", "edit_tasks", "assign_tasks", "reassign_tasks", "archive_tasks"];
const canManageTasks = (user) => userHasPermission(user, ...TASK_DUTIES);

const normalizeAssignments = (assignedTo) => {
  const values = Array.isArray(assignedTo)
    ? assignedTo
    : assignedTo
    ? [assignedTo]
    : [];
  return [...new Set(values.map(String))];
};

const generateTaskCode = async () => {
  let taskCode;
  do {
    taskCode = `TSK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  } while (await Task.exists({ taskCode }));
  return taskCode;
};

const normalizeTeamIds = (value) => [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean))];

const normalizeTaskName = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
const taskTeamIds = (task) => normalizeTeamIds(task.teams?.length ? task.teams : task.team);
// A work task without a project is offered with every project of its teams,
// so it collides with a same-named task tied to one of those projects.
const projectScopesOverlap = (first, second) => !first || !second || String(first) === String(second);
const taskIdentity = (task) => JSON.stringify([
  normalizeTaskName(task.taskName), task.taskType || "work", taskTeamIds(task).sort(),
]);

// Tasks are duplicates when an employee would see both in the same task list:
// the same name (ignoring case and spacing) and type, a shared team, and an
// overlapping project. Deleted tasks do not count; inactive ones do, because
// they can be reactivated instead.
const findDuplicateTasks = async ({ taskNames, taskType = "work", project = null, teamIds, excludeId = null }) => {
  const names = new Set(taskNames.map(normalizeTaskName));
  const candidates = await Task.find({
    deletedAt: null,
    $or: [{ team: { $in: teamIds } }, { teams: { $in: teamIds } }],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select("taskName taskType project team teams isActive").lean();
  return candidates.filter((task) => names.has(normalizeTaskName(task.taskName))
    && (task.taskType || "work") === taskType
    && projectScopesOverlap(task.project, project)
    && taskTeamIds(task).some((teamId) => teamIds.includes(teamId)));
};

const sendDuplicateTaskError = async (res, duplicates, requestedTeamIds) => {
  const names = [...new Map(duplicates.map((task) => [normalizeTaskName(task.taskName), task.taskName.trim()])).values()];
  const sharedTeamIds = [...new Set(duplicates.flatMap(taskTeamIds))].filter((teamId) => requestedTeamIds.includes(teamId));
  const teams = await Team.find({ _id: { $in: sharedTeamIds } });
  const teamNames = teams.map((team) => team.teamName).filter(Boolean);
  const scope = teamNames.length ? ` for ${teamNames.join(", ")}` : " for the selected team";
  const message = names.length === 1
    ? `A task named "${names[0]}" already exists${scope}.`
    : `Tasks named ${names.map((name) => `"${name}"`).join(", ")} already exist${scope}.`;
  const hint = duplicates.every((task) => task.isActive === false)
    ? " Activate the existing task from the Tasks list instead of creating it again."
    : " Use the existing task instead of creating a duplicate.";
  return res.status(409).json({
    success: false,
    code: "DUPLICATE_TASK",
    message: message + hint,
    duplicates: duplicates.map((task) => ({ _id: task._id, taskName: task.taskName, isActive: task.isActive !== false })),
  });
};

// The duplicate check and the write it guards run one at a time, so two
// identical requests (a double submit or a retried request) cannot both pass
// the check. The API runs as a single instance (render.yaml).
let taskWriteQueue = Promise.resolve();
const serializeTaskWrite = (operation) => {
  const result = taskWriteQueue.then(() => operation());
  taskWriteQueue = result.catch(() => {});
  return result;
};

const getTeamsForTask = async (user, requestedTeams) => {
  if (worksWithAllTeams(user)) {
    const teamIds = normalizeTeamIds(requestedTeams);
    if (!teamIds.length) return { error: "Select at least one team for this task." };
    const teams = await Team.find({ _id: { $in: teamIds }, isActive: true });
    return teams.length === teamIds.length ? { teams, teamIds } : { error: "One or more selected teams are invalid or inactive." };
  }

  const teams = await Team.find({ _id: { $in: await ownTeamIds(user) } });
  if (teams.length !== 1) {
    return { error: teams.length === 0 ? "You are not assigned to an active team." : "Your account must lead exactly one active team." };
  }
  const requestedIds = normalizeTeamIds(requestedTeams);
  if (requestedIds.length && (requestedIds.length !== 1 || requestedIds[0] !== String(teams[0]._id))) {
    return { error: "You cannot create tasks for another team." };
  }
  return { teams, teamIds: [String(teams[0]._id)] };
};

const validateTaskRelations = async ({ project, teams, assignedTo, user }) => {
  if (project) {
    const selectedProject = await Project.findOne({ _id: project, status: "Active", deletedAt: null }).select("teams").lean();
    if (!selectedProject) return "Select an active project.";
    const projectTeams = (selectedProject.teams || []).map(String);
    if (projectTeams.length && teams.some((teamId) => !projectTeams.includes(String(teamId)))) {
      return "The selected project is not assigned to every selected team.";
    }
  }

  if (assignedTo.length === 0) return null;

  const employeeFilter = { _id: { $in: assignedTo }, team: { $in: teams }, role: "employee", isActive: true };

  const validEmployees = await Employee.countDocuments(employeeFilter);
  if (validEmployees !== assignedTo.length) {
    return worksWithAllTeams(user)
      ? "One or more selected employees are invalid or inactive."
      : "Tasks can only be assigned to active members of your team.";
  }

  return null;
};

const prepareTaskCreation = async (user, body) => {
  const taskType = body.taskType || "work";
  if (taskType === "work" && !body.project && !body.allowProjectlessWork) {
    return { error: "Select a project for this work task." };
  }

  const teamResolution = await getTeamsForTask(user, body.teams || body.team);
  if (!teamResolution.teams) return { error: teamResolution.error };

  let project = body.project;
  if (!project && !body.allowProjectlessWork) {
    const resolution = await resolveTeamsProject(teamResolution.teamIds);
    if (resolution.status === "resolved") project = resolution.projectId;
  }

  const normalizedAssignments = normalizeAssignments(body.assignedTo);
  const relationError = await validateTaskRelations({
    project,
    teams: teamResolution.teamIds,
    assignedTo: normalizedAssignments,
    user,
  });
  if (relationError) return { error: relationError };

  return {
    taskType,
    project: project || null,
    team: teamResolution.teamIds[0],
    teams: teamResolution.teamIds,
    assignedTo: body.assignToAllEmployees === true ? [] : normalizedAssignments,
    assignToAllEmployees: body.assignToAllEmployees === true,
    isActive: body.isActive !== undefined ? body.isActive : true,
    idleLogout: Boolean(body.idleLogout),
    createdBy: user._id,
  };
};

// Which tasks a person can see. `manage` adds the tasks of their own team for
// someone with task duties (the task management pages ask for it with
// ?scope=manage); without it an employee sees only the tasks they can work on,
// which is what the desktop app lists.
const getTaskVisibility = async (user, { manage = false } = {}) => {
  if (worksWithAllTeams(user)) return null;

  if (user.role !== "team_lead") {
    // Being individually named in assignedTo must stand on its own —
    // it should not require the employee to currently have an active
    // team. assignToAllEmployees, by contrast, opens the task to a whole
    // team, so that path still needs an active team match. Gating both
    // behind "has an active team" (as before) meant an employee with no
    // team, or whose team was deactivated, lost visibility into tasks
    // they were explicitly assigned to.
    const hasActiveTeam = user.team
      ? Boolean(await Team.exists({ _id: user.team, isActive: true }))
      : false;
    const teamMatch = { $or: [{ team: user.team }, { teams: user.team }] };
    const managed = manage && canManageTasks(user) ? [teamTaskMatch(await ownTeamIds(user))] : [];
    return {
      $or: [
        { assignedTo: user._id },
        ...(hasActiveTeam ? [{ $and: [teamMatch, { assignToAllEmployees: true }] }] : []),
        ...managed,
      ],
    };
  }
  return teamTaskMatch(await ownTeamIds(user));
};

// Editing, archiving and deleting are limited to the person's own team unless
// they work with every team.
const applyTeamLeadMutationScope = async (filter, user) => {
  if (worksWithAllTeams(user)) return filter;
  return { ...filter, ...teamTaskMatch(await ownTeamIds(user)) };
};

// ======================================================
// CREATE TASK
// ======================================================
const createTask = async (req, res) => {
  try {
    const {
      taskCode,
      taskName,
      description,
      taskType,
      project,
      team,
      teams,
      assignedTo,
      assignToAllEmployees,
      isActive,
      idleLogout,
    } = req.body;

    if (!taskName?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Task name is required.",
      });
    }

    const normalizedTaskType = taskType || "work";

    if (normalizedTaskType === "work" && !project) {
      return res.status(400).json({ success: false, message: "Select a project for this work task." });
    }

    const resolvedTaskCode = taskCode?.trim().toUpperCase() || await generateTaskCode();
    const existingTask = await Task.findOne({ taskCode: resolvedTaskCode });

    if (existingTask) {
      return res.status(400).json({
        success: false,
        message: "Task code already exists.",
      });
    }

    const teamResolution = await getTeamsForTask(req.user, teams || team);
    if (!teamResolution.teams) {
      return res.status(400).json({ success: false, message: teamResolution.error });
    }

    // A team's project is inferred from its task history. If there's no
    // history yet (brand-new team) or it's ambiguous (teams historically
    // used different projects), the task is simply created without one —
    // it gets attached the next time any task for that team specifies it.
    let resolvedProject = project;
    if (!resolvedProject) {
      const resolution = await resolveTeamsProject(teamResolution.teamIds);
      if (resolution.status === "resolved") {
        resolvedProject = resolution.projectId;
      }
    }

    const normalizedAssignments = normalizeAssignments(assignedTo);
    const relationError = await validateTaskRelations({
      project: resolvedProject,
      teams: teamResolution.teamIds,
      assignedTo: normalizedAssignments,
      user: req.user,
    });

    if (relationError) {
      return res.status(400).json({ success: false, message: relationError });
    }

    const { task, duplicates } = await serializeTaskWrite(async () => {
      const existing = await findDuplicateTasks({
        taskNames: [taskName],
        taskType: normalizedTaskType,
        project: resolvedProject || null,
        teamIds: teamResolution.teamIds,
      });
      if (existing.length) return { duplicates: existing };
      return { task: await Task.create({
        taskCode: resolvedTaskCode,
        taskName: taskName.trim(),
        description: description?.trim() || "",

        taskType: normalizedTaskType,

        project: resolvedProject || null,
        team: teamResolution.teamIds[0],
        teams: teamResolution.teamIds,

        assignedTo:
          assignToAllEmployees === true
            ? []
            : normalizedAssignments,

        assignToAllEmployees:
          assignToAllEmployees === true,

        isActive:
          isActive !== undefined ? isActive : true,

        idleLogout: Boolean(idleLogout),

        createdBy: req.user._id,
      }) };
    });
    if (duplicates) return sendDuplicateTaskError(res, duplicates, teamResolution.teamIds);

    const populatedTask = await Task.findById(task._id)
      .populate("project", "projectCode projectName serviceType")
      .populate("team", "teamName")
      .populate("teams", "teamName")
      .populate(
        "assignedTo",
        "employeeId fullName email"
      )
      .populate("createdBy", "fullName");

    return res.status(201).json({
      success: true,
      message: "Task created successfully.",
      task: populatedTask,
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// Create task-name/project combinations with one shared access configuration.
const createTasksBulk = async (req, res) => {
  try {
    const taskNames = Array.isArray(req.body.taskNames)
      ? req.body.taskNames.map((name) => String(name || "").trim())
      : [];
    const requestedProjects = normalizeAssignments(req.body.projects);
    const projectIds = requestedProjects.length
      ? requestedProjects
      : [req.body.project].filter(Boolean).map(String);
    const autoProjects = req.body.autoProjects === true;
    const taskCount = taskNames.length * Math.max(projectIds.length, 1);

    if (taskNames.length === 0 || taskNames.some((name) => !name) || (!autoProjects && taskCount < 2)) {
      return res.status(400).json({ success: false, message: "Select at least two tasks or projects for bulk creation." });
    }
    if (new Set(taskNames.map((name) => name.toLowerCase())).size !== taskNames.length) {
      return res.status(400).json({ success: false, message: "Task names in the same batch must be unique." });
    }

    const creationConfigurations = [];
    let projectAssignments;
    if (autoProjects) {
      const selectedTeams = await getTeamsForTask(req.user, req.body.teams || req.body.team);
      if (!selectedTeams.teams) return res.status(400).json({ success: false, message: selectedTeams.error });
      if (req.body.taskType !== "break") {
        const matchingProjects = await Project.find({
          status: "Active", deletedAt: null, teams: { $in: selectedTeams.teamIds },
        }).select("_id teams").lean();
        if (!matchingProjects.length) {
          return res.status(400).json({ success: false, message: "No active projects are assigned to the selected teams." });
        }
        const coveredTeams = new Set(matchingProjects.flatMap((project) => (project.teams || []).map(String)));
        if (selectedTeams.teamIds.some((teamId) => !coveredTeams.has(teamId))) {
          return res.status(400).json({ success: false, message: "Every selected team must have an active project." });
        }
      }
      // A team-wide task is stored once and can be used with any active
      // project available to its teams. The selected project is recorded on
      // the time log when work starts.
      projectAssignments = [{ project: null, teams: selectedTeams.teamIds }];
    } else {
      projectAssignments = (projectIds.length ? projectIds : [null]).map((project) => ({
        project, teams: req.body.teams || req.body.team,
      }));
    }
    for (const { project, teams } of projectAssignments) {
      const creation = await prepareTaskCreation(req.user, {
        ...req.body, project, teams,
        ...(autoProjects ? { assignToAllEmployees: true, assignedTo: [], allowProjectlessWork: true } : {}),
      });
      if (creation.error) {
        return res.status(400).json({ success: false, message: creation.error });
      }
      if (autoProjects) creation.project = null;
      creationConfigurations.push(creation);
    }

    const usedCodes = new Set();
    const tasks = [];
    for (const creation of creationConfigurations) {
      for (const taskName of taskNames) {
        let taskCode;
        do taskCode = await generateTaskCode(); while (usedCodes.has(taskCode));
        usedCodes.add(taskCode);
        tasks.push({
          taskCode,
          taskName,
          description: req.body.description?.trim() || "",
          ...creation,
        });
      }
    }

    const { createdTasks, duplicates } = await serializeTaskWrite(async () => {
      const existing = [];
      for (const creation of creationConfigurations) {
        existing.push(...await findDuplicateTasks({
          taskNames,
          taskType: creation.taskType,
          project: creation.project,
          teamIds: creation.teams,
        }));
      }
      if (existing.length) return { duplicates: [...new Map(existing.map((task) => [String(task._id), task])).values()] };
      return { createdTasks: await Task.insertMany(tasks) };
    });
    if (duplicates) {
      return sendDuplicateTaskError(res, duplicates, [...new Set(creationConfigurations.flatMap((creation) => creation.teams))]);
    }
    return res.status(201).json({
      success: true,
      message: `${createdTasks.length} tasks created successfully.`,
      tasks: createdTasks,
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// ======================================================
// GET ALL TASKS
// ======================================================
const getAllTasks = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const includeAll = req.query.all === "true";

    const search = req.query.search?.trim() || "";
    const taskType =
      req.query.taskType?.trim() || "";
    const project =
      req.query.project?.trim() || "";
    const team = req.query.team?.trim() || "";
    const assignedTo =
      req.query.assignedTo?.trim() || "";
    const active = req.query.active;

    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder =
      req.query.sortOrder === "asc" ? 1 : -1;

    const allowedSortFields = [
      "taskCode",
      "taskName",
      "taskType",
      "createdAt",
      "updatedAt",
    ];

    const safeSortBy = allowedSortFields.includes(
      sortBy
    )
      ? sortBy
      : "createdAt";

    const filter = { deletedAt: null };

    const conditions = [];

    if (search) {
      const safeSearch = escapeRegExp(search);
      conditions.push({ $or: [
        {
          taskCode: {
            $regex: safeSearch,
            $options: "i",
          },
        },
        {
          taskName: {
            $regex: safeSearch,
            $options: "i",
          },
        },
      ] });
    }

    if (taskType) {
      filter.taskType = taskType;
    }

    if (project) {
      conditions.push({
        $or: [
          { project },
          { project: null, taskType: "work" },
        ],
      });
    }

    if (team) {
      filter.$or = [{ team }, { teams: team }];
    }

    if (assignedTo) {
      filter.assignedTo = assignedTo;
    }

    if (active === "true") {
      filter.isActive = true;
    }

    if (active === "false") {
      filter.isActive = false;
    }

    const visibility = await getTaskVisibility(req.user, { manage: req.query.scope === "manage" });
    if (visibility) conditions.push(visibility);
    if (conditions.length > 0) filter.$and = conditions;

    const totalTasks =
      await Task.countDocuments(filter);

    let taskQuery = Task.find(filter)
      .populate(
        "project",
        "projectCode projectName serviceType"
      )
      .populate("team", "teamName")
      .populate("teams", "teamName")
      .populate(
        "assignedTo",
        "employeeId fullName email"
      )
      .populate("createdBy", "fullName")
      .sort({
        [safeSortBy]: sortOrder,
      });

    if (!includeAll) {
      taskQuery = taskQuery.skip(skip).limit(limit);
    }

    const tasks = await taskQuery;

    return res.status(200).json({
      success: true,

      page: includeAll ? 1 : page,
      limit: includeAll ? totalTasks : limit,

      totalPages: includeAll
        ? 1
        : Math.max(Math.ceil(totalTasks / limit), 1),

      count: tasks.length,
      totalTasks,

      tasks,
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// ======================================================
// GET TASK BY ID
// ======================================================
const getTaskById = async (req, res) => {
  try {
    const visibility = await getTaskVisibility(req.user, { manage: true });
    const idFilter = { _id: req.params.id, deletedAt: null };
    if (visibility) idFilter.$and = [visibility];

    const task = await Task.findOne(idFilter)
      .populate(
        "project",
        "projectCode projectName serviceType"
      )
      .populate("team", "teamName")
      .populate("teams", "teamName")
      .populate(
        "assignedTo",
        "employeeId fullName email"
      )
      .populate("createdBy", "fullName");

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }

    return res.status(200).json({
      success: true,
      task,
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// ======================================================
// UPDATE TASK
// ======================================================
const updateTask = async (req, res) => {
  try {
    const mutationFilter = await applyTeamLeadMutationScope(
      { _id: req.params.id, deletedAt: null },
      req.user
    );
    const task = await Task.findOne(mutationFilter);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }
    // Edits that keep the name, type and teams (status, idle logout,
    // assignees) are never blocked by older duplicate records.
    const originalIdentity = taskIdentity(task);

    const {
      taskCode,
      taskName,
      description,
      taskType,
      project,
      team,
      teams,
      assignedTo,
      assignToAllEmployees,
      isActive,
      idleLogout,
    } = req.body;

    if (
      taskCode !== undefined &&
      taskCode.trim().toUpperCase() !==
        task.taskCode
    ) {
      const duplicateTask =
        await Task.findOne({
          taskCode: taskCode
            .trim()
            .toUpperCase(),

          _id: {
            $ne: task._id,
          },
        });

      if (duplicateTask) {
        return res.status(400).json({
          success: false,
          message:
            "Task code already exists.",
        });
      }

      task.taskCode =
        taskCode.trim().toUpperCase();
    }

    if (taskName !== undefined) {
      task.taskName = taskName.trim();
    }

    if (description !== undefined) {
      task.description =
        description.trim();
    }

    if (taskType !== undefined) {
      task.taskType = taskType;
    }

    if (project !== undefined) {
      task.project = project || null;
    }

    const teamResolution = await getTeamsForTask(
      req.user,
      teams !== undefined ? teams : team !== undefined ? team : (task.teams?.length ? task.teams : task.team)
    );
    if (!teamResolution.teams) {
      return res.status(400).json({ success: false, message: teamResolution.error });
    }
    task.team = teamResolution.teamIds[0];
    task.teams = teamResolution.teamIds;

    if (
      assignToAllEmployees !== undefined
    ) {
      task.assignToAllEmployees =
        Boolean(assignToAllEmployees);

      if (task.assignToAllEmployees) {
        task.assignedTo = [];
      }
    }

    if (
      assignedTo !== undefined &&
      !task.assignToAllEmployees
    ) {
      task.assignedTo = Array.isArray(
        assignedTo
      )
        ? assignedTo
        : assignedTo
        ? [assignedTo]
        : [];
    }

    if (isActive !== undefined) {
      task.isActive = Boolean(isActive);
    }

    if (idleLogout !== undefined) {
      task.idleLogout = Boolean(idleLogout);
    }

    const normalizedAssignments = normalizeAssignments(task.assignedTo);
    const relationError = await validateTaskRelations({
      project: task.project,
      teams: task.teams?.length ? task.teams : [task.team],
      assignedTo: normalizedAssignments,
      user: req.user,
    });
    if (relationError) {
      return res.status(400).json({ success: false, message: relationError });
    }

    const duplicates = await serializeTaskWrite(async () => {
      if (taskIdentity(task) !== originalIdentity) {
        const existing = await findDuplicateTasks({
          taskNames: [task.taskName],
          taskType: task.taskType,
          project: task.project,
          teamIds: taskTeamIds(task),
          excludeId: task._id,
        });
        if (existing.length) return existing;
      }
      await task.save();
      return null;
    });
    if (duplicates) return sendDuplicateTaskError(res, duplicates, taskTeamIds(task));

    const updatedTask =
      await Task.findById(task._id)
        .populate(
          "project",
          "projectCode projectName serviceType"
        )
        .populate("team", "teamName")
        .populate("teams", "teamName")
        .populate(
          "assignedTo",
          "employeeId fullName email"
        )
        .populate(
          "createdBy",
          "fullName"
        );

    return res.status(200).json({
      success: true,
      message: "Task updated successfully.",
      task: updatedTask,
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// ======================================================
// DELETE TASK
// ======================================================
const deleteTask = async (req, res) => {
  try {
    const mutationFilter = await applyTeamLeadMutationScope(
      { _id: req.params.id, deletedAt: null },
      req.user
    );
    const task = await Task.findOne(mutationFilter);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }

    task.isActive = false;
    task.deletedAt = new Date();
    await task.save();

    return res.status(200).json({
      success: true,
      message: "Task deleted successfully.",
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// ======================================================
// TOGGLE ACTIVE / INACTIVE
// ======================================================
const toggleTaskStatus = async (req, res) => {
  try {
    const mutationFilter = await applyTeamLeadMutationScope(
      { _id: req.params.id, deletedAt: null },
      req.user
    );
    const task = await Task.findOne(mutationFilter);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found.",
      });
    }

    task.isActive = !task.isActive;

    await task.save();

    return res.status(200).json({
      success: true,

      message: task.isActive
        ? "Task activated successfully."
        : "Task deactivated successfully.",

      task,
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// ======================================================
// RESOLVE PROJECT FOR TEAM(S)
// ======================================================
const resolveProjectForTeams = async (req, res) => {
  try {
    const teamsParam = req.query.teams ? req.query.teams.split(",") : [];
    const teamResolution = await getTeamsForTask(req.user, teamsParam);
    if (!teamResolution.teams) {
      return res.status(400).json({ success: false, message: teamResolution.error });
    }

    const resolution = await resolveTeamsProject(teamResolution.teamIds);

    let project = null;
    if (resolution.status === "resolved") {
      project = await Project.findById(resolution.projectId).select("projectCode projectName serviceType");
    }

    return res.status(200).json({
      success: true,
      status: resolution.status,
      projectId: resolution.projectId,
      project,
      conflictingProjects: resolution.conflictingProjects || [],
    });
  } catch (error) {
    return handleTaskError(res, error);
  }
};

// ======================================================
// ERROR HANDLER
// ======================================================
const handleTaskError = (res, error) => {
  console.error(
    "Task Controller Error:",
    error
  );

  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: "Task code already exists.",
    });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Invalid task data.",
    });
  }

  if (error.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid ID provided.",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Unable to process the task request.",
  });
};

module.exports = {
  createTask,
  createTasksBulk,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  toggleTaskStatus,
  resolveProjectForTeams,
};
