// Every business module and the URL it is served under. server.js mounts them
// in this order, after the shared middleware and before the /api 404.
const apiModules = [
  ["/api/auth", require("./auth/authRoutes")],
  ["/api/employees", require("./employees/employeeRoutes")],
  ["/api/attendance", require("./attendance/attendanceRoutes")],
  ["/api/projects", require("./projects/projectRoutes")],
  ["/api/tasks", require("./tasks/taskRoutes")],
  ["/api/time-logs", require("./timers/taskTimeLogRoutes")],
  ["/api/shifts", require("./scheduling/shiftRoutes")],
  ["/api/schedules", require("./scheduling/scheduleRoutes")],
  ["/api/teams", require("./teams/teamRoutes")],
  ["/api/clients", require("./clients/clientRoutes")],
  ["/api/billing", require("./billing/billingRoutes")],
  ["/api/settings", require("./settings/settingsRoutes")],
  ["/api/permissions", require("./permissions/permissionRoutes")],
  ["/api/metrics", require("../monitoring/metricsRoutes")],
];

module.exports = { apiModules };
