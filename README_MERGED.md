# CRM - Employee Time & Attendance System

For the team-based Admin **Overview**, live activity, team hours and deployment details, see [Admin team Overview](CRM_ADMIN_OVERVIEW.md).

For the new Admin/Alpha/Manager **Edit entry** workflow, MongoDB audit history and deployment/testing details, see [Website time-entry corrections](CRM_TIME_ENTRY_EDITING.md).

For Admin-only daily working-hour configuration, effective-dated requirements,
leave/half-day exceptions and the team productivity dashboard, see
[Employee working hours](CRM_WORKING_HOURS.md).

This folder merges the useful work from the two project copies in the uploaded ZIP into one clean project.

## What was merged

### Backend
- Node.js + Express + MongoDB backend from the more complete backend copy.
- Personal attendance: check in, check out, today, history.
- Team Lead attendance views and Admin company attendance history.
- Employee management and Team Lead assignment APIs.
- Project and task APIs.
- Task timer start, pause, resume, stop, active timer restore, personal history, and Team Lead time-log view.
- Added `/api/auth/logout` while keeping JWT/localStorage authentication.
- Added `http://localhost:5174` to CORS in addition to the existing frontend ports.
- Added `/api/time-logs/my` as an alias for personal time-log history while retaining `/api/time-logs/history`.

### Dashboard frontend
- Kept the original role-based React/Vite application structure.
- Admin-only login route: `/admin/login`.
- Generic role login route: `/login`.
- Admin dashboard with persistent left sidebar.
- Admin Employees page connected to `/api/employees` with search and active/inactive filtering.
- Existing Admin/Team Lead/Employee personal attendance and task timer features preserved.
- Attendance history restored on the personal work panel.
- Pause and Resume timer controls included.
- Profile page preserved.
- Team Lead and Employee dashboards preserved.

### Reusing existing tasks across projects

**Task Links → Link projects, clients and tasks** opens bulk selection. Choose
multiple projects, clients and tasks, then review and confirm the combinations.
Linking adds every selected client/task pair to every selected project, retaining
other client links. Tasks must share a team with each selected project; task and
employee assignments are never broadened. Saving uses one transaction with
version checks on every project (up to 5,000 combinations). **Review unlink**
soft-disables only the chosen client-specific mappings and preserves recorded
time. The linking window opens directly to bulk selection, without a separate
Project settings tab.

Use **Task Linking → Project & client links** to add or remove client
links across projects without selecting tasks. Adding clients creates no task
mappings. Removing a client also disables that client's task mappings on those
projects, while retaining task definitions, reusable task references, other
client links and recorded time. Delegated users cannot remove client links
that would affect another team's tasks.

Both **Task Linking → Task links** and **Project & client links** open their
editors directly on the page, without an introductory card or extra launch
button. The client-only tab has no task selectors or task-setting controls.

After a successful confirmation, both editors clear all selections and searches.
Failed saves retain selections for correction or retry. A paginated **History**
section below each editor records new completed link/unlink actions, including
the selected names, user and time, and survives page refreshes. History and links
save in the same database transaction. Delegated users see their own actions;
administrators, managers and HR can see all actions. Earlier saves are not backfilled.

Task creation also supports multiple projects directly: use the single
**Projects** section to select one or more projects and a client for each.
Each task name is created once and reused across those projects.
In **Tasks → Edit**, enable **Change project selections** to add or remove
projects. Task fields and links save in one transaction; stale task or link
changes require reloading the form. Existing client links on retained projects
are preserved. Team Leads stay within their own team; automatic administrator
assignment uses the teams common to every selected project.

**Projects → Add New Project** and **Edit** contain project details and teams;
they do not show a task picker or change existing task references. Manage task
reuse under **Task Links** or through the task creation/editing project selector.

Project links do not move or duplicate tasks, change their employee assignments,
or rewrite historical time. Each new time entry records its selected project, so
reports and billing keep the projects separate. Removing a reusable link affects
future choices; existing tracked time remains intact. Projects with **Linked tasks
only** enabled also need the desired task/client pairs configured under **Task
links**. Existing primary-project and shared-task behavior remains supported.

Deploy both the backend and dashboard for this feature. The desktop's existing
activity-options flow reads the new links from the backend. Verification:
`node --test integration/reusableProjectTasks.cjs` inside `backend`, and
`npm run test:project-tasks` inside `desktop-app` after building the dashboard.
- Removed the duplicate AdminDashboard/AdminSidebar copies that caused confusion.

