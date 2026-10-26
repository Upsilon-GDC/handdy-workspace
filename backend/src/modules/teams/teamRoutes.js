const express = require("express");

const {
  protect,
} = require("../../middleware/authMiddleware");

const {
  authorizeRolesOrPermissions,
  requirePermission,
} = require("../../middleware/authorizeRoles");

const { userHasPermission } = require("../../services/permissionService");
const Team = require("../../models/Team");
const Employee = require("../../models/Employee");
const { syncEmployeeTeam } = require("../../services/teamAssignmentService");
const { escapeRegExp } = require("../../utils/requestUtils");

const router = express.Router();

// Changing a team's lead needs "assign_team_leads" on top of "edit_teams";
// re-submitting the unchanged lead (the edit form always sends it) is allowed.
const guardTeamLeadChange = async (req, res, next) => {
  try {
    if (req.body?.teamLead === undefined || userHasPermission(req.user, "assign_team_leads")) return next();
    const team = await Team.findById(req.params.id).select("teamLead").lean();
    if (!team) return next();
    const requested = req.body.teamLead ? String(req.body.teamLead) : "";
    const current = team.teamLead ? String(team.teamLead) : "";
    if (requested === current) return next();
    return res.status(403).json({ success: false, message: "You do not have permission to assign team leads." });
  } catch (error) {
    return next(error);
  }
};

// ======================================
// GET ALL TEAMS
// GET /api/teams
// ======================================
// Team names and leads, for every screen that picks or filters by team.
router.get(
  "/",
  protect,
  authorizeRolesOrPermissions({ roles: ["hr"], permissions: [
    "create_employees", "edit_employees", "create_teams", "edit_teams", "assign_team_leads",
    "manage_projects", "view_all_reports",
  ] }),
  async (req, res) => {
    try {
      const teams = await Team.find()
        .populate(
          "teamLead",
          "employeeId fullName email"
        )
        .populate(
          "createdBy",
          "employeeId fullName"
        )
        .sort({
          createdAt: -1,
        });

      return res.status(200).json({
        success: true,
        count: teams.length,
        teams,
      });
    } catch (error) {
      console.error(
        "Get teams error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to get teams.",
      });
    }
  }
);

// ======================================
// CREATE TEAM
// POST /api/teams
// ======================================
router.post(
  "/",
  protect,
  requirePermission("create_teams"),
  async (req, res) => {
    try {
      const {
        teamName,
        description,
        teamLead,
        isActive,
      } = req.body;

      if (
        !teamName ||
        !teamName.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Team name is required.",
        });
      }

      const existingTeam =
        await Team.findOne({
          teamName: {
            $regex:
              `^${escapeRegExp(teamName.trim())}$`,
            $options: "i",
          },
        });

      if (existingTeam) {
        return res.status(400).json({
          success: false,
          message:
            "Team already exists.",
        });
      }

      if (teamLead) {
        const validLead = await Employee.exists({
          _id: teamLead,
          role: "team_lead",
          isActive: true,
        });
        if (!validLead) {
          return res.status(400).json({
            success: false,
            message: "Selected Team Lead is invalid or inactive.",
          });
        }
      }

      const team =
        await Team.create({
          teamName:
            teamName.trim(),

          description:
            description?.trim() || "",

          teamLead: null,

          isActive:
            typeof isActive === "boolean"
              ? isActive
              : true,

          createdBy:
            req.user._id,
        });

      if (teamLead) {
        const lead = await Employee.findById(teamLead);
        await syncEmployeeTeam(lead, team._id);
      }

      const populatedTeam =
        await Team.findById(
          team._id
        )
          .populate(
            "teamLead",
            "employeeId fullName email"
          )
          .populate(
            "createdBy",
            "employeeId fullName"
          );

      return res.status(201).json({
        success: true,
        message:
          "Team created successfully.",
        team: populatedTeam,
      });
    } catch (error) {
      console.error(
        "Create team error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create team.",
      });
    }
  }
);

router.put(
  "/:id",
  protect,
  requirePermission("edit_teams"),
  guardTeamLeadChange,
  async (req, res) => {
    try {
      const team = await Team.findById(req.params.id);
      if (!team) {
        return res.status(404).json({ success: false, message: "Team not found." });
      }

      const { teamName, description, teamLead, isActive } = req.body;
      const previousLeadId = team.teamLead ? String(team.teamLead) : null;
      if (teamName !== undefined) {
        const normalizedName = String(teamName).trim();
        if (!normalizedName) {
          return res.status(400).json({ success: false, message: "Team name is required." });
        }
        const duplicate = await Team.exists({
          _id: { $ne: team._id },
          teamName: { $regex: `^${escapeRegExp(normalizedName)}$`, $options: "i" },
        });
        if (duplicate) {
          return res.status(409).json({ success: false, message: "Team already exists." });
        }
        team.teamName = normalizedName;
      }

      if (teamLead) {
        const validLead = await Employee.exists({ _id: teamLead, role: "team_lead", isActive: true });
        if (!validLead) {
          return res.status(400).json({ success: false, message: "Selected Team Lead is invalid or inactive." });
        }
      }
      if (description !== undefined) team.description = String(description).trim();
      if (isActive !== undefined) team.isActive = Boolean(isActive);
      await team.save();

      if (teamLead !== undefined) {
        if (teamLead) {
          const lead = await Employee.findById(teamLead);
          await syncEmployeeTeam(lead, team._id);
        } else {
          team.teamLead = null;
          await team.save();
          await Employee.updateMany({ team: team._id }, { $set: { teamLead: null } });
          if (previousLeadId) {
            await Employee.updateOne(
              { _id: previousLeadId, team: team._id },
              { $set: { team: null, teamLead: null } }
            );
          }
        }
      }

      const populated = await Team.findById(team._id)
        .populate("teamLead", "employeeId fullName email")
        .populate("createdBy", "employeeId fullName");
      return res.status(200).json({ success: true, message: "Team updated successfully.", team: populated });
    } catch (error) {
      return res.status(error.name === "CastError" ? 400 : 500).json({
        success: false,
        message: error.name === "CastError" ? "Invalid team ID." : "Unable to update team.",
      });
    }
  }
);

router.delete(
  "/:id",
  protect,
  requirePermission("edit_teams"),
  async (req, res) => {
    try {
      const team = await Team.findById(req.params.id);
      if (!team) {
        return res.status(404).json({ success: false, message: "Team not found." });
      }
      team.isActive = false;
      await team.save();
      return res.status(200).json({ success: true, message: "Team deactivated successfully." });
    } catch (error) {
      return res.status(error.name === "CastError" ? 400 : 500).json({
        success: false,
        message: error.name === "CastError" ? "Invalid team ID." : "Unable to deactivate team.",
      });
    }
  }
);

module.exports = router;
