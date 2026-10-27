const Task = require("../../models/Task");
const { userHasPermission } = require("../../services/permissionService");

const idList = (value) => (Array.isArray(value) ? value : value ? [value] : [])
  .map((item) => String(item?._id || item)).sort();
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const deny = (res) => res.status(403).json({
  success: false,
  message: "You do not have permission to assign tasks.",
});

// "Create tasks" alone adds tasks for the whole team (what the Add task form
// does). Picking particular employees instead needs "reassign_tasks", the
// same permission that changes the assignment later. ("assign_tasks" used to
// be required as well; it was folded into "create_tasks" on 2026-10-27.)
const guardTaskAssignmentOnCreate = async (req, res, next) => {
  try {
    const picksEmployees = idList(req.body?.assignedTo).length > 0;
    if (picksEmployees && !userHasPermission(req.user, "reassign_tasks")) return deny(res);
    return next();
  } catch (error) {
    return next(error);
  }
};

// Editing a task only needs "reassign_tasks" when the assignment actually
// changes, so an edit form that re-submits unchanged assignees still works.
const guardTaskReassignment = async (req, res, next) => {
  try {
    const body = req.body || {};
    const touches = body.assignedTo !== undefined || body.assignToAllEmployees !== undefined;
    if (!touches || userHasPermission(req.user, "reassign_tasks")) return next();
    const task = await Task.findById(req.params.id).select("assignedTo assignToAllEmployees").lean();
    if (!task) return next(); // The controller reports the 404.
    const assigneeChanged = body.assignedTo !== undefined
      && !sameIds(idList(body.assignedTo), idList(task.assignedTo));
    const allChanged = body.assignToAllEmployees !== undefined
      && Boolean(body.assignToAllEmployees) !== Boolean(task.assignToAllEmployees);
    return assigneeChanged || allChanged ? deny(res) : next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { guardTaskAssignmentOnCreate, guardTaskReassignment };