### Desktop app
- Kept the richer Electron renderer/index implementation from the second project copy.

### Billing
- The Admin workspace includes an administrator-only Billing report.
- Billing aggregates completed timer sessions by project ID and task ID, keeps break-task time separate, and excludes paused time.
- Reports support quick/custom date ranges, daily detail, timezone-aware boundaries, and filtered Excel export.
- Billing reads the existing timer records and does not create a separate timesheet source.

## Interface and themes

The dashboard now uses a shared professional layout for all three roles. The
floating Theme button opens the palette chooser, saves the selected palette on
the device, and closes immediately after a theme is selected.

## Clean frontend structure

```text
dashboard/src/
  components/
    admin/AdminSidebar.jsx
    layout/DashboardLayout.jsx
    dashboard/PersonalWorkPanel.jsx
  pages/
    admin/
      AdminLogin.jsx
      AdminDashboard.jsx
      AdminEmployees.jsx
      AdminPlaceholderPage.jsx
    employee/
    teamLead/
    profile/
  routes/AppRoutes.jsx
  styles/adminLayout.css
```

## Run backend

Copy `backend/.env.example` to `backend/.env` and set a new MongoDB URI and a long, random JWT secret. `APP_TIMEZONE` controls attendance day boundaries; it defaults to `Asia/Kolkata`.

```bash
cd backend
npm install
npm run dev
```

Backend should run on `http://localhost:5000`.

## Run React dashboard

Open a second terminal:

```bash
cd dashboard
npm install
npm run dev
```

Open the exact Local URL shown by Vite. All roles sign in at `/login` and are
redirected to the correct dashboard for their role.

For a non-local backend, copy `dashboard/.env.example` to `dashboard/.env.local` and set `VITE_API_URL`. For a packaged desktop client, set `HANDDY_API_URL` before launching/building it.

## Run the Electron desktop timer

Keep the backend running, then open a third terminal:

```bash
cd desktop-app
npm install
npm start
```

The packaged desktop timer uses the hosted CRM API by default. Set
`HANDDY_API_URL` before starting or packaging to use a different backend.

### Idle-time tracking

Admins set the inactivity threshold under **Settings → Idle and Logout**. While
an employee timer is running, Electron reads only the operating system's idle
duration; it does not record keys, clicks, or pointer positions. The timer is
automatically paused after the configured threshold and resumes when activity
returns. Idle pauses are excluded from worked/billable time and reported
separately.

One employee can be exempted through a local-only backend command. Set these
values in `backend/.env` without committing the credentials, then run
`npm run create:idle-exempt` inside `backend`:

```text
EXEMPT_EMPLOYEE_EMAIL=employee@example.com
EXEMPT_EMPLOYEE_ID=EMP001
EXEMPT_EMPLOYEE_NAME=Employee Name
EXEMPT_EMPLOYEE_PASSWORD=use-a-strong-password
EXEMPT_EMPLOYEE_TEAM_ID=optional-mongodb-team-id
```

The command creates or updates that employee and removes the exemption from
any previously exempt employee. The exemption is unavailable in the admin UI
and ordinary employee update API.

### Team assignment consistency

Billing filters employees by their exact team assignment. To inspect older
employee records without changing data, run `npm run audit:teams` inside
`backend`. If the listed repairs are correct, run `npm run repair:teams`.
Ambiguous records are never changed automatically and are reported for manual
review.

### Rates after recreating a project

Billing matches each employee's charge rate to the exact project ID. Creating
a new project with an old project's name does not transfer its rates. A
missing service-type classification does not prevent billing when the project
rate is configured.

For one employee, edit their Project & Charge Rate rows in Admin Employees and
assign the active project with the agreed rate. Preserve the completed
project's row for historical reports.

For a confirmed recreation of the same project and team assignments, preview
existing rates from a completed project using the maintenance command inside
`backend`:

```powershell
node scripts/copyRecreatedProjectRates.js --source OLD_PROJECT_ID --target NEW_PROJECT_ID
```

After confirming the business mapping and reviewing the rates, supply the
explicit employee IDs and apply:

```powershell
node scripts/copyRecreatedProjectRates.js --source OLD_PROJECT_ID --target NEW_PROJECT_ID --employees EMP001,EMP002 --apply
```

