# CRM Codebase Guide and Improvement Plan

> **Scope:** CRM Employee Time & Attendance System, desktop version 1.2.30.
> **Status:** Documentation review only. The issues below are reported by the supplied `CODEBASE_GUIDE.md`; no repository source code was inspected, changed, or tested as part of preparing this file.
> **Usage:** Give this file to Codex along with the repository. Confirm each finding against current code before implementing a fix.

## 1. Executive summary

The supplied guide describes a Node/Express + MongoDB backend, React/Vite dashboard, and Electron desktop app. Its documented strengths include server-authoritative timer calculations, database-backed active-timer uniqueness, heartbeat leases, device-session approval, soft deletion, and incremental synchronization. The guide also explicitly identifies incomplete permission enforcement, disconnected attendance controls, stale smoke-test expectations, and operational risks. Prioritize correctness and safety before optimization.

## 2. Confirmed documentation findings and required investigation

The following are **findings stated by the guide**, not independently verified runtime defects.

| ID | Priority | Finding from guide | Required action | Acceptance criteria |
|---|---|---|---|---|
| CRM-01 | High | Dashboard menus, routes and buttons are role-based; most do not react to configurable permissions. | Fetch effective permissions via `/permissions/me`; apply them consistently to navigation, routes and actions, retaining backend enforcement. | A denied action is hidden or disabled with an explanation; API rejects unauthorized requests; newly granted actions become accessible after refresh. |
| CRM-02 | High | Several permission catalog entries are marked `enforcement: none`. | Inventory every catalog key and its API/UI usage; implement real authorization where the business policy requires it, or mark it clearly as informational until supported. | Each switch has a documented effect; permission tests cover allowed and denied roles. |
| CRM-03 | High | Attendance check-in/out API exists but no live UI calls it; guide says new attendance rows are not created. | Decide with product owner whether attendance should be automatic from desktop login/timer or explicit check-in/out. Implement one authoritative workflow, including overnight/timezone handling. | One attendance record per employee/day; check-in/out occurs as specified; reports reconcile with records; no duplicate check-ins. |
| CRM-04 | High | `dashboard-lifecycle-smoke.cjs` expects 10-second polling, while dashboard polling is now 30 seconds. | Update the test to assert current behavior without brittle timing; run full desktop smoke suite. | Full desktop test suite passes and validates 30-second polling. |
| CRM-05 | Medium | Creating a team-wide task requires both `create_tasks` and `assign_tasks`. | Clarify the dependency in permission descriptions; optionally disable task creation when either is absent. | UI and API agree; a user understands why creation is unavailable. |
| CRM-06 | Medium | HR cannot add manual entries even if `add_manual_entries` is granted because target-employee rules exclude HR. | Confirm intended HR policy; update `canActOnEmployee` only if HR is authorized, with scope tests. | Permission switch and target eligibility behave consistently. |
| CRM-07 | Medium | Shift/schedule pages exist but are absent from sidebar navigation. | Add role-appropriate navigation if those screens are intended for active use. | Authorized staff can navigate to shifts/schedules; route audit passes. |
| CRM-08 | Medium | Production password reset depends on SMTP configuration absent from `render.yaml`. | Configure SMTP secrets securely in Render, verify send/delivery/error handling, and document setup. | Password reset email arrives in production; failures are logged without exposing tokens. |
| CRM-09 | Medium | In-memory rate limits, caches, task serialization and timer-sweep coordination assume a single backend instance. | Document the single-instance limit; before scaling horizontally, design shared rate limits/coordination and database-enforced integrity. | Multi-instance rollout is blocked until race-condition and concurrency tests pass. |
| CRM-10 | Low | Unused dashboard components and obsolete sidebars remain. | Verify references and imports before removing unused code. | Builds and route/UI tests pass; no needed behavior disappears. |
| CRM-11 | Low | Project `serviceType` is legacy and appears only for old records. | Determine whether legacy reporting needs it; migrate or retain with explicit compatibility rules. | Historical data remains readable; billing and task views are consistent. |
| CRM-12 | Medium | New desktop top-level files must be listed in Electron `build.files`. | Add a packaging validation check for runtime assets. | Installed build contains all required files and starts successfully. |

