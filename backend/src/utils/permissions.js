// Catalog of role-configurable permissions.
//
// Admin-level roles (admin, alpha, manager - see utils/roles.js) always hold
// every permission and are not configurable, which preserves the existing
// "managers inherit admin" policy. The roles below are configurable. Their
// DEFAULT_ROLE_PERMISSIONS reproduce what the routes allowed before this
// catalog existed (plus later product decisions noted below), so nothing
// changes until an administrator edits a role.
//
// `enforcement` tells the Permissions screen how honest each checkbox is:
//   "backend"  - checked by an API middleware/guard (the dashboard also hides
//                the matching menus and buttons)
//   "frontend" - only controls UI (e.g. exports are generated in the browser)
//   "none"     - catalogued for future use; switching it changes nothing yet
//
// `roles` lists the configurable roles a permission can have an effect for.
// Omitted means every configurable role. Grants for other roles are ignored
// (and dropped when a role is saved) because no screen or endpoint could ever
// use them, so the switch would only mislead the administrator.
const CONFIGURABLE_ROLES = ["hr", "team_lead", "employee"];

const TASK_MANAGERS = ["hr", "team_lead"];
const HR_ONLY = ["hr"];

const PERMISSION_CATEGORIES = [
  {
    key: "tasks",
    label: "Task permissions",
    permissions: [
      { key: "view_tasks", label: "View tasks", enforcement: "none",
        description: "Not used yet. Everyone already sees the tasks assigned to them." },
      { key: "create_tasks", label: "Create tasks", enforcement: "backend", roles: TASK_MANAGERS,
        description: "Shows “Add task”. New tasks are assigned to the whole team, so “Assign tasks” is also required. Team leads can only create tasks for their own team." },
      { key: "edit_tasks", label: "Edit tasks", enforcement: "backend", roles: TASK_MANAGERS,
        description: "Edit task names, type and teams. Team leads can only edit their own team's tasks." },
      { key: "assign_tasks", label: "Assign tasks", enforcement: "backend", roles: TASK_MANAGERS,
        description: "Assign tasks to employees. Required together with “Create tasks”." },
      { key: "reassign_tasks", label: "Reassign tasks", enforcement: "backend", roles: TASK_MANAGERS,
        description: "Change who an existing task is assigned to." },
      { key: "complete_tasks", label: "Complete tasks", enforcement: "none",
        description: "Not used yet. There is no task completion feature." },
      { key: "archive_tasks", label: "Archive tasks", enforcement: "backend", roles: TASK_MANAGERS,
        description: "Activate, deactivate and delete tasks." },
      { key: "view_task_timesheets", label: "View task timesheets", enforcement: "none",
        description: "Not used yet." },
      { key: "add_manual_entries", label: "Add manual timesheet entries", enforcement: "backend", sensitive: true, roles: TASK_MANAGERS,
        description: "Add and delete back-filled time entries. HR can add entries for every employee; team leads only for employees on their team." },
    ],
  },
  {
    key: "teams",
    label: "Team permissions",
    permissions: [
      { key: "view_teams", label: "View teams", enforcement: "none",
        description: "Not used yet." },
      { key: "create_teams", label: "Create teams", enforcement: "backend", roles: HR_ONLY,
        description: "Create teams on the Teams page." },
      { key: "edit_teams", label: "Edit teams", enforcement: "backend", roles: HR_ONLY,
        description: "Rename, edit and deactivate teams." },
      { key: "assign_team_members", label: "Assign employees to teams", enforcement: "none", sensitive: true,
        description: "Not used yet. Team membership is changed by editing an employee." },
      { key: "remove_team_members", label: "Remove employees from teams", enforcement: "none", sensitive: true,
        description: "Not used yet. Team membership is changed by editing an employee." },
      { key: "assign_team_leads", label: "Assign team leads", enforcement: "backend", sensitive: true, roles: HR_ONLY,
        description: "Change a team's lead. Also requires “Edit teams”." },
      { key: "view_team_timesheets", label: "View team timesheets", enforcement: "backend", roles: ["team_lead"],
        description: "Team leads see their team's overview, timesheets and reports." },
      { key: "view_team_productivity", label: "View team productivity reports", enforcement: "none",
        description: "Not used yet." },
    ],
  },
  {
    key: "clients_projects",
    label: "Client and project permissions",
    permissions: [
      { key: "view_clients", label: "View clients", enforcement: "none",
        description: "Not used yet. Client names are always listed so employees can start timers." },
      { key: "manage_clients", label: "Create/edit clients", enforcement: "backend", roles: HR_ONLY,
        description: "Add, rename and deactivate clients." },
      { key: "view_projects", label: "View projects", enforcement: "none",
        description: "Not used yet. Projects are always listed so employees can start timers." },
      { key: "manage_projects", label: "Create/edit projects", enforcement: "backend", roles: HR_ONLY,
        description: "Add, edit and delete projects, including their clients and teams." },
      { key: "assign_projects", label: "Assign projects", enforcement: "none",
        description: "Not used yet. Project teams are set with “Create/edit projects”." },
    ],
  },
  {
    key: "reports_billing",
    label: "Reports and billing permissions",
    permissions: [
      { key: "view_personal_reports", label: "View personal reports", enforcement: "none",
        description: "Not used yet. Everyone can see their own timesheet." },
      { key: "view_team_reports", label: "View team reports", enforcement: "none",
        description: "Not used yet. Team reports follow “View team timesheets”." },
      { key: "view_all_reports", label: "View all employee reports", enforcement: "backend", roles: HR_ONLY,
        description: "Company-wide overview, timesheets and reports for every employee." },
      { key: "export_reports", label: "Export Excel/PDF", enforcement: "frontend",
        description: "Shows the Export Excel and Export PDF buttons. Exports are built in the browser from data the person can already see." },
      { key: "view_billing_amounts", label: "View billing amounts", enforcement: "backend", sensitive: true, roles: HR_ONLY,
        description: "Open the Billing page and see charge amounts." },
      { key: "manage_service_rates", label: "Manage employee service rates", enforcement: "none", sensitive: true,
        description: "Not used yet. Charge rates are edited on the Employees page." },
      { key: "view_financial_reports", label: "View financial reports", enforcement: "none", sensitive: true,
        description: "Not used yet." },
    ],
  },
];