Only employees with time logs on the new project and one valid existing source
rate are eligible. Existing destination rates are preserved. The command
saves a local snapshot in `backend/.local-repairs/` before changes and skips
concurrent rate edits. Repeating it does not add duplicate rates. Missing
source rates require manual configuration; no default rate is invented.
Refresh the billing report after repair; a desktop reinstall is unnecessary.

## Validation

```bash
cd backend && npm test
cd ../dashboard && npm run lint && npm run build
```

## Notes

- Run `npm install` once inside `backend`, `dashboard`, and `desktop-app` after extracting a clean copy.
- All sidebar navigation targets are registered. Management pages use the backend APIs; report pages use attendance and timer records.
- Monitoring reports clearly show when Electron tracking data has not yet been collected.
- Employee creation is available from Admin Employees, and Admin or Team Lead users can open employee details from the shared employee list.

## Validation performed

- Dashboard ESLint passes.
- Dashboard production build passes.
- Backend tests pass.
- Backend and Electron JavaScript syntax checks pass.
- Backend and dashboard health checks return HTTP 200 in local development.

## CRM branding and desktop release publishing

Version **1.2.27** includes the 9 October audit follow-up:

- Concurrent desktop timesheet refreshes share one request. A manual refresh
  waits for background loading and then fetches a complete snapshot, preventing
  older responses from overwriting newer rows. Queued refreshes stop on logout.
- Catalog revision checks declare and request an `updatedAt` index. The
  checksum still traverses timestamp entries; it is not a constant-time check.
  If the index is unavailable, existing error handling uses the original
  uncached catalog/report responses. Confirm `updatedAt_1` exists on employees,
  projects, tasks, clients and teams after backend deployment. The live query
  plan and transfer savings have not been measured by this local audit.