## 3. Additional review checks (not confirmed bugs)

### Desktop timer, idle, and lock safety
- Test idle threshold, 50-minute default logout, policy overrides and exemptions, break-task behavior, and session recovery after app restart.
- Test heartbeat interruption and restoration, machine sleep/wake, offline startup, and server downtime. Ensure a network outage cannot trap the user behind the screen overlay.
- Verify lock behavior with multiple monitors, focus changes, dropdown windows, crash recovery, Windows shutdown, and close handshake.
- Ensure the server never double-counts a stopped timer or counts time beyond the last valid heartbeat.
- Test auto-update installation, signed release artifacts, version increments, rollback/recovery, and whether installed older clients remain compatible.

### Security and permissions
- Verify JWT/session revocation, device approval, role boundaries, delegated employee permissions, password reset, input validation, and IPC exposure.
- Audit all API endpoints independently of dashboard visibility; hiding a button is not an authorization control.
- Check whether browser token storage meets the application's threat model and whether sensitive information can leak to logs.

### Data, billing, and performance
- Validate MongoDB indexes, query plans, connection pool settings, pagination, delta-sync reconciliation, and cache invalidation after writes.
- Test overnight sessions, daylight/timezone boundaries, pauses, break tasks, manual-entry overlap, soft-deleted records, missing rates, and rounding.
- Reconcile the same sample period across desktop timesheet, dashboard report, billing view, Excel export, and PDF export.
- Measure production query counts, p95 API latency, memory use, and network transfer before claiming performance gains.

### UI and operations
- Check loading/empty/error states, accessibility, date display consistency, and role-specific navigation.
- Confirm Render environment variables, HTTPS/CORS behavior, MongoDB connectivity, SMTP delivery, and health checks.
- Verify backup/restore procedures and rollback steps before any database migration.

## 4. Implementation order

1. **Baseline:** Record current branch/commit, environment, build commands, existing test failures, and representative test accounts; back up production data before migrations.
2. **Permissions:** Implement CRM-01, CRM-02 and CRM-05 together; write role-by-permission API and UI tests.
3. **Attendance:** Obtain a product decision for CRM-03, then implement and test the chosen check-in/out workflow.
4. **Regression tests:** Fix CRM-04 and run backend, dashboard, route, lint and desktop suites.
5. **Policy/navigation:** Resolve CRM-06 and CRM-07 with explicit business-rule approval.
6. **Production readiness:** Address CRM-08, CRM-12 and desktop lock/recovery tests.
7. **Performance/scaling:** Profile first, then tackle CRM-09 and measured bottlenecks.
8. **Cleanup:** Address CRM-10 and CRM-11 without deleting historical data.

## 5. Commands to verify in the repository

```bash
cd backend && npm test
cd ../dashboard && npm test
npm run lint
npm run test:routes
cd ../desktop-app && npm test
```

Run commands separately in a supported shell. Confirm package scripts exist and required Electron/display prerequisites are available. The guide reports 160 backend, 43 dashboard and 98 desktop unit tests, but these are **documented counts**, not fresh results.

## 6. Required completion report

For each issue, record:

| Field | Required evidence |
|---|---|
| Finding | Reproduced symptom, affected role/workflow, source file and line |
| Classification | Confirmed bug, intended behavior, documentation mismatch, or improvement |
| Decision | Approved expected behavior, especially for attendance and HR permissions |
| Change | Files edited, migration requirements, and backward-compatibility impact |
| Validation | Commands executed, test counts, pass/fail, manual test scenario |
| Deployment | Render/desktop release requirements, rollback instructions |
| Remaining risk | Any unresolved scenario and its owner |

## 7. Codex implementation prompt

