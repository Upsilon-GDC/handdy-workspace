# CRM — Employee Time & Attendance System: Codebase Guide

This guide explains how the whole system is built and how it works, from the
database up to the desktop app. It describes the code as it is in this
repository (desktop version 2.0.1). Older notes such as `README_MERGED.md`
describe earlier versions and list files that no longer exist.

**Contents**

1. [What the system does](#1-what-the-system-does)
2. [Repository layout](#2-repository-layout)
3. [Architecture](#3-architecture)
4. [Roles and permissions](#4-roles-and-permissions)
5. [Data model](#5-data-model)
6. [Backend (API server)](#6-backend-api-server)
7. [Dashboard (web app)](#7-dashboard-web-app)
8. [Desktop app (Electron)](#8-desktop-app-electron)
9. [Key flows end to end](#9-key-flows-end-to-end)
10. [Configuration](#10-configuration)
11. [Running locally](#11-running-locally)
12. [Deployment and releases](#12-deployment-and-releases)
13. [Tests](#13-tests)
14. [Known gaps and gotchas](#14-known-gaps-and-gotchas)

---

## 1. What the system does

A company time-tracking and attendance system with three parts:

| Part | Who uses it | What it does |
|---|---|---|
| **Desktop app** (`desktop-app/`) | Employees, team leads | The only place time is recorded. Employees pick a project, client and task and run a timer. It detects inactivity, stops the timer when idle, signs out after long inactivity, and locks the screen while no timer is running. |
| **Dashboard** (`dashboard/`) | Admins, managers, HR, team leads, employees | Web app for management and reporting: employees, teams, clients, projects, tasks, shifts and schedules, timesheets, attendance, billing, settings and permissions. |
| **Backend** (`backend/`) | Both apps | Node.js/Express REST API over MongoDB. Holds all business rules and security checks. In production it also serves the built dashboard. |

All three live in one repository and are deployed as:
- one Render web service (API + dashboard on the same domain), and
- a Windows installer for the desktop app, distributed through GitHub Releases with automatic updates.

---

## 2. Repository layout

```text
.
├── backend/                  Express API (CommonJS, Node)
│   ├── server.js             App setup, middleware, module mounting, startup, shutdown
│   ├── src/
│   │   ├── config/           db.js (Mongo connection), productionConfig.js, optimizations.js (switches)
│   │   ├── modules/          One folder per business area: <area>Routes.js (URL → access rule →
│   │   │                     handler) + <area>Controller.js; index.js lists module → URL
│   │   ├── middleware/       Shared: auth, role/permission gates, rate limit, catalog cache, errors
│   │   ├── services/         Cross-cutting logic: sessions, caches, timer lease, sync, attendance
│   │   ├── jobs/             timerSweep.js (30 s stale-timer sweep)
│   │   ├── monitoring/       Traffic metrics, /api/metrics, /health
│   │   ├── models/           Mongoose schemas (one file per collection)
│   │   └── utils/            Pure helpers: dates, billing math, permissions catalog…
│   ├── scripts/              Admin/maintenance scripts (backups, attendance backfill…)
│   └── test/                 node:test unit tests (40 files)
├── dashboard/                React 19 + Vite single-page app (ES modules)
│   ├── src/
│   │   ├── main.jsx, App.jsx Entry point and top-level providers
│   │   ├── routes/           AppRoutes.jsx (all URLs), ProtectedRoute.jsx (guards)
│   │   ├── context/          AuthProvider (session), ThemeContext (palettes)
│   │   ├── api/              One module per API area, all on axiosInstance
│   │   ├── pages/            Screens, grouped by role: admin/, teamLead/, employee/, shared/, auth/, profile/
│   │   ├── components/       Reusable pieces: layout/, tasks/, reports/, employees/…
│   │   ├── hooks/            useDataRefresh (polling)
│   │   ├── utils/            Report building, exports, dates, validation
│   │   └── styles/           Plain CSS per page + themes.css / workspace.css
│   ├── scripts/              audit-routes.mjs (route checker), review-ui.cjs (screenshots)
│   ├── test/                 node:test unit tests for utils, navigation, report loading (10 files)
│   └── ui-review/            Screenshots written by UI smoke tests
├── desktop-app/              Electron app (CommonJS)
│   ├── main.js               Main process: windows, IPC, close handshake, lock wiring
│   ├── preload.js            The only bridge between page and Node (contextBridge)
│   ├── renderer.js           All page logic: login, timer, idle, timesheet, lock state
│   ├── timer-lock.js         Full-screen lock controller (overlays on every monitor)
│   ├── app-updater.js        Auto-update via electron-updater + GitHub Releases
│   ├── api-config.js         Picks local vs production API URL
│   ├── index.html            Login page
│   ├── dashboard.html        Timer + today's timesheet page
│   ├── lock-overlay.html     Content of the blank lock overlay
│   ├── style.css             Styles for both pages
│   ├── idle-policy-defaults.json  Shared idle/logout defaults (also read by backend + dashboard)
│   ├── build/installer.nsh   NSIS hook that repairs CRM shortcuts after install
│   ├── scripts/publish-release.cjs  Signed release to GitHub (draft)
│   └── test/                 Unit tests + real-Electron smoke tests
├── render.yaml               Render deployment blueprint
├── shared/api-contracts/     Rules that keep desktop, dashboard and server compatible
├── docs/                     Optimization plan, deploy/rollback, backups, security review
├── code-city/                Standalone code-visualization page (not part of the product)
└── artifacts/                Old logs, review screenshots, legacy files (zips are git-ignored)
```

**Backend layering.** A request always flows `route → middleware → controller`,
and controllers call `services/` and `utils/`. Models never call controllers.
Each router file states its access rule next to each route, so the router is
the first place to look when asking "who may call this?".

---

## 3. Architecture

```text
 ┌────────────────────────────┐          ┌──────────────────────────────┐
 │  Desktop app (Electron)    │          │  Dashboard (browser, React)  │
 │  login · timer · idle ·    │          │  management · reports ·      │
 │  screen lock · heartbeat   │          │  billing · settings          │
 └─────────────┬──────────────┘          └──────────────┬───────────────┘
               │ HTTPS  Authorization: Bearer <JWT>      │ same-origin /api
               ▼                                         ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Render web service  (backend/server.js)                             │
 │   /api/*  → Express routers → controllers → Mongoose                 │
 │   /*      → dashboard/dist (built React app, SPA fallback)           │
 │   /health → health check                                             │
 │   background: every 30 s close desktop timers with no heartbeat      │
 └─────────────────────────────────┬────────────────────────────────────┘
                                   ▼
                        MongoDB Atlas (Mongoose 9)
```

Important design decisions:

- **The server is the source of truth for time.** The desktop app only asks the
  API to start/stop a timer. Durations are computed on the server from
  timestamps when the timer stops.
- **Desktop timers are leased.** The desktop app sends a heartbeat every 20 s.
  A timer with no heartbeat for 90 s is closed by the server at its last
  heartbeat (crash, sleep, lost network). Time is never counted past the last
  confirmed moment.
- **One active desktop session per employee.** Signing in on a second computer
  requires approval on the first (see [9.2](#92-signing-in-on-a-second-computer)).
- **Single-instance assumptions.** Several protections are in-memory: the
  rate limiter, auth cache, catalog cache, permission cache and the task
  duplicate-check queue. That is correct for the current single Render
  instance; see [14](#14-known-gaps-and-gotchas) before scaling out.

---

## 4. Roles and permissions

### 4.1 Roles

Stored in `Employee.role` (`backend/src/models/Employee.js`).

| Role | Level | Typical use |
|---|---|---|
| `alpha` | Super admin | Everything an admin can do, plus alpha-only settings (per-employee idle policies). Alpha accounts are protected from edits by others. |
| `admin` | Admin | Full access. Manages permissions and idle/logout settings. |
| `manager` | Admin-equivalent | Same application access as admin (`utils/roles.js` → `isAdminRole`), including the Permissions page (since 2026-10-26). |
| `hr` | Staff | Business modules (clients, projects, tasks, teams, reports, billing), not account administration or security settings. |
| `team_lead` | Team | Leads exactly one team. Sees and manages their team's tasks and timesheets. |
| `employee` | Individual | Tracks their own time in the desktop app; sees their own reports. Can be given any duty (below). |

`isAdminRole(role)` is true for `admin`, `alpha` and `manager`, and most
checks treat those three the same.

### 4.2 Four access mechanisms

1. **Role gates** — `authorizeRoles("admin", "hr", …)` in
   `middleware/authorizeRoles.js`. Admin-level roles pass any gate that lists
   `"admin"`.
2. **Role permissions (configurable)** — `requirePermission("create_tasks")`.
   The catalog is in `utils/permissions.js`. Admins and managers edit it on the
   **Permissions** page for the roles `hr`, `team_lead` and `employee`; it is
   saved in the `role_permissions` collection. Admin-level roles always have
   every permission. Roles nobody has edited use
   `DEFAULT_ROLE_PERMISSIONS`, which mirror what the routes allowed before
   the catalog existed. `services/permissionService.js` keeps an in-memory
   snapshot, refreshed at most every 30 s and updated immediately on save.
3. **Personal exceptions (one employee)**: on the same page, **By employee**
   lets an admin switch a permission on or off for one person.
   `Employee.permissionOverrides.granted` / `.revoked` hold only the switches
   that differ from the role. Everything else keeps following the role, and an
   exception stays until it is reset, even if the role changes later.
   `getEffectivePermissionsSync` applies them (role grants + personal on −
   personal off), so every `requirePermission` check and `/permissions/me`
   include them. Admin-level roles ignore exceptions. The fields are
   loaded with the sign-in check (no extra query), and saving clears the
   sign-in cache, so the change applies on the person's next request.
4. **Delegated employee permissions** — `Employee.permissions` can hold
   `create_employees` / `edit_employees` for a specific person, checked by
   `authorizeAccess(...)`. This lets an admin give one HR person employee
   administration without changing the whole role.

Each catalog entry carries, and the Permissions page shows:
- a **description** of exactly what the switch does;
- an `enforcement` tag: `backend` (checked by the API, and the dashboard hides
  the matching menus and buttons), `frontend` (only controls the screen) or
  `none` ("Not used yet": switching it changes nothing).

**Any duty for any role (2026-10-26).** Every permission can be given to HR,
team leads and employees, by role or to one person, so an administrator or
manager can hand out different duties. What a duty covers:
- **Company duties** (clients, projects, teams, all reports, billing) cover
  the whole company, as for HR. The dashboard adds the pages to the person's
  menu (`dutyNavigation` in `workspaceNavigation.js`; "Company …" titles for
  leads and employees), and the routes open by permission (`grants` on
  `AdminStaffOnly` / `TeamLeadOnly` → `ProtectedRoute requiredPermissions`).
- **Team duties** (tasks, manual entries, team timesheets) cover the person's
  own team (`services/teamScope.js`): the team a lead leads, or the team an
  employee belongs to. HR and admin-level roles keep working with every team
  for tasks and manual entries; HR has no team, so "View team timesheets"
  shows HR nothing. Teammates are listed to non-leads without rates or
  contact details. Employees use the team-lead pages (Team tasks, Team
  timesheet …), which take their scope from the page (`RoleReportPage scope`),
  not the role. The task list keeps showing an employee only their own tasks
  (the desktop list) unless the management page asks for `?scope=manage`.
- The optional catalog field `roles` would limit a permission to some roles
  (switch disabled, dropped on save, ignored if stored); no entry uses it now.

| Permission key | Enforced by | Default for |
|---|---|---|
| `create_tasks` | POST `/tasks`, `/tasks/bulk`, GET `/tasks/resolve-project`; on its own enough for "Add task" (whole-team tasks) | hr, team_lead |
| `edit_tasks` | PUT `/tasks/:id` (Edit button on both Tasks pages; switching a task on/off there also needs `archive_tasks`) | hr, team_lead |
| `reassign_tasks` | picking particular employees: on create (`taskPermissions.js`) and when editing | hr, team_lead |
| `archive_tasks` | toggle-status, DELETE `/tasks/:id` | hr, team_lead |
| `add_manual_entries` | `/time-logs/manual*` (+ "Add entry" buttons) | hr |
| `create_teams`, `edit_teams`, `assign_team_leads` | POST/PUT/DELETE `/teams` | hr (not `assign_team_leads`) |
| `view_team_timesheets` | GET `/time-logs/team`, `/attendance/team/*`; team overview and reports | team_lead |
| `manage_clients` | POST/PUT/DELETE `/clients` | hr |
| `manage_projects` | POST/PUT/DELETE `/projects`; lists every project | hr |
| `view_all_reports` | GET `/time-logs/admin`, `/attendance/admin/history`; company overview and reports | hr |
| `view_billing_amounts` | all of `/billing` | hr |
| `export_reports` | screen only: Export Excel/PDF buttons (exports are built in the browser) | hr, team_lead, employee |
| `view_tasks`, `complete_tasks`, `view_task_timesheets`, `view_teams`, `view_team_productivity`, `assign_team_members`, `remove_team_members`, `view_clients`, `view_projects`, `assign_projects`, `view_personal_reports`, `view_team_reports`, `manage_service_rates`, `view_financial_reports` | not used yet | various |

Admin, alpha and manager always hold every permission. The dashboard reads
the caller's effective keys from `/permissions/me` (see [7.2](#72-auth-in-the-browser-contextauthproviderjsx)).

---

## 5. Data model

All schemas are in `backend/src/models/`. Most catalog models use the
`readRevisionPlugin` (cache invalidation, [6.7](#67-caching-and-incremental-sync)).

| Model (collection) | Purpose | Key fields and rules |
|---|---|---|
| **Employee** | Every user account | `employeeId` (unique, upper-case), `fullName`, `email` (unique), `password` (bcrypt, `select:false`), `role`, `team`, `teamLead`, `isActive`, `permissions` (delegations), `permissionOverrides` (personal exceptions, `select:false`), `projectRates[{project, chargeRate}]` (billing), `idleTrackingExempt`, `idlePolicyOverride`, `tokenVersion`, `rememberedSessions[]`, password-reset hash/expiry. Changing password or email invalidates reset links. |
| **Team** | Group of employees | `teamName` (unique), `teamLead`, `isActive`. Employees point to their team through `Employee.team`. |
| **Client** | Customer being billed | `clientName`, `status` Active/Inactive. "Delete" sets Inactive. |
| **Project** | Work stream (e.g. "Audit") | `projectCode` (auto), `projectName`, `clients[]` (+ legacy `client`), `teams[]` (empty = available to all), `status` Active/Completed/On Hold, `deletedAt` (soft delete). `serviceType` is a legacy field that is no longer set. |
| **Task** | What an employee works on | `taskCode` (auto, unique), `taskName`, `taskType` work/break, `project` (null = any project of its teams), `teams[]` (+ legacy `team`), `assignToAllEmployees` or `assignedTo[]`, `idleLogout`, `isActive`, `deletedAt`. |
| **TaskTimeLog** (`task_time_logs`) | One timer session | `employee`, `project`, `client`, `task`, `startedAt`, `stoppedAt`, `status` running/paused/stopped, `pauses[{pausedAt, resumedAt, reason: manual/idle/break}]`, `totalWorkedSeconds`, `totalPausedSeconds`, `totalIdleSeconds`, `note`, `desktopHeartbeatAt`, `stopReason` (`desktop_disconnected`), `entrySource` timer/manual, `manualEntry{createdBy, reason, deletedAt…}`, `logoutReason`. A **unique partial index** on `{employee, isActiveTimer:true}` guarantees one active timer per employee. |
| **Attendance** | Daily check-in/out, recorded automatically from timers ([6.11](#611-automatic-attendance)) | `employee`, `date` (YYYY-MM-DD in `APP_TIMEZONE`), `checkIn`, `checkOut`, `totalHours`, `status` Present/Absent, `source` timer/check_in. Unique per employee and day. |
| **Shift** | Working-hours template | Title, start/end time, etc. |
| **Schedule** | Shift assigned to a person on a date | `team`, `employee`, `shift`, `date`, `scheduleDateKey`, `status` Active/Inactive; conflicting schedules are rejected. |
| **SystemSettings** | Global settings (single document) | `idleThresholdMinutes`, `autoLogoutMinutes`. |
| **RolePermission** (`role_permissions`) | Saved role permission lists | One document per configurable role (`hr`, `team_lead`, `employee`). |
| **AuthSession** | One signed-in device | `employee`, `sessionId`, `deviceId`, `deviceName`, `clientType` desktop/web, `status` pending/active/revoked/logged_out/expired/denied, `lastActivity`, `expiresAt` (TTL index). **Unique partial index: one active desktop session per employee.** |
| **DeviceLoginRequest** | A second computer asking to sign in | Links the existing and requested sessions; `status` pending → approving → approved/denied/expired/…; secret stored only as a hash. |

Relationships at a glance:

```text
Team 1──* Employee            (Employee.team; Team.teamLead → Employee)
Project *──* Team             (Project.teams; empty = all teams)
Project *──* Client           (Project.clients)
Task  *──* Team, Task *──1 Project (or null = every project of its teams)
TaskTimeLog *──1 Employee, Project, Task, Client
Employee.projectRates: per-project charge rate used by Billing
```

---

## 6. Backend (API server)

### 6.1 Startup (`server.js`)

1. Load `.env`; optionally override DNS for Atlas (`MONGODB_DNS_SERVERS`).
2. Build the Express app (middleware below), mount routers under `/api/*`.
3. `startServer()`:
   - `validateProductionConfig()`: in production it requires `MONGODB_URI`, a
     strong `JWT_SECRET` (≥ 32 characters, not a placeholder) and an HTTPS
     `FRONTEND_URL` (or Render's `RENDER_EXTERNAL_URL`), otherwise it refuses
     to start;
   - verify SMTP (if configured);
   - connect to MongoDB (zlib wire compression);
   - ensure session indexes; load role permissions;
   - start the 30-second sweep (`jobs/timerSweep.js`) that closes desktop timers
     whose heartbeat stopped, once immediately and then every 30 s;
   - listen on `PORT` (default 5000); with `METRICS_ENABLED=true` start the
     traffic metrics (see [6.12](#612-traffic-metrics-switches-and-operations)).
4. On `SIGTERM` (every Render deploy) `services/gracefulShutdown.js` refuses new
   connections, lets open requests finish (long-polls end within 20 s), stops
   the sweep, logs the last metrics window and closes MongoDB; after 25 s it
   exits anyway.

### 6.2 Request pipeline

In order:

1. `compression()`, then the JSON body parser (1 MB limit).
2. **NoSQL-injection guard**: strips `$`/dot keys from body, params and query.
3. **Security headers**: nosniff, frame DENY, no-referrer, permissions-policy;
   in production also HSTS and a strict CSP.
4. **CORS**: `CORS_ORIGINS`, plus localhost:5173–5175 in development, plus
   `null` (Electron pages loaded from files).
5. `/api` responses get `Cache-Control: no-store`.
6. Routers. Unknown `/api/*` paths return JSON 404.
7. `/health`. `/downloads/*` is deliberately 404 (installers are not served by the web app).
8. If `dashboard/dist` exists: static files plus SPA fallback to `index.html`.
9. `errorHandler`: JSON for parse errors (400), oversized bodies (413) and everything else (500).

### 6.3 Authentication and sessions

**Token.** `utils/generateToken.js` signs a JWT with `employeeId`,
`tokenVersion`, `sessionId` and `deviceId` (`JWT_EXPIRES_IN`, default 7 days).

**`protect` middleware** (`middleware/authMiddleware.js`) runs on every
protected route and rejects the request unless all of these hold:
- the token is valid and not expired;
- the employee exists and `isActive` (otherwise 403 `ACCOUNT_INACTIVE`);
- `tokenVersion` matches (bumping it revokes every token);
- the token carries a session, and that `AuthSession` is still `active`
  and unexpired (otherwise 401 `SESSION_REVOKED`).

The employee + session pair is cached for 15 s (`services/authCache.js`). The
cache is cleared on any Employee or AuthSession write. `lastActivity` is
updated at most once a minute.

**Sign-in** (`POST /api/auth/login`, `modules/auth/authController.js`):
email + password + device info → `beginLoginSession()` in
`services/authSessionService.js`:

- stale sessions are expired first: past `expiresAt`, or no activity for
  `AUTH_SESSION_OFFLINE_GRACE_MS` (5 min);
- **web** sign-ins just replace that browser's previous session; any number
  of browsers may be signed in;
- **desktop** sign-ins: if no active desktop session exists, create one. If
  the active one is the same device, replace it. Otherwise create a *pending*
  session plus a `DeviceLoginRequest` and answer **409
  `DEVICE_APPROVAL_REQUIRED`**.

On success the response contains the JWT, the user, the session, and a
**remembered-session token**.

**Remembered sessions / quick login.** A random token whose SHA-256 hash
is stored on the employee (up to 10, 30 days, `REMEMBERED_SESSION_DAYS`). `POST
/auth/quick-login` exchanges it for a new sign-in without a password. The
token rotates on every use.

**Logout** (`POST /auth/logout`): marks the session `logged_out` and cancels
its pending device requests. If a remembered token is sent, that token is
revoked too; the desktop does this on inactivity logout.

**Password reset**: `forgot-password` always gives the same answer (no
account discovery) and emails a link through SMTP. Without SMTP, the link is
printed to the server log in development; in production the send fails and
is only logged as an error, so **production needs SMTP for self-service
resets**. `reset-password` consumes a hashed, expiring token.
Admins can also reset a password (`PUT /employees/:id/reset-password`).

**Rate limits** (`middleware/rateLimit.js`, in-memory): login and quick-login
10 per 15 min per IP + email; register 30 per hour; password reset 5 per 15 min.

### 6.4 API reference

All paths are under `/api`. "Auth" means a valid session (`protect`).

**Auth** — `modules/auth/authRoutes.js`

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public (rate-limited) | Email/password sign-in |
| POST | `/auth/quick-login` | public (rate-limited) | Sign in with remembered token |
| POST | `/auth/login-requests/:id/wait` | requester's secret | Long-poll (≈20 s) for approval of a second-device sign-in |
| POST | `/auth/login-requests/:id/cancel` | requester's secret | Cancel own request |
| GET | `/auth/login-requests/pending` | auth | Long-poll: is another device asking to sign in? |
| POST | `/auth/login-requests/:id/decision` | auth | `allow` / `deny` the other device |
| POST | `/auth/register` | admin or `create_employees` | Create an employee account |
| POST | `/auth/forgot-password`, `/auth/reset-password` | public (rate-limited) | Password reset |
| GET | `/auth/me` (and legacy `/auth/profile`) | auth | Current user |
| PUT | `/auth/profile`, `/auth/change-password` | auth | Self-service profile/password |
| POST | `/auth/logout` | auth | End this session |

**People** — `modules/employees/employeeRoutes.js`, `modules/teams/teamRoutes.js`

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/employees/options` | hr, or `create/edit_employees`, `view_all_reports`, team admin duties | Lightweight list for selectors |
| GET | `/employees`, `/employees/:id` | admin or `create/edit_employees` | Employee administration |
| PUT | `/employees/:id` | admin or `edit_employees` | Update (including team and project rates) |
| PUT | `/employees/:id/permissions`, `/:id/reset-password`, `/:id/team-lead`; DELETE `/employees/:id` | admin | Delegations, password reset, team lead, delete |
| GET | `/employees/my-team`, `/my-team/:id` | team_lead, or a team duty | Own team's members (names only for non-leads) |
| GET | `/teams` | hr, or `create/edit_employees`, team admin duties, `manage_projects`, `view_all_reports` | List teams |
| POST / PUT / DELETE | `/teams`, `/teams/:id` | `create_teams` / `edit_teams` | Manage teams (keeps `Team.teamLead` and members in sync via `services/teamAssignmentService.js`) |

**Work catalog** — clients, projects, tasks

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/clients` | auth | Active clients (employees/team leads get name + status only) |
| POST / PUT / DELETE | `/clients[/:id]` | `manage_clients` | Create / rename / deactivate |
| GET | `/projects`, `/projects/:id` | auth | Employees and team leads see projects of their team, or unrestricted ones |
| POST / PUT / DELETE | `/projects[/:id]` | `manage_projects` | Manage projects (DELETE is a soft delete) |
| GET | `/tasks`, `/tasks/:id` | auth | Visibility by role (see [6.6](#66-tasks)) |
| POST | `/tasks`, `/tasks/bulk` | `create_tasks` (+ `reassign_tasks` to pick employees) | Create one / many tasks |
| PUT | `/tasks/:id` | `edit_tasks` (+ `reassign_tasks` if assignees change) | Edit |
| PATCH | `/tasks/:id/toggle-status`; DELETE `/tasks/:id` | `archive_tasks` | Activate/deactivate; soft delete |
| GET | `/tasks/resolve-project` | `create_tasks` or `edit_tasks` | Which project a team set maps to |

**Time** — `modules/timers/taskTimeLogRoutes.js`, `modules/attendance/attendanceRoutes.js`

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/time-logs/start` | auth | Start a timer (see [6.5](#65-the-timer-engine)) |
| POST | `/time-logs/heartbeat` | auth | Keep the desktop timer's lease alive (404 = timer was closed) |
| POST | `/time-logs/stop` | auth | Stop; optional `idleSeconds`, `logoutReason` |
| POST | `/time-logs/pause`, `/time-logs/resume` | auth | Legacy pause/resume (the UI now uses break tasks) |
| PATCH | `/time-logs/note` | auth | Edit the running timer's note |
| GET | `/time-logs/active` | auth | Current timer or `null` |
| GET | `/time-logs/history` (alias `/my`) | auth | Own sessions; supports `today=true`, date range, `sync=true` |
| GET | `/time-logs/team` | `view_team_timesheets` | The own team's sessions |
| GET | `/time-logs/admin` | `view_all_reports` | Company-wide sessions |
| GET | `/time-logs/live` | admin, team_lead | Timers running right now |
| GET / POST / DELETE | `/time-logs/manual/options`, `/manual`, `/manual/:id` | `add_manual_entries` | Back-filled entries (see [6.5](#65-the-timer-engine)) |
| POST | `/attendance/check-in`, `/attendance/check-out` | auth | Older manual check-in/out; no screen calls them (attendance is automatic) |
| GET | `/attendance/today`, `/attendance/history` | auth | Own attendance |
| GET | `/attendance/team/today`, `/team/history` | team_lead, or `view_team_timesheets` | Own team's attendance |
| GET | `/attendance/admin/history` | admin, hr, manager, or `view_all_reports` | Company attendance |

**Scheduling, billing, settings, permissions**

| Method | Path | Access | Purpose |
|---|---|---|---|
| CRUD | `/shifts[/:id]`, `/schedules[/:id]` | admin, manager, hr | Shift templates and per-day schedules |
| GET | `/billing/employees`, `/billing/report` | `view_billing_amounts` | Billing report data |
| GET | `/settings/idle-policy` | auth | Effective idle policy for the caller (+ exemption flag) |
| PUT | `/settings/idle-policy` | admin | Global idle threshold / auto-logout |
| GET / PUT | `/settings/employee-idle-policies[/:employeeId]` | alpha | Per-employee overrides |
| GET | `/permissions/me` | auth | Caller's effective permission keys |
| GET | `/permissions`; PUT `/permissions/roles/:role` | admin, alpha, manager | Permissions page data / save a role |
| GET | `/permissions/employees`; PUT `/permissions/employees/:employeeId` | admin, alpha, manager | Active hr / team lead / employee accounts with their personal exceptions / save one person's exceptions (`{ granted, revoked }`, the complete list) |

### 6.5 The timer engine

`modules/timers/taskTimeLogController.js` with `services/desktopTimerLease.js`.

**Start** (`POST /time-logs/start` with `project`, `task`, optional `client`,
`note`, `clientType`, `operationId`):
0. With an `operationId` the server first looks for a start already made with
   it and returns that timer (`replayed: true`), so a retry after a lost
   response never starts twice (unique per employee; reusing the ID for other
   work is refused). Desktop 2.0.1+ sends one.
1. Close this employee's stale desktop timers first.
2. Project must exist, be Active and not deleted. Client, if given, must be active.
3. Non-elevated users: a project restricted to teams must include their team.
4. The task must be active, not deleted, and visible to the user:
   - elevated roles (admin, manager, hr) can use any task;
   - team leads, any task of their team;
   - employees, tasks naming them in `assignedTo`, or team tasks with
     `assignToAllEmployees`.

   It must also belong to the project, or be a project-less work/break task.
5. Refuse if a timer is already running or paused (`code:
   "ACTIVE_TIMER_EXISTS"`; the unique index also guards against races, 409).
6. Create the log. If `clientType` is `desktop`, set `desktopHeartbeatAt`,
   which makes it a **leased** timer.

**Heartbeat**: one conditional update that extends a lease only while it is
still live (younger than 90 s); a lease already past that is not extended and
the sweep closes it. **Lease**: every 30 s (and before every timer action
except report reads, which rely on the 30 s sweep) the server closes leased
timers with no heartbeat for **90 s**. It stops them *at the last heartbeat*,
marks `stopReason: desktop_disconnected`, and closes open pauses. The 20 s /
90 s / 30 s timings belong together.

**Stop** (optional `idleSeconds`, `logoutReason`, `operationId`, `timeLogId`):
a retried stop with the same `operationId` returns the first result; with
`timeLogId` only that timer may be stopped (409 `TIMER_CHANGED` if another one
runs now). The stop is a single conditional update, so it never overwrites a
stop the lease sweep made at the same moment. If the desktop reports
`idleSeconds`, an `idle` pause is added covering that span. Totals are then
computed:

```text
totalPausedSeconds = sum of all pauses
totalIdleSeconds   = sum of pauses with reason "idle"
totalWorkedSeconds = (stoppedAt − startedAt) − totalPausedSeconds
```

**Breaks** are modelled as **tasks with `taskType: "break"`** (for example,
Lunch). The whole session is break time and is excluded from worked and
billable totals.

**Manual entries** (`modules/timers/manualTimeEntryController.js`):
- Who: admin, alpha, manager and HR for every employee, themselves included
  (HR also needs `add_manual_entries`, which it has by default); team leads,
  with that permission, for employees on their team but not themselves.
- Rules: the same project/task eligibility as starting a timer; a stop time
  after the start, not in the future, and at most 24 h; a reason of 5–500
  characters; **no overlap** with any existing session.
- They are stored as `entrySource: "manual"`. Deleting one is a soft delete
  (`manualEntry.deletedAt`).

### 6.6 Tasks

`modules/tasks/taskController.js`.

- **Visibility**: admin, manager and HR see all tasks. Team leads see their
  team's tasks. Employees see tasks naming them, plus whole-team tasks of
  their active team.
- **Creation (current UI)**: the Add Task form posts to `/tasks/bulk` with
  `autoProjects: true`. One task per name is stored with `project: null` and
  `assignToAllEmployees: true`, so it is usable with every active project of
  the selected teams. Team leads can only create for the single team they lead.
- **Duplicate protection**: a task is rejected with **409 `DUPLICATE_TASK`**
  when a non-deleted task of the same type has the same name (ignoring case
  and spaces), shares a team, and has an overlapping project scope (a null
  project overlaps every project). Edits are checked only when name, type or
  teams change. The check and the insert run one at a time
  (`serializeTaskWrite`).
- **Project resolution** (`utils/taskProjectResolution.js`): maps a set of
  teams to a project, using explicit project-team links first and older task
  history as a fallback.

### 6.7 Caching and incremental sync

Polling is frequent (desktop every 5–30 s, dashboard every 30 s), so several
layers keep load down:

| Layer | File | What it does |
|---|---|---|
| Auth cache | `services/authCache.js` | Skips two DB reads per request for 15 s |
| Revisions | `services/readRevisions.js` | Per-collection fingerprint (count, latest and sum of `updatedAt`), cached 5 s and invalidated on every write by a Mongoose plugin |
| Catalog cache | `middleware/catalogCache.js` | For `/clients`, `/projects`, `/tasks`: keyed by caller scope + revisions; in-memory copy for 60 s and an **ETag/304** for up to 5 min |
| Report sync | `services/reportSync.js` | With `?sync=true` a report returns a `sync` marker; the next request sends it back and receives only **changed rows + `removedIds`** (delta), within 5 minutes and if nothing structural changed |
| Report fingerprint | `services/reportSync.js` (`reportChecksum`) | With `?checksum=true` a delta also carries the complete report's row count and sum of change-seconds; the dashboard compares it with its merged copy and skips the 5-minute full reload while they match (hourly reload kept) |
| Long-poll wake-ups | `services/loginNotifications.js` | "Another device" long-polls read MongoDB once and then wait for an in-process change notification instead of re-reading every 5 s |

Clients that support sync: the desktop timesheet (`loadAllPages` in
`renderer.js`) and dashboard reports (`utils/reportLoader.js`, which also uses
the fingerprint). Desktop project and task lists revalidate with the catalog
ETag (`cache: "no-cache"`, desktop 2.0.1+), so an unchanged list is a 304.

### 6.8 Billing

`modules/billing/billingController.js` + `utils/billingUtils.js`; page
`dashboard/src/pages/shared/BillingPage.jsx`.

- **Input**: one employee and a date range (at most 366 days), in `APP_TIMEZONE`.
- **Data**: stopped, non-deleted sessions overlapping the range. Sessions are
  split at day boundaries and paused time is excluded.
- **Rate**: `Employee.projectRates` (per employee, per project). Amount =
  hours × rate, rounded to cents only at the end.
- **Missing rate**: shown as "Charge rate not configured"; that amount is
  excluded from totals and listed in warnings.
- **Output**: project-wise task summary, daily details, totals. The **Excel
  export is built in the browser** (ExcelJS).

### 6.9 Idle policy

`utils/idlePolicy.js`, `modules/settings/settingsController.js`.

- Defaults come from `desktop-app/idle-policy-defaults.json`: idle threshold
  **5 min**, auto-logout **50 min**. Allowed ranges are idle 1–240 and logout
  2–480, and logout must be greater than idle. The backend falls back to a
  copy of these values if that file is missing.
- The global policy is stored in `SystemSettings` (edited by an admin).
- A per-employee override (alpha only) wins when valid.
- `idleTrackingExempt` employees are never stopped for idleness, but are
  still signed out at the logout threshold.

### 6.10 Scripts (`backend/scripts/`)

| Script | Purpose |
|---|---|
| `createAlpha.js` (`npm run create:alpha`) | Create the alpha super-admin |
| `createIdleExemptEmployee.js` | Create an idle-exempt test employee |
| `importUsersReport.js <xlsx>` | Import users into the **development** database |
| `backfillAttendance.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]` (`npm run backfill:attendance -- …`) | Build timer-based attendance rows for days before automatic attendance; dry run unless `--apply`; never changes older check-in rows |
| `repairEmployeeTeams.js` (`audit:teams` / `repair:teams`) | Audit/repair employee ↔ team links |
| `copyRecreatedProjectRates.js` | Copy billing rates after a project was recreated |
| `verifyBandwidthIndexes.js` | Read-only check that performance indexes exist |
| `verifySmtp.js` (`npm run test:smtp`) | Test email settings |
| `backupDatabase.js --out <folder> [--keep N]` (`npm run backup:db -- …`) | Save every collection (gzipped Extended JSON + manifest with counts and indexes); read-only |
| `restoreDatabase.js --from <backup> --to-db <name>` (`npm run restore:db -- …`) | Restore a backup into a **separate** database and verify counts; refuses the live database. See `docs/BACKUP_AND_RESTORE.md` |

### 6.11 Automatic attendance

`services/attendanceService.js`. Attendance follows the timers; nobody checks
in or out by hand.

- **Check-in** is the first session started on a company day (`APP_TIMEZONE`),
  **check-out** the last stop. While a timer is running or paused the day
  stays open (`checkOut` empty). Break tasks count as present.
- A day belongs to the date its sessions **started** on, so an overnight
  session checks out the next morning on the previous day's row.
- It is updated after every start, stop (including idle and inactivity
  stops), heartbeat-lease closure, manual entry and manual-entry deletion.
  Each update **recomputes the whole day** from its time logs, so it is
  idempotent and self-repairing. A day whose only activity was deleted is set
  to Absent rather than removed (so report delta-sync sees the change).
- Updates for one employee-day run one at a time in process memory. Errors
  are logged (`[attendance]`) and never fail the timer action.
- Rows from the older check-in API (`source: check_in`) are left untouched by
  the backfill script.

### 6.12 Traffic metrics, switches and operations

- **Metrics** (`monitoring/trafficMetrics.js`, on with `METRICS_ENABLED=true`):
  counts only, no personal data. Per route: requests, status classes,
  compressed response bytes, time. Per MongoDB command + collection: count and
  approximate bytes. Per outside destination (`mongodb-atlas`, SMTP,
  `http-clients`): bytes and connections. A `[metrics]` line is logged every
  10 minutes and `GET /api/metrics` (admin-level) returns the totals.
- **Alerts**: `[alert]` log lines when a 10-minute window shows more than 20
  server errors, more than 10 timers closed for missed heartbeats, more than 20
  new MongoDB connections, failed MongoDB monitoring checks, failed sweeps
  (also after 3 in a row), long-polls that stop waiting (300+ in a window
  averaging under 5 s), or more than 50 MB to one destination
  (`METRICS_ALERT_MB_PER_WINDOW`).
- **Health** (`monitoring/health.js`): `GET /health` is 503 while MongoDB is
  disconnected (`HEALTH_CHECK_DATABASE=false` restores the old always-200).
- **Switches** (`config/optimizations.js`), all on unless set to `false`:
  `OPT_LONGPOLL_EVENTS`, `OPT_HEARTBEAT_SINGLE_WRITE`, `OPT_REPORTS_SKIP_SWEEP`,
  `OPT_STATIC_ASSET_CACHE`, `OPT_REPORT_CHECKSUM`; pool size
  `MONGODB_MAX_POOL_SIZE` (default 10). Details:
  `docs/CRM_OPTIMIZATION_PHASE_PLAN.md`.
- **Dashboard files**: hashed files under `/assets` are cached for a year;
  `index.html` is always re-checked.

---

## 7. Dashboard (web app)

### 7.1 Stack and entry

React 19, React Router 7, Vite 8, axios, lucide-react icons, ExcelJS and jsPDF
(exports, loaded on demand).

```text
main.jsx → <BrowserRouter> → <AuthProvider> → App.jsx
App.jsx → <ThemeProvider> → <ErrorBoundary> → <AppShell><AppRoutes/></AppShell> + <ThemeSelector/>
```

- **`AppShell`** (`components/layout/AppShell.jsx`): the sidebar, top bar,
  page search and sign-out for every signed-in page. It also long-polls
  `/auth/login-requests/pending` and shows the "Another device is trying to
  sign in" dialog.
- **Navigation**: items come from `components/layout/workspaceNavigation.js`
  (`navigationForRole`), filtered by role and then by each item's `needs`
  (permissions its data requires). Alpha uses the admin menu. Team leads also
  get "Team members". Non-admins with delegated employee permissions get
  "Employees". Shifts and schedules are deliberately not in the menu.
- **`DashboardLayout`**: a page wrapper that shows the title and, on
  `/…/dashboard` pages, "Welcome back".

### 7.2 Auth in the browser (`context/AuthProvider.jsx`)

- **localStorage keys**: `token`, `user`, `rememberedSessionToken`,
  `rememberedUser`, `crmDeviceId` (per-browser device id from
  `utils/deviceIdentity.js`, sent as `clientType: "web"`).
- **On load**: the stored token is validated with `/auth/me`.
- **Permissions**: `/permissions/me` is loaded for each session, again when
  the tab becomes visible, and whenever an API response's
  `X-Permissions-Version` fingerprint changes (set by `protect`;
  `api/permissionVersion.js`), so a change an administrator or manager makes
  reaches open pages within one request. `useAuth()` exposes `hasPermission(...keys)`
  (true when the user holds all of them; admin-level roles always do),
  `permissionsReady` and `permissionsFailed`. Pages use it to hide menus and
  buttons; `PermissionNote` explains hidden actions ("View only. Your role
  needs …"). The API still enforces everything.
- **Login** handles the 409 device-approval flow and the remembered-account
  "quick login".
- **`api/axiosInstance.js`** adds `Authorization: Bearer`. On any **401** or
  `ACCOUNT_INACTIVE` it clears the session and sends the user to `/login`,
  keeping the reason in `sessionStorage.sessionEndedMessage`.

### 7.3 Routes (`routes/AppRoutes.jsx`)

Guards are thin wrappers around `ProtectedRoute`. Manager and alpha pass any
guard that allows `admin`. A route can also declare `needs` (permissions its
data requires). Without them the page shows an explanation (`AccessDenied`)
instead of failing with API errors.

| Guard | Roles |
|---|---|
| `AdminOnly` | admin, alpha, manager |
| `AdminStaffOnly` | admin, alpha, manager, hr |
| `TeamLeadOnly` | team_lead |
| `EmployeeOnly` | employee |
| `AttendanceStaffOnly` | hr, manager |

| Path | Guard | Page |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password` | public | auth pages (`/`, `/admin/login`, `/team-lead/login` redirect to `/login`) |
| `/admin/dashboard` | AdminStaffOnly + `view_all_reports` | `AdminReportPage` (overview) |
| `/admin/my-timesheet`, `/admin/my-timesheet/details` | AdminStaffOnly | `AdminReportPage` (personal) |
| `/admin/timesheets/{team,detailed,project-hours,count,working-today,task-tracker,project-work}` | AdminStaffOnly + `view_all_reports` | `AdminReportPage` (company views) |
| `/admin/timesheets/attendance` | AdminStaffOnly | `AdminReportPage` (company attendance, in the menu as "Attendance") |
| `/attendance` | AttendanceStaffOnly | `AdminReportPage` (attendance) |
| `/admin/clients`, `/admin/projects`, `/admin/tasks`, `/admin/team` | AdminStaffOnly | catalog pages; add/edit/delete controls follow `manage_clients`, `manage_projects`, task and team permissions |
| `/admin/tasks/new` | AdminStaffOnly + `create_tasks` | `AdminAddTask` |
| `/admin/employees` | admin/alpha/manager **or** delegated `create/edit_employees` | `AdminEmployees` |
| `/admin/scheduler/shift`, `/shift/add`, `/schedule` | AdminStaffOnly | shifts and schedules (not in the sidebar menu) |
| `/admin/billing` | AdminStaffOnly + `view_billing_amounts` | `BillingPage` |
| `/admin/settings`, `/admin/permissions` | AdminOnly | idle/logout settings; permissions by role or by employee |
| `/team-lead/dashboard`, `/employee-insights`, `/timesheets/*` (except attendance) | TeamLeadOnly + `view_team_timesheets` | `RoleReportPage` (team) |
| `/team-lead/timesheet[/details]`, `/team-lead/timesheets/attendance` | TeamLeadOnly | `RoleReportPage` (personal; team attendance) |
| `/team-lead/tasks` | TeamLeadOnly | team task management |
| `/team-lead/tasks/add` | TeamLeadOnly + `create_tasks` | `TeamLeadAddTask` |
| `/employee/dashboard`, `/employee/timesheet[/details]` | EmployeeOnly | `RoleReportPage` (personal) |
| `/profile` | any signed-in role | `ProfilePage` |
| `/employees`, `/employees/:employeeId` | admin roles, team_lead (and delegates) | employee list / details |
| `*` | — | redirect to `/login` |

`npm run test:routes` (`scripts/audit-routes.mjs`) checks that every
navigation target, including every sidebar entry, is a registered route.

### 7.4 Reports

- **One page per audience.** `AdminReportPage` (admin side) and
  `RoleReportPage` (team lead and employee) render all report URLs. Props
  choose the view: `mode` time/attendance, `scope` company/team/personal,
  and `variant` summary/team/detailed.
- **Loading.** `utils/reportLoader.js` loads all pages (100 per page), caches
  up to 12 reports, and uses the delta sync in [6.7](#67-caching-and-incremental-sync).
- **Timeline.** `utils/timeLogTimeline.js` turns sessions into work, break and
  idle segments. Gaps between sessions on the same day count as idle.
- **Exports.** `utils/reportExport.js` produces Excel (ExcelJS) and PDF (jsPDF).
  The buttons appear only with `export_reports`.
- **Manual entries.** Users with `add_manual_entries` get "Add entry"
  (`components/reports/AddEntryModal.jsx`) and the manual-entries list.
  Managers and HR can also add their own from "My timesheet".
- **Attendance.** "Attendance" in the menu (admin, manager, HR, team lead)
  lists the automatic daily rows: date, check in, check out, hours, status.

### 7.5 Main pages

| Page | File | Notes |
|---|---|---|
| Employees | `pages/admin/AdminEmployees.jsx` + `components/employees/EmployeeForm.jsx` | Create/edit, team, per-project charge rates, delegated permissions |
| Teams | `pages/admin/AdminTeams.jsx` | Team lead assignment |
| Clients | `pages/admin/AdminClients.jsx` | Add/rename/deactivate; errors show inside the Add dialog |
| Projects | `pages/admin/AdminProjects.jsx` | Clients and teams per project, status |
| Tasks | `pages/admin/AdminTasks.jsx`, `pages/teamLead/TeamLeadTasks.jsx`, shared `components/tasks/TaskForm.jsx` | Create several names at once; double-submit guarded |
| Shifts / Schedule | `pages/admin/AdminShifts.jsx`, `AdminAddShift.jsx`, `AdminSchedule.jsx` | |
| Billing | `pages/shared/BillingPage.jsx` | [6.8](#68-billing) |
| Idle & logout | `pages/admin/AdminSettings.jsx` | Global idle/logout minutes |
| Permissions | `pages/admin/AdminPermissions.jsx` | Per-role switches with descriptions, role availability, search/filter, sensitive-change confirmation |
| Profile | `pages/profile/ProfilePage.jsx` | Own details and password |

**Polling**: `hooks/useDataRefresh.js` re-runs a page's loader every 30 s while
the tab is visible, and on focus or coming back online.

**Styling**: plain CSS files in `styles/` (one per page or area), with
`themes.css` holding the palettes chosen with the floating Theme button
(`ThemeContext`, saved per device).

---

## 8. Desktop app (Electron)

### 8.1 Process model and security

| File | Process | Responsibility |
|---|---|---|
| `main.js` | main (Node) | Creates the window, IPC handlers, device identity, close handshake, single-instance lock, timer-lock wiring, auto-updater |
| `preload.js` | isolated bridge | Exposes `window.electronAPI` (API URL, device info, system idle time, idle defaults, close/lock/resume hooks). Nothing else from Node reaches the page. |
| `renderer.js` | page | All UI logic for both pages (login and timer); about 2,500 lines |
| `timer-lock.js` | main | Full-screen lock controller |
| `app-updater.js` | main | Auto-update service |

The window is built with `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true` and `backgroundThrottling: false`, so timers keep running
while minimized. Other security measures:
- the pages set a strict CSP;
- navigation is restricted to the app's own files;
- `window.open` only opens the production site in the browser.

**API URL** (`api-config.js`): `npm start` (unpackaged) uses
`http://localhost:5000/api`, and the installed app uses
`https://handdy-workspace.onrender.com/api`. `HANDDY_API_URL` overrides both.

**Device identity**: `userData/device.json` holds a persistent random
`deviceId`. It is sent at login; the backend's one-desktop-session rule and
device approval depend on it.

### 8.2 Pages

- **`index.html` (login)**: email/password, or the remembered account card
  ("Login" without a password uses quick login). If the account is active on
  another computer, the page waits (long-poll) for approval there.
- **`dashboard.html` (timer)**: two tabs.
  - **Timer**: Project → Client → Task drop-downs, Start/Stop, note,
    break clock and "Stop Break" for break tasks.
  - **Dashboard**: today's timesheet. Work, break and idle segments are
    listed in time order with totals.

The selected project, task and client are remembered per user in
localStorage (`desktop-work-selection:<user>`). A timer that is already
running on the server is always restored from `/time-logs/active`.

### 8.3 Background loops (`renderer.js`)

| Interval | Function | Purpose |
|---|---|---|
| 5 s | `checkSystemIdleState` | Read OS idle time, idle stop and auto-logout, re-report lock state |
| 20 s | `sendTimerHeartbeat` | Keep the server lease; a 404 means the server closed the timer, so it reloads |
| 30 s | `refreshDesktopData` (also on focus/online/visible) | Session check (`/auth/me`), today's timesheet, clients/projects/tasks |
| 60 s | `loadIdlePolicy` | Pick up idle-policy changes |
| long-poll | `monitorDeviceLoginRequests` | Show "another device wants to sign in" |

### 8.4 Idle detection and auto-logout

Source: `powerMonitor.getSystemIdleTime()`, i.e. OS-level time since the last
mouse or keyboard input. No content is captured.

1. **Idle stop.** Idle time reaches the threshold while a work timer runs
   (not a break task, not an intentional break, not exempt). The app freezes
   the clock, stops the timer with `idleSeconds` (the server records an idle
   pause), and shows the **"You have been inactive"** dialog with the logout
   countdown. Activity never resumes the timer; the employee clicks
   **Continue**, then **Start**.
2. **Auto-logout.** Idle time reaches the logout threshold, for every
   signed-in user. The app stops any timer (`logoutReason: inactivity`),
   calls `/auth/logout` and revokes the remembered token, then returns to the
   login page with a message. If the network is down, it keeps retrying and
   never discards the token needed to stop the timer.

For local testing, `idleWarningTestSeconds` in `idle-policy-defaults.json`
can shorten the threshold (keep it `0` in commits).

### 8.5 Screen lock (`timer-lock.js`)

While a signed-in employee has **no running timer** (after Stop, idle stop or
an app restart), the screen is locked:

- **Overlays.** A blank, non-focusable, always-on-top overlay covers every
  monitor, including the taskbar.
- **The CRM window** stays on top of the overlays. It cannot be minimized or
  closed, and focus is pulled back to it when another app is activated.
- **Unlocking.** Starting a timer (including a break task) removes the lock
  as soon as the start request is sent, not when the server answers (since
  2.0.1). If the server refuses the start, the lock returns with its
  message. If CRM was minimized before, it is minimized again. Signing out
  also releases the lock.
- **What locks.** The renderer reports `locked` / `running` / `inactive` on
  every state change and every idle poll. It reports `inactive` (no lock) on
  the login page, while signing out or closing, until the server has
  confirmed the timer state, and **while the server is unreachable**. That
  last case exists so an outage can never trap someone who needs to reach
  network settings.
- **Safety nets.** If the renderer stops reporting for 30 s, or crashes, the
  main process releases the lock. Windows shutdown or sign-off releases it
  too.
- **Monitors and sleep.** Overlays are rebuilt when monitors change and
  after wake. On wake the renderer also re-checks the timer.
- **No reordering.** The once-a-second upkeep only repairs hidden or
  minimized windows. It must **not** reorder windows, because Chromium draws
  an open drop-down list as a separate window and moving CRM to the front
  would hide it.

Limits that an Electron app cannot override: Ctrl+Alt+Del, Task Manager
"always on top", switching virtual desktops.

### 8.6 Closing the app

The window's close is intercepted.
- If locked: closing is ignored.
- Otherwise: main sends `app:before-close` and the renderer stops the active
  timer on the server, then replies `app:close-ready`.
- If the stop cannot be confirmed: the close is cancelled and the employee is
  told. After 25 s with no answer, a warning dialog appears.

Closing CRM never leaves a timer running by accident. A second launch focuses
the existing window (single-instance lock).

### 8.7 Updates, packaging, release

- **Auto-update** (`app-updater.js`, installed Windows builds only): checks
  GitHub Releases 15 s after start, then every 6 h (15 min after a failure).
  It downloads silently and shows a notification when ready. Since 1.2.32 it
  then **restarts CRM by itself** to install the update, but only when no
  timer can be interrupted: CRM is on the login page or the screen is locked
  (timer confirmed stopped), that has lasted a minute, and the PC has had no
  keyboard or mouse input for a minute. `main.js` runs the normal close
  handshake first, then the installer runs silently and reopens CRM (the
  session is kept). A refused close is retried later without a warning. If
  CRM is closed before that, the update installs on close as before. A
  running timer, including a break task, is never stopped for an update.
  See `AUTO_UPDATE.md`.
- **Build**: `npm run build` produces the NSIS installer
  `dist/CRM-<version>-Windows-x64.exe`. `build/installer.nsh` repairs
  existing CRM shortcuts. The files that ship are listed in
  `package.json → build.files`; **add any new top-level file there**.
  `test/packaging-files.test.js` walks what the app loads at runtime
  (requires, `loadFile`, page navigation, page scripts/styles) and fails if
  any of it is missing from `build.files`.
- **Release**: `npm run publish` (`scripts/publish-release.cjs`) validates the
  version against GitHub and uploads a *draft* release. It requires
  `GH_TOKEN` and code signing (`build:signed`).

---

## 9. Key flows end to end

### 9.1 An employee's working day

```text
Desktop start ─► index.html: login (or quick login) ─► dashboard.html
  ├─ GET /auth/me, /settings/idle-policy, /clients, /projects, /time-logs/active
  ├─ no running timer ─► screen locked, Timer tab shown
  ├─ choose Project → Client → Task, Start ─► POST /time-logs/start ─► unlocked
  ├─ every 20 s POST /time-logs/heartbeat; every 30 s refresh data
  ├─ lunch: Stop, start a break task ("Lunch (Break)") ─► counted as break
  ├─ 5 min without input ─► POST /time-logs/stop {idleSeconds} ─► idle dialog + lock
  ├─ Continue ─► choose task ─► Start
  └─ close CRM ─► POST /time-logs/stop ─► app exits
Server: totals computed at stop; reports and billing read task_time_logs.
```

### 9.2 Signing in on a second computer

```text
PC-B: POST /auth/login ─► 409 DEVICE_APPROVAL_REQUIRED {requestId, requestToken}
PC-B: POST /auth/login-requests/:id/wait   (long-poll, repeats until decided or expired)
PC-A: GET  /auth/login-requests/pending    (long-poll) ─► dialog "Keep / Allow"
PC-A: POST /auth/login-requests/:id/decision {allow}
       ─► PC-A session revoked, PC-B session activated ─► PC-B receives its token
       ─► PC-A's next request gets 401 SESSION_REVOKED ─► back to login
```

Web browsers are not part of this rule (several browser sessions may coexist).

### 9.3 Creating a task (admin or team lead)

```text
TaskForm ─► POST /tasks/bulk {taskNames[], teams[], taskType, autoProjects:true}
  ├─ requirePermission(create_tasks) + guard: reassign_tasks (only when picking employees)
  ├─ validate teams (team lead: only own team) and that each team has an active project
  ├─ duplicate check vs. existing tasks (409 DUPLICATE_TASK with a readable message)
  └─ insert one team-wide task per name (project:null) ─► visible in the desktop
     task list for every active project of those teams
```

---

## 10. Configuration

### Backend (`backend/.env`, Render environment)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` | yes | — | Atlas connection string |
| `JWT_SECRET` | yes | — | Token signing secret (≥ 32 chars in production) |
| `NODE_ENV` | prod | — | `production` enables strict checks and headers |
| `FRONTEND_URL` | prod* | `RENDER_EXTERNAL_URL` or `http://localhost:5173` | HTTPS origin used in reset links (*or Render's URL) |
| `PORT` | no | 5000 | Listen port |
| `APP_TIMEZONE` | no | `Asia/Kolkata` | Company day boundaries (attendance, "today", billing) |
| `CORS_ORIGINS` | no | — | Extra allowed browser origins (comma-separated) |
| `JWT_EXPIRES_IN` | no | `7d` | Token lifetime |
| `AUTH_SESSION_LIFETIME_MS` | no | 7 days | Session expiry |
| `AUTH_SESSION_OFFLINE_GRACE_MS` | no | 5 min | Inactive desktop session counts as expired |
| `LOGIN_REQUEST_LIFETIME_MS` | no | 2 min | Second-device approval window |
| `REMEMBERED_SESSION_DAYS` | no | 30 | Quick-login token lifetime |
| `AUTH_CACHE_TTL_MS` | no | 15000 | Auth cache (0 = off) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for resets | — | Password-reset email (development logs the link instead; production cannot send resets without them). Declared in `render.yaml` with `sync: false`: enter the values in the Render dashboard. Delivery failures are logged without the reset link. |
| `MONGODB_DNS_SERVERS` | no | — | Custom DNS for Atlas SRV lookups |

### Dashboard (`dashboard/.env`, build time)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | dev `http://localhost:5000/api`, prod `/api` | API base |
| `VITE_APP_TIMEZONE` | `Asia/Kolkata` | Must equal the backend `APP_TIMEZONE` |

### Desktop

| Setting | Purpose |
|---|---|
| `HANDDY_API_URL` (env) | Point the app at another API (staging) |
| `idle-policy-defaults.json` | Default idle/logout minutes and limits (shared with backend and dashboard) |

---

## 11. Running locally

```bash
# 1) Backend  (needs backend/.env with MONGODB_URI and JWT_SECRET)
cd backend && npm install && npm run dev        # http://localhost:5000 (nodemon)

# 2) Dashboard
cd dashboard && npm install && npm run dev      # http://localhost:5173

# 3) Desktop app (talks to http://localhost:5000/api)
cd desktop-app && npm install && npm start
```

Tips:
- Electron loads `main.js` and `timer-lock.js` **once at startup**. After
  changing main-process code, quit CRM completely and run `npm start` again.
  While the screen lock is up, CRM cannot be closed: start a timer or sign out
  first, or press Ctrl+C in the `npm start` terminal.
- In Git Bash, `VITE_API_URL=/api` is rewritten into a Windows path. Use
  `MSYS_NO_PATHCONV=1 VITE_API_URL=/api npm run build`, or run from
  cmd/PowerShell.

---

## 12. Deployment and releases

**Web (Render, `render.yaml`)**:
- One `starter` web service, Node runtime, `numInstances: 1` (see
  [14](#14-known-gaps-and-gotchas), single-instance assumptions).
- Build: install backend and dashboard dependencies, then `npm run build
  --prefix dashboard` with `VITE_API_URL=/api`.
- Start: `npm start --prefix backend`. The backend serves `dashboard/dist`,
  so the dashboard and API share one domain.
- Secrets (`MONGODB_URI`, `CORS_ORIGINS`, `FRONTEND_URL`, `SMTP_*`,
  `MAIL_FROM`) are set in Render; `JWT_SECRET` is generated by Render.
- Health check: `/health` (503 while MongoDB is unreachable).

**Desktop**:
1. Bump `desktop-app/package.json` → `version`.
2. Run `npm test`.
3. Run `npm run build` (or `npm run publish` with signing and `GH_TOKEN`).
4. Publish a GitHub Release tagged `v<version>` with the `.exe`, `.blockmap`
   and `latest.yml`.

Installed apps pick the release up automatically: from 1.2.32 they restart to
install once no timer runs and the PC is idle for a minute, otherwise on close.
Step-by-step deploy, checks and rollback: `docs/DEPLOY_AND_ROLLBACK.md`.
Backups: `docs/BACKUP_AND_RESTORE.md`.

---

## 13. Tests

All suites use Node's built-in `node:test`.

| Suite | Command | What it covers |
|---|---|---|
| Backend (224 tests) | `cd backend && npm test` | Auth sessions, remembered login, permissions (any duty for any role, own-team scope, descriptions), billing math, idle policy, timer lease/idle stop, timer safety (retries, races, restarts), automatic attendance, manual entries, password-reset email over SMTP, task bulk create and duplicates, report ranges, caching, report fingerprint, traffic metrics, alerts, health, graceful shutdown, backups, module loading |
| Dashboard (60 tests) | `cd dashboard && npm test` | Report helpers, timelines, pagination, report loading and fingerprint, manual-entry and client-timesheet utils, form validation, permission-driven navigation and duty pages, personal permission rules, permission-change pickup |
| Dashboard lint / routes | `npm run lint`, `npm run test:routes` | ESLint; every nav link has a route |
| Desktop unit (119 tests) | `cd desktop-app && node --test --test-isolation=none test/*.test.js` | Runs the real `renderer.js` in a VM with a fake DOM/API (idle, logout, close, timesheet, lock states (lifted when Start is sent), start/stop retries, list caching), `timer-lock.js` with fake windows, updater and automatic restart, permission refusal, release config, packaged runtime files |
| Desktop full | `cd desktop-app && npm test` | Unit tests plus real-Electron smokes (`electron-inactivity-smoke.cjs`, `dashboard-lifecycle-smoke.cjs`, which builds the dashboard first). The lifecycle smoke checks the 30-second polling cadence from call times, and permission-driven menus and actions. The smokes rewrite screenshots in `dashboard/ui-review/`. |

---

## 14. Known gaps and gotchas

Found while reviewing the code for this guide. None of them are bugs in time
recording itself; they are places where behaviour may surprise a developer or
an admin.

1. **"Create tasks" works on its own** (since 2026-10-27). The form creates
   whole-team tasks; `assign_tasks`, which used to be required as well, was
   folded into `create_tasks`. Stored grants of it are ignored.
2. **Some permissions are catalogued but not used yet** (`enforcement:
   "none"`, for example `view_tasks` and `view_clients`); the Permissions page
   labels them "Not used yet". Management permissions apply only to the
   roles that have a screen for them (`roles` in `utils/permissions.js`).
3. **Shifts and schedules have pages but no menu entries** (reach them at
   `/admin/scheduler/*`). This is intentional (product decision, 2026-10-23).
4. **Service type is legacy.** Projects no longer store one; the Billing and
   Tasks tables show the column only when old data has it. It is kept
   read-only so historical records stay readable; nothing writes it.
5. **Single-instance assumptions.** Rate limits, auth/catalog/permission
   caches, the timer sweep coordination, attendance updates and the task
   duplicate-check queue live in process memory. `render.yaml` pins
   `numInstances: 1`. Running more than one backend instance needs a shared
   store, a database unique index for task duplicates (after cleaning existing
   duplicates) and concurrency tests first.
6. **Days before automatic attendance have no rows** until
   `scripts/backfillAttendance.js --apply` is run for that range.
7. **The desktop main process needs a restart** after changes to `main.js`
   or `timer-lock.js` (see [11](#11-running-locally)).
8. **New desktop files must be added to `build.files`** in
   `desktop-app/package.json`; `test/packaging-files.test.js` catches it.
9. **SMTP values live only in Render.** `render.yaml` declares `SMTP_*` and
   `MAIL_FROM` with `sync: false`; without values, "Forgot password" answers
   normally but no email is sent (the failure is logged).
10. **Backups depend on the Atlas tier.** Free/shared tiers have no automatic
    snapshots; run `scripts/backupDatabase.js` on a schedule
    (`docs/BACKUP_AND_RESTORE.md`).
11. **Tokens are kept in browser/app storage** (`localStorage`). A strict CSP
    limits the risk; moving them to an httpOnly cookie (dashboard) or the OS
    keychain (desktop) is a recommended later change (`docs/SECURITY_REVIEW.md`).
12. **Old documentation.** `README_MERGED.md` and the `*_REPORT.md` /
    `CODE_AUDIT.md` files describe earlier states of the project; prefer this
    guide and the code.
