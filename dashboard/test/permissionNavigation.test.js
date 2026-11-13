import test from "node:test";
import assert from "node:assert/strict";
import { dutyNavigationFor, navigationForRole } from "../src/components/layout/workspaceNavigation.js";
import { isAdminRole, missingPermissionHint, missingTaskPermissions } from "../src/utils/permissions.js";

// Mirrors AuthProvider.hasPermission: admin-level roles hold everything.
const grants = (role, keys) => (...needed) => isAdminRole(role) || needed.every((key) => keys.includes(key));
const paths = (role, keys) => navigationForRole(role, grants(role, keys)).map((item) => item.path);

test('a personal linking grant opens Work setup without project/task administration', () => {
  for (const role of ['employee', 'team_lead']) {
    const menu = dutyNavigationFor(role, grants(role, ['manage_activity_links']));
    assert.equal(menu.filter(item => item.group === 'Task linking').length, 1);
    assert.ok(menu.some(item => item.path === '/admin/project-client-links' && item.title === 'Work setup'));
    assert.equal(menu.some(item => item.path === '/admin/projects'), false);
    assert.equal(dutyNavigationFor(role, grants(role, [])).some(item => item.path === '/admin/project-client-links'), false);
  }
  assert.ok(paths('hr', ['manage_activity_links']).includes('/admin/project-client-links'));
  assert.equal(paths('hr', []).includes('/admin/project-client-links'), false);
});

test('work setup has one menu entry covering all three existing pages', () => {
  for (const role of ['admin', 'alpha', 'manager', 'hr']) {
    const items = navigationForRole(role, grants(role, ['manage_activity_links'])).filter(item => item.group === 'Task linking');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Work setup');
    for (const path of ['/admin/project-client-links', '/admin/task-links', '/admin/client-access']) {
      assert.ok(items[0].activePaths.includes(path));
    }
  }
});

test("admin-level roles keep the full menu whatever the grants", () => {
  for (const role of ["admin", "alpha", "manager"]) {
    const menu = paths(role, []);
    for (const path of ["/admin/dashboard", "/admin/timesheets/team", "/admin/production/billing", "/admin/timesheets/attendance"]) {
      assert.ok(menu.includes(path), `${role}: ${path}`);
    }
  }
  assert.ok(paths("alpha", []).includes("/admin/permissions"), "alpha uses the admin menu");
});

test("HR menu follows report and billing permissions", () => {
  const all = paths("hr", ["view_all_reports", "view_billing_amounts"]);
  assert.ok(all.includes("/admin/dashboard") && all.includes("/admin/production/billing") && all.includes("/admin/timesheets/team"));
  const none = paths("hr", []);
  for (const path of ["/admin/dashboard", "/admin/timesheets/team", "/admin/timesheets/detailed", "/admin/timesheets/project-hours", "/admin/billing"]) {
    assert.equal(none.includes(path), false, path);
  }
  // Pages that never need those permissions stay.
  for (const path of ["/admin/clients", "/admin/tasks", "/admin/my-timesheet", "/admin/timesheets/attendance"]) {
    assert.ok(none.includes(path), path);
  }
});

test('production hours navigation is available without financial access and settings remain Admin-only', () => {
  for (const role of ['admin', 'alpha', 'manager', 'hr', 'team_lead', 'employee']) {
    const section = navigationForRole(role, grants(role, [])).filter(item => item.group === 'Production');
    assert.equal(section.some(item => item.path === '/admin/production'), false, 'Production Overview is removed');
    for (const path of ['/admin/production/team', '/admin/production/employee', '/admin/production/clients', '/admin/production/tasks', '/admin/production/billing', '/admin/production/reports']) {
      assert.ok(section.some(item => item.path === path), `${role}: ${path}`);
    }
    assert.equal(section.some(item => item.path.endsWith('/settings')), ['admin', 'alpha'].includes(role));
    assert.equal(section.some(item => item.needs?.includes('view_billing_amounts')), false);
  }
});

