// Only implemented, role-authorized modules belong in the primary navigation.
// Compatibility aliases and form/detail routes stay routable but are not menu items.
// `needs` lists the role permissions an item's data requires; the shell hides
// the item without them (the route explains why if it is opened directly).
const ALL_REPORTS = ["view_all_reports"];
const TEAM_REPORTS = ["view_team_timesheets"];
const BILLING = ["view_billing_amounts"];

export const workspaceNavigation = [
  { path: "/admin/dashboard", title: "Overview", role: "admin", group: "Workspace", needs: ALL_REPORTS },
  { path: "/admin/clients", title: "Clients", role: "admin", group: "Workspace" },
  { path: "/admin/projects", title: "Projects", role: "admin", group: "Workspace" },
  { path: "/admin/tasks", title: "Tasks", role: "admin", group: "Workspace" },
  { path: "/admin/team", title: "Teams", role: "admin", group: "Workspace" },
  { path: "/admin/employees", title: "Employees", role: "admin", group: "Workspace" },
  { path: "/admin/my-timesheet", title: "My timesheet", role: "admin", group: "Time & attendance" },
  { path: "/admin/my-timesheet/details", title: "My detailed timesheet", role: "admin", group: "Time & attendance" },
  { path: "/admin/timesheets/team", title: "Team timesheet", role: "admin", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/detailed", title: "Detailed timesheet", role: "admin", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/project-hours", title: "Project hours", role: "admin", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/attendance", title: "Attendance", role: "admin", group: "Time & attendance" },
  { path: "/admin/billing", title: "Billing", role: "admin", group: "Finance", needs: BILLING },
  { path: "/admin/help", title: "Help", role: "admin", group: "System" },
  { path: "/admin/settings", title: "Idle & logout", role: "admin", group: "System" },
  { path: "/admin/permissions", title: "Permissions", role: "admin", group: "System" },

  { path: "/team-lead/dashboard", title: "Overview", role: "team_lead", group: "Workspace", needs: TEAM_REPORTS },
  { path: "/team-lead/employee-insights", title: "Employee insights", role: "team_lead", group: "Workspace", needs: TEAM_REPORTS },
  { path: "/team-lead/tasks", title: "Tasks", role: "team_lead", group: "Workspace" },
  { path: "/team-lead/timesheet", title: "My timesheet", role: "team_lead", group: "Time & attendance" },
  { path: "/team-lead/timesheet/details", title: "My detailed timesheet", role: "team_lead", group: "Time & attendance" },
  { path: "/team-lead/timesheets/team", title: "Team timesheet", role: "team_lead", group: "Time & attendance", needs: TEAM_REPORTS },
  { path: "/team-lead/timesheets/detailed", title: "Detailed timesheet", role: "team_lead", group: "Time & attendance", needs: TEAM_REPORTS },
  { path: "/team-lead/timesheets/project-hours", title: "Project hours", role: "team_lead", group: "Time & attendance", needs: TEAM_REPORTS },
  { path: "/team-lead/timesheets/attendance", title: "Attendance", role: "team_lead", group: "Time & attendance" },
  { path: "/team-lead/help", title: "Help", role: "team_lead", group: "System" },

  { path: "/employee/dashboard", title: "Overview", role: "employee", group: "Workspace" },
  { path: "/employee/timesheet", title: "My timesheet", role: "employee", group: "Time & attendance" },
  { path: "/employee/timesheet/details", title: "My detailed timesheet", role: "employee", group: "Time & attendance" },
  { path: "/employee/help", title: "Help", role: "employee", group: "System" },

  // Manager receives the complete admin navigation.
  { path: "/admin/dashboard", title: "Overview", role: "manager", group: "Workspace", needs: ALL_REPORTS },
  { path: "/admin/clients", title: "Clients", role: "manager", group: "Workspace" },
  { path: "/admin/projects", title: "Projects", role: "manager", group: "Workspace" },
  { path: "/admin/tasks", title: "Tasks", role: "manager", group: "Workspace" },
  { path: "/admin/team", title: "Teams", role: "manager", group: "Workspace" },
  { path: "/admin/employees", title: "Employees", role: "manager", group: "Workspace" },
  { path: "/admin/my-timesheet", title: "My timesheet", role: "manager", group: "Time & attendance" },
  { path: "/admin/my-timesheet/details", title: "My detailed timesheet", role: "manager", group: "Time & attendance" },
  { path: "/admin/timesheets/team", title: "Team timesheet", role: "manager", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/detailed", title: "Detailed timesheet", role: "manager", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/project-hours", title: "Project hours", role: "manager", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/attendance", title: "Attendance", role: "manager", group: "Time & attendance" },
  { path: "/admin/billing", title: "Billing", role: "manager", group: "Finance", needs: BILLING },
  { path: "/admin/help", title: "Help", role: "manager", group: "System" },
  { path: "/admin/settings", title: "Idle & logout", role: "manager", group: "System" },
  { path: "/admin/permissions", title: "Permissions", role: "manager", group: "System" },

  // HR receives business/operational modules but not employee administration
  // or idle/logout security settings.
  { path: "/admin/dashboard", title: "Overview", role: "hr", group: "Workspace", needs: ALL_REPORTS },
  { path: "/admin/clients", title: "Clients", role: "hr", group: "Workspace" },
  { path: "/admin/projects", title: "Projects", role: "hr", group: "Workspace" },
  { path: "/admin/tasks", title: "Tasks", role: "hr", group: "Workspace" },
  { path: "/admin/team", title: "Teams", role: "hr", group: "Workspace" },
  { path: "/admin/my-timesheet", title: "My timesheet", role: "hr", group: "Time & attendance" },
  { path: "/admin/my-timesheet/details", title: "My detailed timesheet", role: "hr", group: "Time & attendance" },
  { path: "/admin/timesheets/team", title: "Team timesheet", role: "hr", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/detailed", title: "Detailed timesheet", role: "hr", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/project-hours", title: "Project hours", role: "hr", group: "Time & attendance", needs: ALL_REPORTS },
  { path: "/admin/timesheets/attendance", title: "Attendance", role: "hr", group: "Time & attendance" },
  { path: "/admin/billing", title: "Billing", role: "hr", group: "Finance", needs: BILLING },
  { path: "/admin/help", title: "Help", role: "hr", group: "System" },
];

// The menu for a role (alpha uses the admin menu), narrowed to the items
// whose `needs` the signed-in user holds.
export const navigationForRole = (role, hasPermission) => {
  const navigationRole = role === "alpha" ? "admin" : role;
  return workspaceNavigation.filter((item) => item.role === navigationRole && hasPermission(...(item.needs || [])));
};

// Pages HR, team leads and employees reach through duties an administrator
// gave them (to their role or to them personally). An item appears when the
// person holds any of `anyOf`; `roles` limits team pages to employees (team
// leads already have them). Company pages say "Company" for team leads and
// employees, so they are not mistaken for their own team's pages.
const TASK_DUTIES = ["create_tasks", "edit_tasks", "assign_tasks", "reassign_tasks", "archive_tasks"];
const TEAM_ADMIN = ["create_teams", "edit_teams", "assign_team_leads"];
const EMPLOYEES = ["employee"];

export const dutyNavigation = [
  { path: "/admin/dashboard", title: "Company overview", group: "Workspace", anyOf: ALL_REPORTS },
  { path: "/admin/clients", title: "Clients", group: "Workspace", anyOf: ["manage_clients"] },
  { path: "/admin/projects", title: "Projects", group: "Workspace", anyOf: ["manage_projects"] },
  { path: "/admin/team", title: "Teams", group: "Workspace", anyOf: TEAM_ADMIN },
  { path: "/team-lead/tasks", title: "Team tasks", group: "Workspace", anyOf: TASK_DUTIES, roles: EMPLOYEES },
  { path: "/team-lead/employee-insights", title: "Team insights", group: "Workspace", anyOf: TEAM_REPORTS, roles: EMPLOYEES },
  { path: "/team-lead/timesheets/team", title: "Team timesheet", group: "Time & attendance", anyOf: TEAM_REPORTS, roles: EMPLOYEES },
  { path: "/team-lead/timesheets/detailed", title: "Detailed team timesheet", group: "Time & attendance", anyOf: TEAM_REPORTS, roles: EMPLOYEES },
  { path: "/team-lead/timesheets/project-hours", title: "Team project hours", group: "Time & attendance", anyOf: TEAM_REPORTS, roles: EMPLOYEES },
  { path: "/team-lead/timesheets/attendance", title: "Team attendance", group: "Time & attendance", anyOf: TEAM_REPORTS, roles: EMPLOYEES },
  { path: "/admin/timesheets/team", title: "Company timesheet", group: "Time & attendance", anyOf: ALL_REPORTS },
  { path: "/admin/timesheets/detailed", title: "Company detailed timesheet", group: "Time & attendance", anyOf: ALL_REPORTS },
  { path: "/admin/timesheets/project-hours", title: "Company project hours", group: "Time & attendance", anyOf: ALL_REPORTS },
  { path: "/admin/timesheets/attendance", title: "Company attendance", group: "Time & attendance", anyOf: ALL_REPORTS },
  { path: "/admin/billing", title: "Billing", group: "Finance", anyOf: BILLING },
];

// Duty pages for a person, leaving out anything their role menu already has.
export const dutyNavigationFor = (role, hasPermission, rolePaths = []) => {
  if (["admin", "alpha", "manager"].includes(role)) return [];
  const taken = new Set(rolePaths);
  return dutyNavigation.filter((item) => !taken.has(item.path)
    && (!item.roles || item.roles.includes(role))
    && item.anyOf.some((key) => hasPermission(key)));
};