> Review the CRM repository against `CRM_CODEBASE_REVIEW_AND_FIX_PLAN.md` and `CODEBASE_GUIDE.md`. First verify every documented finding in the current code and produce a short evidence-based issue list. Do not assume that every documented gap is still present. Implement approved fixes in small steps, prioritizing permissions, attendance integration, and the stale desktop smoke test. Preserve existing functionality, historical records, security boundaries, and compatibility with deployed desktop versions. Do not silently change HR authorization, attendance policy, or billing rules: identify decisions needed before coding. Add automated tests for each fix; run the backend, dashboard, route, lint, and desktop suites; report any environmental limitations. Update `CODEBASE_GUIDE.md` to match the resulting implementation. Finish with changed files, test evidence, deployment/rollback notes, and unresolved risks. Never claim a test passed unless it actually ran.

---

## 8. Original supplied codebase guide (preserved for reference)

# CRM — Employee Time & Attendance System: Codebase Guide

This guide explains how the whole system is built and how it works, from the
database up to the desktop app. It describes the code as it is in this
repository (desktop version 1.2.30). Older notes such as `README_MERGED.md`
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
│   ├── server.js             App setup, middleware, route mounting, startup
│   ├── src/
│   │   ├── config/           db.js (Mongo connection), productionConfig.js (env validation)
│   │   ├── models/           Mongoose schemas (one file per collection)
│   │   ├── routes/           Express routers: URL → middleware → controller
│   │   ├── controllers/      Request handlers (business logic)
│   │   ├── middleware/       Auth, role/permission gates, rate limit, caching, errors
│   │   ├── services/         Cross-cutting logic: sessions, caches, timer lease, sync
│   │   └── utils/            Pure helpers: dates, billing math, permissions catalog…
│   ├── scripts/              One-off admin/maintenance scripts
│   └── test/                 node:test unit tests (29 files)
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
│   ├── test/                 node:test unit tests for utils (9 files)
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
| `manager` | Admin-equivalent | Same application access as admin (`utils/roles.js` → `isAdminRole`), but cannot edit role permissions. |
| `hr` | Staff | Business modules (clients, projects, tasks, teams, reports, billing), not account administration or security settings. |
| `team_lead` | Team | Leads exactly one team. Sees and manages their team's tasks and timesheets. |
| `employee` | Individual | Tracks their own time in the desktop app; sees their own reports. |

`isAdminRole(role)` is true for `admin`, `alpha` and `manager`, and most
checks treat those three the same.

### 4.2 Three access mechanisms

1. **Role gates** — `authorizeRoles("admin", "hr", …)` in
   `middleware/authorizeRoles.js`. Admin-level roles pass any gate that lists
   `"admin"`.
2. **Role permissions (configurable)** — `requirePermission("create_tasks")`.
   The catalog is in `utils/permissions.js`. Admins edit it on the
   **Permissions** page for the roles `hr`, `team_lead` and `employee`; it is
   saved in the `role_permissions` collection. Admin-level roles always have
   every permission. Roles nobody has edited use
   `DEFAULT_ROLE_PERMISSIONS`, which mirror what the routes allowed before
   the catalog existed. `services/permissionService.js` keeps an in-memory
   snapshot, refreshed at most every 30 s and updated immediately on save.
3. **Delegated employee permissions** — `Employee.permissions` can hold
   `create_employees` / `edit_employees` for a specific person, checked by
   `authorizeAccess(...)`. This lets an admin give one HR person employee
   administration without changing the whole role.

Each catalog entry has an `enforcement` tag that the Permissions page shows:
`backend` (checked by the API) or `none` (catalogued for later; toggling it
changes nothing yet).

