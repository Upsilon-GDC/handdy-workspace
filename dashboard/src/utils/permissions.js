// Admin-level roles always hold every permission (backend utils/roles.js).
export const ADMIN_ROLES = ["admin", "alpha", "manager"];

export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

// Names shown when a page or action is unavailable. They match the labels on
// the Permissions page (backend utils/permissions.js).
export const PERMISSION_LABELS = {
  create_tasks: "Create tasks",
  edit_tasks: "Edit tasks",
  assign_tasks: "Assign tasks",
  reassign_tasks: "Reassign tasks",
  archive_tasks: "Archive tasks",
  add_manual_entries: "Add manual timesheet entries",
  create_teams: "Create teams",
  edit_teams: "Edit teams",
  assign_team_leads: "Assign team leads",
  view_team_timesheets: "View team timesheets",
  manage_clients: "Create/edit clients",
  manage_projects: "Create/edit projects",
  view_all_reports: "View all employee reports",
  export_reports: "Export Excel/PDF",
  view_billing_amounts: "View billing amounts",
};

export const permissionNames = (keys) => keys
  .map((key) => `“${PERMISSION_LABELS[key] || key}”`)
  .join(" and ");

// Tooltip for a control the signed-in role cannot use.
export const missingPermissionHint = (keys) =>
  `You need the ${permissionNames(keys)} permission${keys.length === 1 ? "" : "s"}. Ask an administrator or manager.`;

// The task form always assigns new tasks to the whole team, so creating one
// needs both permissions (backend middleware/taskPermissions.js).
export const TASK_CREATE_PERMISSIONS = ["create_tasks", "assign_tasks"];

// Task-management permissions the signed-in role lacks, for a page note.
export const missingTaskPermissions = (hasPermission) =>
  [...TASK_CREATE_PERMISSIONS, "edit_tasks", "archive_tasks"].filter((key) => !hasPermission(key));
