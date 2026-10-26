const Project = require("../../models/Project");
const Client = require("../../models/Client");
const Team = require("../../models/Team");
const { escapeRegExp, getPagination } = require("../../utils/requestUtils");
const { isAdminRole } = require("../../utils/roles");
const { userHasPermission } = require("../../services/permissionService");
const sendErrorResponse = require("../../utils/sendErrorResponse");

const handleProjectError = (res, error) => {
  if (error.code === 11000) {
    return res.status(409).json({ success: false, message: "Project code already exists." });
  }
  return sendErrorResponse(res, error, "Unable to process the project request.");
};

const generateProjectCode = async () => {
  let projectCode;
  do {
    projectCode = `PRJ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  } while (await Project.exists({ projectCode }));
  return projectCode;
};

const normalizeClientIds = (value) => [...new Set((Array.isArray(value) ? value : value ? [value] : [])
  .map(String)
  .filter(Boolean))];

const resolveProjectClients = async (value) => {
  const ids = normalizeClientIds(value);
  if (!ids.length) return { error: "Select at least one active client." };
  const clients = await Client.find({ _id: { $in: ids }, status: "Active" }).select("clientName");
  return clients.length === ids.length
    ? { clients, ids }
    : { error: "One or more selected clients are invalid or inactive." };
};

const normalizeTeamIds = (value) => [...new Set((Array.isArray(value) ? value : value ? [value] : [])
  .map(String)
  .filter(Boolean))];

const resolveProjectTeams = async (value) => {
  const ids = normalizeTeamIds(value);
  if (!ids.length) return { error: "Select at least one active team." };
  const teams = await Team.find({ _id: { $in: ids }, isActive: true }).select("teamName");
  return teams.length === ids.length
    ? { teams, ids }
    : { error: "One or more selected teams are invalid or inactive." };
};

// Employees and team leads see their team's projects, unless they manage
// projects or read company reports, which cover every project.
const applyProjectVisibility = (filter, user) => {
  if (isAdminRole(user.role) || !["employee", "team_lead"].includes(user.role)) return filter;
  if (userHasPermission(user, "manage_projects", "view_all_reports")) return filter;
  const teamId = user.team;
  const visibility = teamId
    ? { $or: [{ teams: teamId }, { teams: { $exists: false } }, { teams: { $size: 0 } }] }
    : { $or: [{ teams: { $exists: false } }, { teams: { $size: 0 } }] };

  if (!filter.$or) return { ...filter, ...visibility };
  const searchConditions = filter.$or;
  const { $or, ...rest } = filter;
  return { ...rest, $and: [{ $or: searchConditions }, visibility] };
};

// Create Project
const createProject = async (req, res) => {
  try {
    const payload = { ...req.body };
    payload.projectCode = payload.projectCode?.trim() || await generateProjectCode();
    // The employee selects the client when starting work. Older callers may
    // still link clients, but a link is no longer required at creation time.
    if (payload.clients?.length || payload.client) {
      const clientResolution = await resolveProjectClients(payload.clients || payload.client);
      if (clientResolution.error) return res.status(400).json({ success: false, message: clientResolution.error });
      payload.clients = clientResolution.ids;
      payload.client = clientResolution.ids[0];
      payload.clientName = clientResolution.clients.map((client) => client.clientName).join(", ");
    } else {
      payload.clients = [];
      payload.client = null;
      payload.clientName = "";
    }
    const teamResolution = await resolveProjectTeams(payload.teams);
    if (teamResolution.error) return res.status(400).json({ success: false, message: teamResolution.error });
    payload.teams = teamResolution.ids;
    const project = await Project.create({
      ...payload,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Project created successfully.",
      project,
    });
  } catch (error) {
    return handleProjectError(res, error);
  }
};

// Get All Projects
const getAllProjects = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const search = req.query.search || "";
    const status = req.query.status || "";

    const filter = { deletedAt: null };

    if (search) {
      const safeSearch = escapeRegExp(search);
      filter.$or = [
        { projectCode: { $regex: safeSearch, $options: "i" } },
        { projectName: { $regex: safeSearch, $options: "i" } },
        { clientName: { $regex: safeSearch, $options: "i" } },
      ];
    }

    if (status) {
      filter.status = status;
    }

    const visibleFilter = applyProjectVisibility(filter, req.user);
    const totalProjects = await Project.countDocuments(visibleFilter);

    const projects = await Project.find(visibleFilter)
      .populate("createdBy", "fullName email")
      .populate("client", "clientName status")
      .populate("clients", "clientName status")
      .populate("teams", "teamName isActive")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(totalProjects / limit),
      count: projects.length,
      totalProjects,
      projects,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch projects.");
  }
};

// Get Project By ID
const getProjectById = async (req, res) => {
  try {
    const project = await Project.findOne(applyProjectVisibility({ _id: req.params.id, deletedAt: null }, req.user))
      .populate("createdBy", "fullName email")
      .populate("client", "clientName status")
      .populate("clients", "clientName status")
      .populate("teams", "teamName isActive");

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found.",
      });
    }

    return res.status(200).json({
      success: true,
      project,
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to fetch the project.");
  }
};

// Update Project
const updateProject = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, deletedAt: null });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found.",
      });
    }

    const updates = { ...req.body };
    if (updates.clients !== undefined || updates.client !== undefined) {
      const clientResolution = await resolveProjectClients(updates.clients || updates.client);
      if (clientResolution.error) return res.status(400).json({ success: false, message: clientResolution.error });
      updates.clients = clientResolution.ids;
      updates.client = clientResolution.ids[0];
      updates.clientName = clientResolution.clients.map((client) => client.clientName).join(", ");
    }
    if (updates.teams !== undefined) {
      const teamResolution = await resolveProjectTeams(updates.teams);
      if (teamResolution.error) return res.status(400).json({ success: false, message: teamResolution.error });
      updates.teams = teamResolution.ids;
    }
    const updatedProject = await Project.findByIdAndUpdate(
      req.params.id,
      updates,
      {
        returnDocument: "after",
        runValidators: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Project updated successfully.",
      project: updatedProject,
    });
  } catch (error) {
    return handleProjectError(res, error);
  }
};

// Delete Project
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, deletedAt: null });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found.",
      });
    }

    project.status = "Completed";
    project.deletedAt = new Date();
    await project.save();

    return res.status(200).json({
      success: true,
      message: "Project deleted successfully.",
    });
  } catch (error) {
    return sendErrorResponse(res, error, "Unable to delete the project.");
  }
};

module.exports = {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
};