These source changes require backend deployment and the **1.2.27** desktop
installer. The older **1.2.26** files in `desktop-app/dist` do not include them.
Follow-up validation is recorded in the deployment readiness notes below.
The local pilot installer is unsigned; publishing/signing requirements below
still apply. Push, deployment, index creation and release publishing require
the owner's approval.
See [MongoDB aggregation/index guidance](https://www.mongodb.com/docs/manual/core/aggregation-pipeline-optimization/)
for verifying the deployed query plan with `explain`.

### Deployment readiness for 1.2.27

The 9 October audit targets the existing Render web service
**handdy-workspace**, which serves both `/api` and the built dashboard at
`https://handdy-workspace.onrender.com`. Use the existing build/start commands
in `render.yaml`; do not create a replacement service or rotate production
secrets. Required production configuration is `MONGODB_URI`, `JWT_SECRET` and
an HTTPS `FRONTEND_URL` or Render's `RENDER_EXTERNAL_URL`. Preserve existing
timezone, CORS, session lifetime and SMTP settings. Local configuration was
checked by key presence only; Render's private environment was not accessed.

The native-client read-only index audit against the database selected by
`backend/.env` found:

| Collection | Required synchronization indexes | Status |
| --- | --- | --- |
| employees, projects, tasks, clients, teams | `{ updatedAt: 1 }` on each collection | Missing on all five |
| attendances | `{ employee: 1, updatedAt: 1 }`, `{ updatedAt: 1 }` | Both present |
| task_time_logs | `{ employee: 1, updatedAt: 1 }`, `{ updatedAt: 1 }` | Both present |

No duplicate timestamp definitions were found in the schemas or the connected
database. Confirm privately that Render uses this same database before treating
the result as the production index inventory. No database records or indexes
were changed. On an approved deployment, Mongoose's default automatic index
creation will request the new non-unique schema indexes; confirm database
permissions and completion rather than assuming success. Existing compound
employee/date indexes serve other queries and should be preserved. A compound
employee/timestamp index does not satisfy the explicit `{ updatedAt: 1 }` hint.
The checksum still scans timestamp entries and is not constant-time.

Run this read-only check from `backend`:

```bash
node scripts/verifyBandwidthIndexes.js
```

Exit 0 means all required timestamp patterns are present; exit 2 means some
are missing; exit 1 means the check could not complete. The script uses the
native MongoDB client and only lists index definitions, so it cannot trigger
Mongoose index creation. In Atlas, open Data Explorer, select the database and
each collection, then inspect its Indexes tab. After approval, create only the
five missing ascending `updatedAt` indexes with unique, sparse, TTL and partial
options disabled. Index builds consume database resources; schedule and monitor
them for the cluster size. See [Atlas index management](https://www.mongodb.com/docs/atlas/atlas-ui/indexes/).

The additional heartbeat audit found that Atlas returned the entire timer
document even though the API acknowledged only its ID. Heartbeats now request
only `_id`; their twenty-second interval, lease expiry and public JSON response
are unchanged. No production data update was performed to test this change.

Incremental reports remain opt-in. Older callers receive complete paginated
responses. Manual refreshes, expired/changed markers, changed reference data,
large batches and five-minute reconciliation request full data. Missing revision
indexes also fall back to the original full responses. Same-process writes
invalidate reference caches immediately; other instances recheck metadata
within five seconds. Settings cache reads have the same five-second bound.
Private task responses remain scoped to each employee and current permissions.
Approval waiters stop on disconnect and use a five-second database fallback.

Actual archived 1.2.21 and 1.2.22 report loaders were exercised with the current
backend handlers and local fixtures: each read all 205 records on two successive
paginated refreshes without sync opt-in. Local handler tests cover legacy login,
attendance check-in/checkout, timer start/pause/resume/stop and authorization.
These results do not certify an installed employee PC or a live deployment.
Keep existing installations; use an approved in-place NSIS installation in the
same folder/scope on one or two pilot PCs after the backend deployment.

The public service health check returned 200; unauthenticated `/api/auth/me`
returned 401. These checks do not identify the deployed commit. The configured
GitHub update repository and latest-release endpoint returned anonymous 404.
The local 1.2.27 installer, blockmap, `latest.yml` and embedded feed are present,
but public hosting, trusted signing and an end-to-end version transition remain
required. This audit did not push, deploy, publish, create indexes or install
CRM on any employee computer.

Final local verification: **122 backend tests, 31 dashboard tests and 85 desktop
Node tests passed (238 total)**. Dashboard lint and production build, both real
Electron smoke tests and the isolated NSIS shortcut test passed. The Windows
1.2.27 installer rebuilt without publishing; packaged version/renderer and
installer size/SHA-512 metadata were checked. The installer remains unsigned.
Backend and desktop have no separate lint scripts; modified JavaScript also
passed syntax checks. The dashboard build reports a large export-library chunk
warning; this is a build warning rather than a test failure.

The verified source change set consists of:

- `README_MERGED.md`.
- `backend/src/services/readRevisions.js` and
  `backend/src/controllers/taskTimeLogController.js`.
- `backend/scripts/verifyBandwidthIndexes.js`.
- `backend/test/bandwidthOptimizations.test.js`,
  `backend/test/bandwidthIndexes.test.js` and
  `backend/test/legacyCompatibility.test.js`.
- `desktop-app/renderer.js`, `desktop-app/package.json`,
  `desktop-app/package-lock.json` and `desktop-app/test/report-sync.test.js`.

Keep generated archives, installers, logs, fixture exports and local `.env`
files out of the source commit. After approval, push the verified commit and
deploy the existing service; a push to its linked branch may trigger Render
auto-deploy. Re-run the index verifier, confirm full/delta refreshes and approval
flows, then pilot the in-place installer before distributing it more broadly.
Fix public update hosting and trusted signing separately before publishing a
stable release and testing a complete installed-version transition.

### Measuring transfer after approved deployment

For the existing Render service, open Metrics and Network Metrics, then compare
Outbound Bandwidth and HTTP request volume over matching business-hour windows.
Separate HTTP Responses from Service-Initiated traffic. Bandwidth points cover
the previous hour and appear approximately an hour after that window ends;
workspace monthly totals are on Billing. See [Render metrics](https://render.com/docs/service-metrics)
and [outbound bandwidth accounting](https://render.com/docs/outbound-bandwidth).

In Atlas cluster metrics, compare Network Bytes In/Out, operations and Query
Targeting for the same intervals; use the query profiler or Performance Advisor
where available. Host counters were not accessible through the configured
database account, and historical dashboard metrics were not available to this
audit. See [Atlas available metrics](https://www.mongodb.com/docs/atlas/review-available-metrics/).

Record active employee hours, old/new client versions, report date ranges,
exports and normal workload alongside each measurement. Browser Network tools
can identify endpoint request counts and transferred bytes, without sharing
tokens or unsanitized HAR files. Likely candidates from the code are full
time-log/attendance downloads, idle project/task/client refreshes, heartbeat
reads and billing/export requests. Their production ranking is unmeasured.
Server catalog/settings caches primarily reduce Atlas reads; they still send
normal JSON responses to clients and do not alone eliminate Render response
bandwidth. No live before/after comparison or savings percentage is claimed.

Version **1.2.26** reduces repeated database reads and report downloads:

- Device approval monitors use local change notifications with a five-second
  database fallback, instead of querying every half second. Disconnected
  clients stop their pending monitor. Browser sessions skip desktop approval
  lookups while retaining session revocation checks.
- `/auth/me` reuses the employee already validated by authentication.
  Inactivity settings GETs share a five-second read cache and never create or
  update a settings document. Missing documents still use the safe defaults;
  administrator saves invalidate the cache.
- Authorized project, task and client lists use a bounded server cache
  (64 entries, eight MiB total). Task results remain scoped to each employee;
  project/client sharing retains role, team and permission boundaries. Model
  writes invalidate their revisions locally; other server instances detect
  changes through metadata reads cached for at most five seconds. Payload
  entries expire after sixty seconds. Cache failures use the normal handlers.
- Desktop timesheets and browser attendance/time-log reports opt into an
  incremental protocol. Background refreshes merge changed rows and active
  timers. Reference changes such as task renaming, deletion or reassignment
  trigger full reloads. Manual refreshes and five-minute reconciliation fetch
  complete paginated data. Large change batches also fall back to pagination.
  Client snapshots are bounded to twelve reports and 50,000 rows per report.
- Original endpoint paths and legacy response formats remain available to old
  employee apps. Authentication, timer mutations, twenty-second heartbeats,
  ninety-second lease expiry, OS idle checks and report refresh intervals keep
  their existing behavior. Additional report-query indexes are defined in the
  models; confirm they are created by the database deployment's index policy.

**Rollout:** deploy the updated backend/dashboard first using the existing
Render build configuration, then install the 1.2.26 NSIS installer over the
existing installation on one or two pilot PCs. Close CRM normally before
installation. Test login, Start/Stop, Stop Break, task assignment changes and
timesheets before rolling out to the remaining twenty employees. Portable ZIP
users should use the new installed CRM shortcut. No task/history deletion or
data migration is required. If the backend is rolled back, 1.2.26 clients fall
back to full pagination when the server does not supply synchronization markers.

**Verified locally:** 116 backend tests, 31 dashboard tests and 82 desktop Node
tests passed; dashboard ESLint and production build passed; both real Electron
timer/dashboard smoke tests passed. The Windows x64 installer built without
publishing, and its packaged version, report code, size and SHA-512 metadata
were checked. Tests use isolated fixtures and mock APIs, not production data.
The installer remains unsigned. These changes have not been pushed or deployed;
actual Render/Atlas bandwidth savings require measurement after rollout.

Version **1.2.25** adds filters to the desktop **My task timesheet** by entry
type, task and session status. Selected results show work time, break time,
break count and completed timer sessions. A completed session is a stopped
timer, counted once even if it contains several work/break segments. The daily
summary stays visible and filters survive automatic refreshes. Active breaks
contribute to filtered break time; Total break today remains completed breaks.

Version **1.2.24** adds **Stop Break** below the active break clock and recreates
existing CRM shortcuts during NSIS installation/update to address downloaded
taskbar shortcut blocks. Company publishing now requires code signing; see
[the company rollout and shortcut repair guide](desktop-app/AUTO_UPDATE.md)
for deployment to employee PCs and remaining signing/hosting prerequisites.

The display name remains CRM. The application ID `com.handdy.timetracker`,
package name, existing profile and Render API configuration remain unchanged.

Desktop version **1.2.23** adds GitHub Releases automatic updates through
`electron-updater`. Packaged Windows builds check after startup, download in
the background, and install on normal quit after the existing timer-stop
confirmation. Older versions need one final manual NSIS installation.

From `desktop-app`, run `npm run build` for a Windows x64 NSIS installer without
publishing. Run `npm run publish` with a build-terminal `GH_TOKEN` to build and
upload a draft release after repository/version validation. Review the draft
before making it public. Installer, blockmap and `latest.yml` belong on GitHub
Releases; Render continues to handle the existing backend/API.

The selected `ORUGANTIVINODKUMAR/handdy-workspace` repository currently returns
HTTP 404 without authentication. Resolve public release hosting before rollout.
Local installers are unsigned; the previous README certificate mention does
not represent a verified signing configuration.

See [the automatic-update audit and one-PC pilot guide](desktop-app/AUTO_UPDATE.md)
for build/publish commands, token/signing setup, release verification, completed
tests and remaining limitations. A CRM icon still needs to be supplied; existing
icons remain unchanged.