const ALL_PERMISSIONS = PERMISSION_CATEGORIES.flatMap((category) => category.permissions);
const ALL_PERMISSION_KEYS = ALL_PERMISSIONS.map((permission) => permission.key);
const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);
const PERMISSION_ROLES = new Map(ALL_PERMISSIONS.map((permission) => [permission.key, permission.roles || CONFIGURABLE_ROLES]));

// Mirrors the roles previously hard-coded in the route files. HR also adds
// manual entries (product decision, 2026-10-23).
const DEFAULT_ROLE_PERMISSIONS = {
  hr: [
    "view_tasks", "create_tasks", "edit_tasks", "assign_tasks", "reassign_tasks", "archive_tasks",
    "add_manual_entries",
    "view_teams", "create_teams", "edit_teams",
    "view_clients", "manage_clients", "view_projects", "manage_projects",
    "view_personal_reports", "view_all_reports", "export_reports", "view_billing_amounts",
  ],
  team_lead: [
    "view_tasks", "create_tasks", "edit_tasks", "assign_tasks", "reassign_tasks", "archive_tasks",
    "view_teams", "view_team_timesheets", "view_team_reports",
    "view_clients", "view_projects", "view_personal_reports", "export_reports",
  ],
  employee: [
    "view_tasks", "view_clients", "view_projects", "view_personal_reports", "export_reports",
  ],
};

const isConfigurableRole = (role) => CONFIGURABLE_ROLES.includes(role);

const permissionAppliesToRole = (key, role) => Boolean(PERMISSION_ROLES.get(key)?.includes(role));

// Returns the cleaned permission list, or the first unknown key as `invalid`.
// Known keys that cannot apply to `role` are dropped rather than rejected, so
// a role saved before `roles` existed can still be saved again.
const normalizePermissionList = (requested, role) => {
  if (!Array.isArray(requested)) return { invalid: "not-a-list" };
  const invalid = requested.find((key) => !PERMISSION_KEY_SET.has(key));
  if (invalid !== undefined) return { invalid: String(invalid) };
  const permissions = [...new Set(requested)];
  return { permissions: role ? permissions.filter((key) => permissionAppliesToRole(key, role)) : permissions };
};

module.exports = {
  ALL_PERMISSION_KEYS,
  CONFIGURABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATEGORIES,
  isConfigurableRole,
  normalizePermissionList,
  permissionAppliesToRole,
};
