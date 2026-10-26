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