| Permission key | Enforced by | Default for |
|---|---|---|
| `create_tasks` | POST `/tasks`, `/tasks/bulk`, GET `/tasks/resolve-project` | hr, team_lead |
| `edit_tasks` | PUT `/tasks/:id` | hr, team_lead |
| `assign_tasks` | creating a task with assignees, or for the whole team (`taskPermissions.js`) | hr, team_lead |
| `reassign_tasks` | changing assignees on edit | hr, team_lead |
| `archive_tasks` | toggle-status, DELETE `/tasks/:id` | hr, team_lead |
| `add_manual_entries` | `/time-logs/manual*` (+ "Add entry" button) | — |
| `create_teams`, `edit_teams` | POST/PUT/DELETE `/teams` | hr |
| `view_team_timesheets` | GET `/time-logs/team` | team_lead |
| `manage_clients` | POST/PUT/DELETE `/clients` | hr |
| `manage_projects` | POST/PUT/DELETE `/projects` | hr |
| `view_all_reports` | GET `/time-logs/admin` | hr |
| `view_billing_amounts` | all of `/billing` | hr |
| `view_tasks`, `complete_tasks`, `view_task_timesheets`, `view_teams`, `view_team_productivity`, `assign_team_members`, `remove_team_members`, `view_clients`, `view_projects`, `assign_projects`, `view_personal_reports`, `view_team_reports`, `export_reports`, `manage_service_rates`, `view_financial_reports` | not enforced yet | various |

