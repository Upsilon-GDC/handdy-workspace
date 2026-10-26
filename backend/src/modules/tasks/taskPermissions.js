const Task = require("../../models/Task");
const { userHasPermission } = require("../../services/permissionService");

const idList = (value) => (Array.isArray(value) ? value : value ? [value] : [])
  .map((item) => String(item?._id || item)).sort();
const sameIds = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const deny = (res) => res.status(403).json({
  success: false,
  message: "You do not have permission to assign tasks.",
});

// Creating a task with assignees needs "assign_tasks".
const guardTaskAssignmentOnCreate = async (req, res, next) => {
  try {
    const assigns = idList(req.body?.assignedTo).length > 0
      || req.body?.assignToAllEmployees === true
      || req.body?.autoProjects === true;
    if (assigns && !userHasPermission(req.user, "assign_tasks")) return deny(res);
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
