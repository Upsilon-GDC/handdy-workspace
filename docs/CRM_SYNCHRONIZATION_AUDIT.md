# CRM Web and Desktop Synchronization Audit

Audit date: 2026-09-11

## Result

The web dashboard and desktop application now share centralized environment-aware API configuration, and both clients refresh server-owned data after external changes. The production desktop build defaults to the same Render backend used by the production dashboard. Local development defaults both clients to the local backend.

The reported mismatch had two primary causes:

1. The dashboard opened at `localhost:5173` used `http://localhost:5000/api`, while the installed desktop application used `https://handdy-workspace.onrender.com/api`. Unless the local and Render backends use the same `MONGODB_URI`, these are different data systems.
2. The desktop loaded projects only at startup and refreshed tasks only in limited cases. Several dashboard lists also loaded only when their page mounted. Changes made by another client therefore remained stale until a reload or navigation.

There is no WebSocket, Socket.IO, Server-Sent Events, or change-stream implementation in this project. Cross-client synchronization is REST-based and is now refreshed on focus, reconnect, visibility changes, and a polling interval.

## API and database configuration found

| Application | Development API | Production API | Database ownership |
| --- | --- | --- | --- |
| Web dashboard | `VITE_API_URL`, otherwise `http://localhost:5000/api` | `VITE_API_URL`, otherwise same-origin `/api` | Backend only |
| Electron development | `HANDDY_API_URL`, otherwise `http://localhost:5000/api` | Not applicable | Backend only |
| Electron packaged app | `HANDDY_API_URL`, otherwise `https://handdy-workspace.onrender.com/api` | Render production API | Backend only |
| Backend | Express `/api` routes | Same Express `/api` routes | Exactly one `MONGODB_URI` per running backend |

The frontend applications do not connect directly to MongoDB. `backend/server.js` establishes the MongoDB connection and starts listening only after the connection succeeds. The production Render service builds the dashboard and serves it with the API from the same backend service.

## Changes applied

### Central API configuration

- Added `desktop-app/api-config.js` as the single desktop source for development, production, and optional `HANDDY_API_URL` overrides.
- Updated `desktop-app/main.js` and `desktop-app/preload.js` to consume that configuration.
- Added `api-config.js` to the Electron packaging file list.
- Added `dashboard/src/api/apiConfig.js` and changed the Axios instance to consume it.
- Documented the paired development and production behavior in `dashboard/.env.example`.
- Updated backend CORS handling so configured production origins do not accidentally remove the supported local dashboard origins.

### Cross-client refresh

- Added `dashboard/src/hooks/useDataRefresh.js`, which refreshes data on window focus, reconnect, returning to a visible tab, and a 10-second interval by default.
- Applied it to project, employee, task, client, team, selector, and team-lead task pages.
- Added equivalent desktop refresh behavior for the authenticated employee, today's time state, projects, and tasks.
- Desktop refreshes every 10 seconds and on focus, reconnect, or restored visibility.
- Refresh preserves valid project/task selections and avoids replacing selector state while an active timer is running.
- Desktop GET requests used for project refresh explicitly bypass HTTP caches. The backend already sends `Cache-Control: no-store` for API responses.

### Live timer/task tracker

- Added `GET /api/time-logs/live` for admins and team leads.
- Admins receive active timers across the organization.
- Team leads receive timers only for employees in teams they lead.
- Replaced the empty admin task tracker and hardcoded team-lead tracker with real API data.
- Tracker pages refresh every 5 seconds and on focus/reconnect/visibility changes.

### Authentication and sessions

- Replaced the single remembered-session slot with a bounded list of hashed remembered sessions. Web and desktop quick-login sessions no longer overwrite each other.
- Quick login rotates only the remembered session used by that device.
- Password reset/change revokes all remembered sessions and increments `tokenVersion`.
- Normal logout clears the current client's stored authentication without globally invalidating the other client's access token.
- Plain-text passwords are not stored by the quick-login implementation.

## Data flow after the fix

### Dashboard to desktop