test("team lead team reports follow View team timesheets; personal pages and attendance stay", () => {
  const granted = paths("team_lead", ["view_team_timesheets"]);
  assert.ok(granted.includes("/team-lead/dashboard") && granted.includes("/team-lead/timesheets/team"));
  const denied = paths("team_lead", []);
  for (const path of ["/team-lead/dashboard", "/team-lead/employee-insights", "/team-lead/timesheets/team"]) {
    assert.equal(denied.includes(path), false, path);
  }
  for (const path of ["/team-lead/tasks", "/team-lead/timesheet", "/team-lead/timesheets/attendance"]) {
    assert.ok(denied.includes(path), path);
  }
});

test("Shifts and Schedule stay out of every menu", () => {
  for (const role of ["admin", "manager", "hr", "team_lead", "employee"]) {
    assert.equal(paths(role, []).some((path) => path.startsWith("/admin/scheduler")), false, role);
  }
});

test("task permissions: Create tasks alone allows adding tasks, and hints name what is missing", () => {
  assert.deepEqual(missingTaskPermissions(grants("team_lead", ["create_tasks", "edit_tasks", "archive_tasks"])), []);
  assert.deepEqual(missingTaskPermissions(grants("employee", ["create_tasks"])), ["edit_tasks", "archive_tasks"]);
  assert.deepEqual(missingTaskPermissions(grants("manager", [])), []);
  assert.match(missingPermissionHint(["create_tasks"]), /“Create tasks” permission\./);
  assert.match(missingPermissionHint(["create_teams", "edit_teams"]), /“Create teams” and “Edit teams” permissions/);
});

// Full menu as AppShell builds it: the role's menu plus pages opened by duties.
const menu = (role, keys) => {
  const own = paths(role, keys);
  return [...own, ...dutyNavigationFor(role, grants(role, keys), own).map((item) => item.path)];
};

test("duties given to a team lead or employee add their pages to the menu", () => {
  const lead = menu("team_lead", ["view_team_timesheets", "manage_clients", "view_all_reports", "view_billing_amounts"]);
  for (const path of ["/admin/clients", "/admin/dashboard", "/admin/timesheets/team", "/admin/timesheets/attendance", "/admin/production/billing"]) {
    assert.ok(lead.includes(path), path);
  }
  assert.equal(lead.filter((path) => path === "/team-lead/timesheets/team").length, 1, "a lead's own team pages are not repeated");

  const employee = menu("employee", ["create_tasks", "view_team_timesheets", "manage_projects", "edit_teams"]);
  for (const path of ["/team-lead/tasks", "/team-lead/timesheets/team", "/team-lead/timesheets/attendance", "/admin/projects", "/admin/team"]) {
    assert.ok(employee.includes(path), path);
  }
  for (const path of ["/admin/clients", "/admin/billing", "/admin/dashboard"]) assert.equal(employee.includes(path), false, path);
  assert.deepEqual(menu("employee", []), paths("employee", []), "no duties, no extra pages");
});

test("HR gets no duplicate pages, and admin-level roles never need duty pages", () => {
  const hr = menu("hr", ["view_all_reports", "view_billing_amounts", "manage_clients", "view_team_timesheets"]);
  assert.equal(new Set(hr).size, hr.length);
  assert.equal(hr.some((path) => path.startsWith("/team-lead/")), false, "HR has no team");
  for (const role of ["admin", "alpha", "manager"]) assert.deepEqual(dutyNavigationFor(role, () => true, []), []);
  assert.ok(paths("manager", []).includes("/admin/permissions"), "managers manage permissions");
});

test('Finance is removed for every role and delegated billing permission', () => {
  for (const role of ['admin', 'alpha', 'manager', 'hr', 'team_lead', 'employee']) {
    const own = navigationForRole(role, () => true);
    const all = [...own, ...dutyNavigationFor(role, () => true, own.map(row => row.path))];
    assert.equal(all.some(row => row.group === 'Finance' || row.path === '/admin/billing'), false);
    assert.ok(all.some(row => row.path === '/admin/production/billing'));
  }
});