> The dashboard's menus and pages are chosen by **role**, not by these
> permissions; see [14](#14-known-gaps-and-gotchas).

---

## 5. Data model

All schemas are in `backend/src/models/`. Most catalog models use the
`readRevisionPlugin` (cache invalidation, [6.7](#67-caching-and-incremental-sync)).

| Model (collection) | Purpose | Key fields and rules |
|---|---|---|
| **Employee** | Every user account | `employeeId` (unique, upper-case), `fullName`, `email` (unique), `password` (bcrypt, `select:false`), `role`, `team`, `teamLead`, `isActive`, `permissions` (delegations), `projectRates[{project, chargeRate}]` (billing), `idleTrackingExempt`, `idlePolicyOverride`, `tokenVersion`, `rememberedSessions[]`, password-reset hash/expiry. Changing password or email invalidates reset links. |
| **Team** | Group of employees | `teamName` (unique), `teamLead`, `isActive`. Employees point to their team through `Employee.team`. |
| **Client** | Customer being billed | `clientName`, `status` Active/Inactive. "Delete" sets Inactive. |
| **Project** | Work stream (e.g. "Audit") | `projectCode` (auto), `projectName`, `clients[]` (+ legacy `client`), `teams[]` (empty = available to all), `status` Active/Completed/On Hold, `deletedAt` (soft delete). `serviceType` is a legacy field that is no longer set. |
| **Task** | What an employee works on | `taskCode` (auto, unique), `taskName`, `taskType` work/break, `project` (null = any project of its teams), `teams[]` (+ legacy `team`), `assignToAllEmployees` or `assignedTo[]`, `idleLogout`, `isActive`, `deletedAt`. |
| **TaskTimeLog** (`task_time_logs`) | One timer session | `employee`, `project`, `client`, `task`, `startedAt`, `stoppedAt`, `status` running/paused/stopped, `pauses[{pausedAt, resumedAt, reason: manual/idle/break}]`, `totalWorkedSeconds`, `totalPausedSeconds`, `totalIdleSeconds`, `note`, `desktopHeartbeatAt`, `stopReason` (`desktop_disconnected`), `entrySource` timer/manual, `manualEntry{createdBy, reason, deletedAt…}`, `logoutReason`. A **unique partial index** on `{employee, isActiveTimer:true}` guarantees one active timer per employee. |
| **Attendance** | Daily check-in/out | `employee`, `date` (YYYY-MM-DD in `APP_TIMEZONE`), `checkIn`, `checkOut`, `status` Present/Absent. Unique per employee and day. |
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
   - start a 30-second sweep that closes desktop timers whose heartbeat stopped;
   - listen on `PORT` (default 5000).

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

**Sign-in** (`POST /api/auth/login`, `controllers/authController.js`):
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

**Auth** — `routes/authRoutes.js`

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

**People** — `routes/employeeRoutes.js`, `routes/teamRoutes.js`

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/employees/options` | hr, or `create/edit_employees` | Lightweight list for selectors |
| GET | `/employees`, `/employees/:id` | admin or `create/edit_employees` | Employee administration |
| PUT | `/employees/:id` | admin or `edit_employees` | Update (including team and project rates) |
| PUT | `/employees/:id/permissions`, `/:id/reset-password`, `/:id/team-lead`; DELETE `/employees/:id` | admin | Delegations, password reset, team lead, delete |
| GET | `/employees/my-team`, `/my-team/:id` | team_lead | The lead's team members |
| GET | `/teams` | hr, or `create/edit_employees` | List teams |
| POST / PUT / DELETE | `/teams`, `/teams/:id` | `create_teams` / `edit_teams` | Manage teams (keeps `Team.teamLead` and members in sync via `services/teamAssignmentService.js`) |

**Work catalog** — clients, projects, tasks

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/clients` | auth | Active clients (employees/team leads get name + status only) |
| POST / PUT / DELETE | `/clients[/:id]` | `manage_clients` | Create / rename / deactivate |
| GET | `/projects`, `/projects/:id` | auth | Employees and team leads see projects of their team, or unrestricted ones |
| POST / PUT / DELETE | `/projects[/:id]` | `manage_projects` | Manage projects (DELETE is a soft delete) |
| GET | `/tasks`, `/tasks/:id` | auth | Visibility by role (see [6.6](#66-tasks)) |
| POST | `/tasks`, `/tasks/bulk` | `create_tasks` (+ `assign_tasks`) | Create one / many tasks |
| PUT | `/tasks/:id` | `edit_tasks` (+ `reassign_tasks` if assignees change) | Edit |
| PATCH | `/tasks/:id/toggle-status`; DELETE `/tasks/:id` | `archive_tasks` | Activate/deactivate; soft delete |
| GET | `/tasks/resolve-project` | `create_tasks` or `edit_tasks` | Which project a team set maps to |

**Time** — `routes/taskTimeLogRoutes.js`, `routes/attendanceRoutes.js`

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/time-logs/start` | auth | Start a timer (see [6.5](#65-the-timer-engine)) |
| POST | `/time-logs/heartbeat` | auth | Keep the desktop timer's lease alive (404 = timer was closed) |
| POST | `/time-logs/stop` | auth | Stop; optional `idleSeconds`, `logoutReason` |
| POST | `/time-logs/pause`, `/time-logs/resume` | auth | Legacy pause/resume (the UI now uses break tasks) |
| PATCH | `/time-logs/note` | auth | Edit the running timer's note |
| GET | `/time-logs/active` | auth | Current timer or `null` |
| GET | `/time-logs/history` (alias `/my`) | auth | Own sessions; supports `today=true`, date range, `sync=true` |
| GET | `/time-logs/team` | team_lead + `view_team_timesheets` | The team's sessions |
| GET | `/time-logs/admin` | `view_all_reports` | Company-wide sessions |
| GET | `/time-logs/live` | admin, team_lead | Timers running right now |
| GET / POST / DELETE | `/time-logs/manual/options`, `/manual`, `/manual/:id` | `add_manual_entries` | Back-filled entries (see [6.5](#65-the-timer-engine)) |
| POST | `/attendance/check-in`, `/attendance/check-out` | auth | Daily attendance |
| GET | `/attendance/today`, `/attendance/history` | auth | Own attendance |
| GET | `/attendance/team/today`, `/team/history` | team_lead | Team attendance |
| GET | `/attendance/admin/history` | admin, hr, manager | Company attendance |

**Scheduling, billing, settings, permissions**

| Method | Path | Access | Purpose |
|---|---|---|---|
| CRUD | `/shifts[/:id]`, `/schedules[/:id]` | admin, manager, hr | Shift templates and per-day schedules |
| GET | `/billing/employees`, `/billing/report` | `view_billing_amounts` | Billing report data |
| GET | `/settings/idle-policy` | auth | Effective idle policy for the caller (+ exemption flag) |
| PUT | `/settings/idle-policy` | admin | Global idle threshold / auto-logout |
| GET / PUT | `/settings/employee-idle-policies[/:employeeId]` | alpha | Per-employee overrides |
| GET | `/permissions/me` | auth | Caller's effective permission keys |
| GET | `/permissions`; PUT `/permissions/roles/:role` | admin, alpha | Permissions page data / save a role |

### 6.5 The timer engine

`controllers/taskTimeLogController.js` with `services/desktopTimerLease.js`.

**Start** (`POST /time-logs/start` with `project`, `task`, optional `client`,
`note`, `clientType`):
1. Close this employee's stale desktop timers first.
2. Project must exist, be Active and not deleted. Client, if given, must be active.
3. Non-elevated users: a project restricted to teams must include their team.
4. The task must be active, not deleted, and visible to the user:
   - elevated roles (admin, manager, hr) can use any task;
   - team leads, any task of their team;
   - employees, tasks naming them in `assignedTo`, or team tasks with
     `assignToAllEmployees`.

   It must also belong to the project, or be a project-less work/break task.
5. Refuse if a timer is already running or paused (the unique index also
   guards against races, returning 409).
6. Create the log. If `clientType` is `desktop`, set `desktopHeartbeatAt`,
   which makes it a **leased** timer.

**Heartbeat**: refreshes `desktopHeartbeatAt`. **Lease**: every 30 s (and
before every timer action) the server closes leased timers with no
heartbeat for **90 s**. It stops them *at the last heartbeat*, marks
`stopReason: desktop_disconnected`, and closes open pauses.

**Stop**: if the desktop reports `idleSeconds`, an `idle` pause is added
covering that span. Totals are then computed:

```text
totalPausedSeconds = sum of all pauses
totalIdleSeconds   = sum of pauses with reason "idle"
totalWorkedSeconds = (stoppedAt − startedAt) − totalPausedSeconds
```

**Breaks** are modelled as **tasks with `taskType: "break"`** (for example,
Lunch). The whole session is break time and is excluded from worked and
billable totals.

**Manual entries** (`controllers/manualTimeEntryController.js`):
- Who: admin and alpha for anyone; managers for employees, team leads and
  themselves; team leads for employees on their team, but not themselves.
- Rules: the same project/task eligibility as starting a timer; a stop time
  after the start, not in the future, and at most 24 h; a reason of 5–500
  characters; **no overlap** with any existing session.
- They are stored as `entrySource: "manual"`. Deleting one is a soft delete
  (`manualEntry.deletedAt`).

### 6.6 Tasks

`controllers/taskController.js`.

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

Clients that support sync: the desktop timesheet (`loadAllPages` in
`renderer.js`) and dashboard reports (`utils/reportLoader.js`).

### 6.8 Billing

`controllers/billingController.js` + `utils/billingUtils.js`; page
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

`utils/idlePolicy.js`, `controllers/settingsController.js`.

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
| `repairEmployeeTeams.js` (`audit:teams` / `repair:teams`) | Audit/repair employee ↔ team links |
| `copyRecreatedProjectRates.js` | Copy billing rates after a project was recreated |
| `verifyBandwidthIndexes.js` | Read-only check that performance indexes exist |
| `verifySmtp.js` (`npm run test:smtp`) | Test email settings |

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
- **Navigation**: items come from `components/layout/workspaceNavigation.js`,
  filtered by role. Alpha uses the admin menu. Team leads also get "Team
  members". Non-admins with delegated employee permissions get "Employees".
- **`DashboardLayout`**: a page wrapper that shows the title and, on
  `/…/dashboard` pages, "Welcome back".

### 7.2 Auth in the browser (`context/AuthProvider.jsx`)

- **localStorage keys**: `token`, `user`, `rememberedSessionToken`,
  `rememberedUser`, `crmDeviceId` (per-browser device id from
  `utils/deviceIdentity.js`, sent as `clientType: "web"`).
- **On load**: the stored token is validated with `/auth/me`.
- **Login** handles the 409 device-approval flow and the remembered-account
  "quick login".
- **`api/axiosInstance.js`** adds `Authorization: Bearer`. On any **401** or
  `ACCOUNT_INACTIVE` it clears the session and sends the user to `/login`,
  keeping the reason in `sessionStorage.sessionEndedMessage`.

### 7.3 Routes (`routes/AppRoutes.jsx`)

Guards are thin wrappers around `ProtectedRoute`. Manager and alpha pass any
guard that allows `admin`.

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
| `/admin/dashboard` | AdminStaffOnly | `AdminReportPage` (overview) |
| `/admin/my-timesheet`, `/admin/my-timesheet/details` | AdminStaffOnly | `AdminReportPage` (personal) |
| `/admin/timesheets/{team,detailed,project-hours,attendance,count,working-today,task-tracker,project-work}` | AdminStaffOnly | `AdminReportPage` (company views) |
| `/attendance` | AttendanceStaffOnly | `AdminReportPage` (attendance) |
| `/admin/clients`, `/admin/projects`, `/admin/tasks`, `/admin/tasks/new`, `/admin/team` | AdminStaffOnly | catalog management pages |
| `/admin/employees` | admin/alpha/manager **or** delegated `create/edit_employees` | `AdminEmployees` |
| `/admin/scheduler/shift`, `/shift/add`, `/schedule` | AdminStaffOnly | shifts and schedules (not in the sidebar menu) |
| `/admin/billing` | AdminStaffOnly (API needs `view_billing_amounts`) | `BillingPage` |
| `/admin/settings`, `/admin/permissions` | AdminOnly | idle/logout settings; role permissions |
| `/team-lead/dashboard`, `/employee-insights`, `/timesheet[/details]`, `/timesheets/*` | TeamLeadOnly | `RoleReportPage` |
| `/team-lead/tasks`, `/team-lead/tasks/add` | TeamLeadOnly | team task management |
| `/employee/dashboard`, `/employee/timesheet[/details]` | EmployeeOnly | `RoleReportPage` (personal) |
| `/profile` | any signed-in role | `ProfilePage` |
| `/employees`, `/employees/:employeeId` | admin roles, team_lead (and delegates) | employee list / details |
| `*` | — | redirect to `/login` |

`npm run test:routes` (`scripts/audit-routes.mjs`) checks that every
navigation target is a registered route.

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
- **Manual entries.** Users with `add_manual_entries` get "Add entry"
  (`components/reports/AddEntryModal.jsx`) and the manual-entries list.

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
| Permissions | `pages/admin/AdminPermissions.jsx` | Per-role switches, search/filter, sensitive-change confirmation |
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
- **Unlocking.** Starting a timer (including a break task) removes the lock.
  If CRM was minimized before, it is minimized again. Signing out also
  releases the lock.
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
  It downloads silently, shows a notification when ready, and installs when
  CRM is closed normally. See `AUTO_UPDATE.md`.
- **Build**: `npm run build` produces the NSIS installer
  `dist/CRM-<version>-Windows-x64.exe`. `build/installer.nsh` repairs
  existing CRM shortcuts. The files that ship are listed in
  `package.json → build.files`; **add any new top-level file there**.
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
  ├─ requirePermission(create_tasks) + guard: assign_tasks (team-wide assignment)
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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for resets | — | Password-reset email (development logs the link instead; production cannot send resets without them) |
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
- One `starter` web service, Node runtime.
- Build: install backend and dashboard dependencies, then `npm run build
  --prefix dashboard` with `VITE_API_URL=/api`.
- Start: `npm start --prefix backend`. The backend serves `dashboard/dist`,
  so the dashboard and API share one domain.
- Secrets (`MONGODB_URI`, `CORS_ORIGINS`, `FRONTEND_URL`) are set in Render;
  `JWT_SECRET` is generated by Render.
- Health check: `/health`.

**Desktop**:
1. Bump `desktop-app/package.json` → `version`.
2. Run `npm test`.
3. Run `npm run publish`. It needs signing and `GH_TOKEN`, and creates a
   draft GitHub Release with the installer and `latest.yml`.
4. Publish the draft.

Installed apps pick the release up automatically and install it the next
time CRM is closed.

---

## 13. Tests

All suites use Node's built-in `node:test`.

| Suite | Command | What it covers |
|---|---|---|
| Backend (160 tests) | `cd backend && npm test` | Auth sessions, remembered login, permissions, billing math, idle policy, timer lease/idle stop, manual entries, task bulk create and duplicates, report ranges, caching |
| Dashboard (43 tests) | `cd dashboard && npm test` | Report helpers, timelines, pagination, manual-entry and client-timesheet utils, form validation |
| Dashboard lint / routes | `npm run lint`, `npm run test:routes` | ESLint; every nav link has a route |
| Desktop unit (98 tests) | `cd desktop-app && node --test --test-isolation=none test/*.test.js` | Runs the real `renderer.js` in a VM with a fake DOM/API (idle, logout, close, timesheet, lock states), `timer-lock.js` with fake windows, updater, release config |
| Desktop full | `cd desktop-app && npm test` | Unit tests plus real-Electron smokes (`electron-inactivity-smoke.cjs`, `dashboard-lifecycle-smoke.cjs`, which builds the dashboard first). The smokes rewrite screenshots in `dashboard/ui-review/`. |

> `dashboard-lifecycle-smoke.cjs` still expects 10-second dashboard polling;
> since commit `6ff26c5` polling is every 30 s, so that smoke fails until it
> is updated.

---

## 14. Known gaps and gotchas

Found while reviewing the code for this guide. None of them are bugs in time
recording itself; they are places where behaviour may surprise a developer or
an admin.

1. **Permissions don't drive the dashboard UI.** Menus, routes and buttons
   are chosen by role. Turning off "Create tasks" for team leads leaves
   "+ Add task" visible, and the save then fails with 403. Granting "Create/edit
   clients" to a team lead or employee gives them no Clients page. Only
   `add_manual_entries` is read by the UI (`/permissions/me`).
2. **"Create tasks" also needs "Assign tasks".** The form always creates
   whole-team tasks, which `guardTaskAssignmentOnCreate` treats as assigning.
3. **Several permissions are catalogued but not enforced** (`enforcement:
   "none"`, for example `view_tasks` and `view_clients`).
4. **Attendance check-in/out has no live UI.** The API and reports exist, but
   only the unused `components/attendance/AttendanceCard.jsx` calls
   check-in/out, so new attendance rows are not being created.
5. **Unused dashboard code**: `components/dashboard/PersonalWorkPanel.jsx` →
   `components/timer/TaskTimer.jsx`, `ProjectSelector`, `TaskSelector`,
   `api/timerApi.js`, `AttendanceCard` / `AttendanceHistory`,
   `pages/teamLead/TeamLeadTaskTracker.jsx`. `TeamLeadSidebar` and
   `EmployeeSidebar` now return `null` (the shell draws navigation).
6. **Shifts and schedules have pages but no menu entries** (reach them at
   `/admin/scheduler/*`).
7. **Service type is legacy.** Projects no longer store one; the Billing and
   Tasks tables show the column only when old data has it.
8. **Single-instance assumptions.** Rate limits, auth/catalog/permission
   caches, the timer sweep coordination and the task duplicate-check queue
   live in process memory. Running more than one backend instance would need a
   shared store, and a database unique index for task duplicates (after
   cleaning existing duplicates).
9. **HR and manual entries.** Even with `add_manual_entries` granted, HR
   cannot add entries, because `canActOnEmployee` only allows
   admin/alpha/manager/team lead.
10. **The desktop main process needs a restart** after changes to `main.js`
    or `timer-lock.js` (see [11](#11-running-locally)).
11. **New desktop files must be added to `build.files`** in
    `desktop-app/package.json`, or they will be missing from the installer.
12. **SMTP is not in `render.yaml`.** Password-reset emails in production
    depend on `SMTP_*` being set in the Render dashboard; without them,
    "Forgot password" answers normally but no email is sent.
13. **Old documentation.** `README_MERGED.md` and the `*_REPORT.md` /
    `CODE_AUDIT.md` files describe earlier states of the project; prefer this
    guide and the code.