1. Dashboard sends the mutation to the shared backend API.
2. Backend validates and writes the change to MongoDB.
3. Desktop refreshes on focus/reconnect/visibility or within 10 seconds.
4. Project and task lists are rebuilt from the latest API response while preserving valid current selections.

### Desktop to dashboard

1. Desktop sends timer, break, attendance, or task-related actions to the shared backend API.
2. Backend writes the state to MongoDB.
3. Live tracker pages refresh within 5 seconds; other audited management pages refresh within 10 seconds or immediately on focus/reconnect.

## Validation performed

- Backend automated tests: 29 passed.
- Desktop automated tests: 12 passed, including development/production API resolution.
- Dashboard tests: 2 passed.
- Dashboard ESLint: passed.
- Dashboard production build: passed (1,943 modules transformed).
- Backend and desktop JavaScript syntax checks: passed.
- Dashboard route audit: 22 static navigation targets checked against 64 routes.
- Local backend `/health`: successful.
- Production backend `/health`: successful.
- Electron Windows NSIS package: built successfully.
- Packaged `app.asar`: confirmed to include `api-config.js`, `preload.js`, and `renderer.js`.
- Installer: `desktop-app/dist/CRM-Setup.exe`, 111,102,747 bytes.
- Installer SHA-256: `933C4C3D8CC909CC6177BF6008A91EA42C84EF9F465535298D2959A24D846C53`.

No destructive write test was run against production customer data. The production health check proves the deployed server starts with its configured database connection; final end-to-end mutation verification should use a dedicated test employee/project.

## Remaining risks and follow-up work

1. Synchronization is polling-based, so changes are eventually visible within 5-10 seconds. Truly immediate updates require Socket.IO, WebSockets, SSE, or MongoDB change-stream broadcasting.
2. `dashboard/public/desktop-release.json` still advertises version `1.2.0` and an older hosted installer. The rebuilt local installer also remains version `1.2.0`, so existing clients will not detect it as an update. Increment the desktop version, upload the new installer, and update the manifest URL/hash before distributing it.
3. The Electron build still uses Electron's default application icon.
4. Some older report/status pages, including the admin and team-lead "Working Today" implementations, contain static placeholder rows rather than real API data. They were identified during the audit but are outside the corrected project/task/timer synchronization path and should be converted before treating those pages as authoritative.
5. Existing legacy tasks with no project association display `-` for Project. Edit those records and assign a valid project so project/team filtering can work consistently.
6. Normal logout is client-local. A copied JWT remains valid until its normal expiry; password reset/change still revokes every access token through `tokenVersion`. Per-device immediate JWT revocation would require server-side access-session IDs or a token denylist.

## Paired test procedure

### Local development

1. Set `backend/.env` with the intended test `MONGODB_URI`, JWT secrets, and local port 5000.
2. Start the backend from `backend`.
3. Start the dashboard from `dashboard`; without `VITE_API_URL`, it uses `http://localhost:5000/api`.
4. Start Electron from `desktop-app` with its development command; without `HANDDY_API_URL`, it uses the same local API.
5. Log into both clients with accounts from that database.
6. In the dashboard, create or edit a project, assign its client and team, then create a task under that project/team.
7. Focus the desktop app or wait up to 10 seconds. Confirm the project appears and the task appears after selecting it.
8. Start a desktop timer. Confirm the dashboard Task Tracker shows it within 5 seconds. Start/end a break and confirm the status changes; stop the timer and confirm the active row disappears.
9. Edit the employee or team assignment in the dashboard. Focus Electron or wait 10 seconds and verify the updated permitted projects/tasks.
10. Log out of one client and verify the other stays authenticated. Verify remembered quick login independently in both clients.

### Production/package

1. Deploy the updated backend/dashboard to the Render service configured by `render.yaml`.
2. Confirm the production dashboard network requests use same-origin `/api`.
3. Install the newly built Electron installer. The packaged app defaults to `https://handdy-workspace.onrender.com/api`.
4. Repeat the project/task/timer test above with dedicated test records.
5. Before public rollout, increment the Electron version and publish the new installer and release manifest so installed clients can receive it.
