# Handdy CRM: Optimization Plan, Phase by Phase

Based on `docs/Handdy_CRM_Updated_Architecture_and_Render_Data_Optimization_Report.pdf` (26 Oct 2026),
checked against the code in this repository (desktop 1.2.32).

**Goal:** cut the Render data usage (reported 4.8 GB "service-initiated" + 1.92 GB "HTTP responses"
since early October, for 15 employees) and make the system safer, **without changing any business rule**.

**Delivery (decided 2026-10-26):** all phases are built and tested here first and pushed together at the end.
Every fix ships **switched on**, and each has its own off-switch in Render → Environment (see "Switches" below).
Render's October numbers are the "before"; the Phase 0 metrics in the same push give the "after".

**How we work**

- One phase at a time, one task at a time. Each task ends with: tests pass → you check → deploy.
- Measure first (Phase 0). No fix is "done" until the numbers show it helped.
- Every change can be switched off or reverted on its own.
- Rules from the report that we keep in every phase:
  - Don't rewrite the app, change business rules, delete data or remove features.
  - No Redis, microservices, Kubernetes or extra paid servers unless measurements prove a need.
  - **Don't change the 20 s heartbeat** until the timer recovery rules have been reviewed together.
  - Timers, attendance, billing and permissions must give the same results before and after.
  - Older desktop versions must keep working during every rollout.

Legend: `[ ]` to do · `[x]` done · **You** = needs you (accounts, decisions, testing) · **Me** = code work.

---

## Already in place (don't redo, only verify)

The report asks us to check these before adding anything. They exist in the code today:

- [x] Gzip compression on all responses (`backend/server.js`).
- [x] Client / project / task lists answer **304 Not Modified** when unchanged (`middleware/catalogCache.js`, 5-minute ETag windows).
- [x] Reports and the desktop timesheet download **only changed rows** (`services/reportSync.js`, `?sync=true`).
- [x] Dashboard refreshes only while its tab is visible; the desktop skips the heavy lists while minimized.
- [x] Desktop refresh cannot overlap itself (in-flight guard in `renderer.js`).
- [x] 15 s sign-in cache, 30 s permission snapshot, one server instance pinned (`render.yaml`).
- [x] One running timer per employee and one active desktop session, enforced by unique indexes.
- [x] Server-side clock: time is computed on the server; disconnected timers close at the last heartbeat.
- [x] Desktop updates come from GitHub Releases, **not** from Render (installer downloads don't count on Render).

## What the code shows (suspects to confirm in Phase 0)

These are **hypotheses**. Phase 0 measures them before we change anything.

| # | Suspect | Why it may matter | Where |
|---|---|---|---|
| S1 | **"Another device" long-poll asks MongoDB every 5 s.** While each 20 s long-poll waits, the server re-reads the session and pending requests every 5 s (~2 queries each time). The desktop app starts the next long-poll 1 s later, even when minimized, all day while signed in. Every open dashboard tab does the same, yet browser sessions never receive approval requests. | Runs nonstop for every open app and tab: about 0.4 database queries per second per client, around the clock if tabs stay open. Strong candidate for the 4.8 GB "service-initiated" traffic (queries sent to Atlas). | `authController.getPendingLoginRequest`, `renderer.js monitorDeviceLoginRequests`, `AppShell.jsx` |
| S2 | **Stale-timer sweep runs before almost every timer and report request**, plus every 30 s for everyone. | One extra database query per request. | `services/desktopTimerLease.js`, `taskTimeLogController.js` |
| S3 | **Each 20 s heartbeat costs 2-3 database commands** (sweep query + update + sign-in check when the 15 s cache expires). | 15 employees × 3 heartbeats/min. | `heartbeatTimer`, `authMiddleware.js` |
| S4 | **Desktop 30 s refresh** calls `/auth/me` + today's timesheet + up to 3 lists. | Mostly small or 304, but each call also triggers database checks. | `renderer.js runDesktopRefresh` |
| S5 | **Dashboard files are re-checked on every page load** (no long cache for the hashed `/assets` files). | Small: adds HTTP responses only. | `server.js` `express.static` |
| S6 | **MongoDB driver background checks** (connection pool, monitoring pings to each Atlas node). | Fixed cost; usually small. | `config/db.js` |

---

## Phase 0: Measure first (baseline)

**Goal:** know where the bytes go before fixing anything. **Risk:** none (read-only counters).

- [ ] **0.1 You:** in Render → service → Metrics/Bandwidth, note **daily** "service-initiated" and "HTTP responses" for October (screenshot or export), the plan name and its included bandwidth.
- [ ] **0.2 You:** in MongoDB Atlas → cluster → Metrics, screenshot **Network (bytes in/out)**, **Opcounters** and **Connections** for the same period. Note the cluster tier (M0/M2/M10…), because backups depend on it.
- [ ] **0.3 You:** tell me working hours, whether employees leave CRM signed in overnight, and how many dashboard tabs usually stay open (admins, HR, team leads).
- [x] **0.4 Me:** add request metrics (switch `METRICS_ENABLED`): per route template and method, count, status, response bytes, time. No tokens, passwords or employee data recorded.
- [x] **0.5 Me:** add MongoDB command counters: count and approximate bytes sent per command and collection (driver command monitoring).
- [x] **0.6 Me:** add counters for long-poll rounds, heartbeats, sweeps and reconnects; an admin-only summary endpoint plus a log line every 10 minutes.
- [ ] **0.7 Me + You:** deploy, run 2-3 normal working days, then I write `docs/OPTIMIZATION_BASELINE.md`: top endpoints by bytes, top database commands, and how they compare with Render's daily numbers (allowing for Render's ~1 hour reporting delay).

**Exit:** we can name the main sources of both traffic categories with numbers.
**Rollback:** set `METRICS_ENABLED=false`.

### How to read the Phase 0 numbers

Code: `backend/src/monitoring/trafficMetrics.js` (tests: `backend/test/trafficMetrics.test.js`).
It is on when the Render environment has `METRICS_ENABLED=true` (set in `render.yaml`).

- **Render → Logs, search `[metrics]`:** one line every 10 minutes with that window's numbers. Download or copy 2-3 days of these lines.
- **`GET /api/metrics` (admin, alpha, manager):** totals since the last restart plus the current window. From the dashboard, signed in as admin, browser console:
  `fetch('/api/metrics', { headers: { Authorization: 'Bearer ' + localStorage.token } }).then(r => r.json()).then(console.log)`

| Field | Meaning | Compare with |
|---|---|---|
| `destinations["mongodb-atlas"]` | Bytes the server sent to / received from Atlas, and connections opened | Render "service-initiated" |
| `destinations["smtp …"]` | Email traffic | Render "service-initiated" |
| `destinations["http-clients"]` | Bytes on connections from Render's proxy (response headers + bodies) | Render "HTTP responses" |
| `routes[]` | Per API route: count, status classes, response body bytes (after gzip), avg/max time | Which calls make the HTTP bytes |
| `db[]` | Per MongoDB command + collection: count, approximate bytes sent and received | Which code makes the Atlas bytes |
| `events` | `longpoll.pending.check.desktop/web`, `longpoll.wait.check`, `sweep.employee/all/closed`, `mongo.connection.*`, `mongo.monitor.heartbeat`, `mail.sent` | Suspects S1, S2, S6 |

Limits: byte counts are application-level (no TLS record overhead or TCP headers; each new TLS connection adds a handshake), so they rank and explain the sources. Render's totals remain the billed numbers.

## Phase 1: Low-risk traffic fixes

**Goal:** remove waste without touching how time is calculated. One task per deploy, each behind a switch.
Order follows the Phase 0 ranking; the list below is the expected order.

- [x] **1.1 Me:** long-poll stops polling MongoDB every 5 s. It checks once, then waits for the in-process "something changed" signal, which already exists (`loginNotifications.js`), with a final check at the end. Single instance, so no approval is missed. *(S1)*
- [ ] ~~**1.2**~~ **Skipped (D2 = no):** dashboard tabs keep their "another device" long-poll; 1.1 already makes it cheap.
  Was: dashboard tabs stop the nonstop "another device" long-poll. Browsers never get approval requests; sign-out is still detected by normal requests (401). *(S1)*
- [ ] **1.3 Deferred:** after 1.1 each idle long-poll costs one database read per 20 s, so this would save little; revisit if the metrics disagree.
  Was: desktop waits longer between long-polls while minimized (needs desktop 2.0.1; older versions keep working). *(S1)*
- [x] **1.4 Me:** heartbeat combines "close stale timer" and "extend lease" into one conditional database update instead of a query + update. Same 20 s interval, same 90 s rule. *(S3)*
- [x] **1.5 Me (D1 = yes):** report/history requests rely on the 30 s background sweep instead of running their own stale-timer query. Timer start/stop/active keep their own check. *(S2)*
- [x] **1.6 Me:** hashed dashboard files (`/assets/*`) cached for a year (`immutable`); `index.html` always re-checked. *(S5)*
- [x] **1.7 Me:** MongoDB pool tuned for one small server (for example `maxPoolSize: 10`, idle connections closed), then connections checked in Atlas. *(S6)*
- [x] **1.8 Me:** audit reports. Findings:
  - Every report screen and the desktop send a date range (default: today); the server refuses ranges over 366 days. No screen downloads full history.
  - Pages are 100 rows; the browser loads all pages of the chosen range and computes totals itself (needed for the detailed views).
  - **Open report tabs re-download their whole range every 5 minutes** (delta updates every 30 s, full reconciliation every 5 min). Large ranges left open repeat that download 12 times an hour. Candidate for Phase 2 (2.2).

**Status (2026-10-26):** built and tested (backend 183, dashboard 48, desktop 112 tests pass). Not yet deployed.

Estimated from the code (to be confirmed by the metrics), MongoDB commands per signed-in desktop per minute, background traffic only:

| Source | Before | After |
|---|---|---|
| "Another device" long-poll (2 reads every 5 s while waiting) | ~23 | ~6 |
| Heartbeat (sweep query + update, 3 per minute) | 6 | 3 |
| Timesheet refresh sweep (every 30 s) | 2 | 0 |
| **Total** | **~31** | **~9** |

Each open dashboard tab: ~11 → ~3 long-poll reads per minute.

**Exit for each task:** all test suites pass; same timesheet, attendance and billing totals for a sample week (before/after export compare); metrics show fewer bytes or commands per employee-hour.
**Rollback:** switch off the task's flag or revert its commit.

### Switches (Render → Environment)

All Phase 1 fixes are on unless their variable is set to `false`. Changing a variable restarts the service; no code change needed.

| Variable | Default | Turns off |
|---|---|---|
| `METRICS_ENABLED` | `true` (render.yaml) | Phase 0 measurement |
| `OPT_LONGPOLL_EVENTS` | on | 1.1, back to re-reading MongoDB every 5 s |
| `OPT_HEARTBEAT_SINGLE_WRITE` | on | 1.4, back to query + update per heartbeat |
| `OPT_REPORTS_SKIP_SWEEP` | on | 1.5, reports run their own stale-timer sweep again |
| `OPT_STATIC_ASSET_CACHE` | on | 1.6, Express default caching |
| `MONGODB_MAX_POOL_SIZE` | `10` | 1.7, set a larger number (driver default 100) |
| `OPT_REPORT_CHECKSUM` | on | 2.2, open reports return to the 5-minute full reload |

Code: `backend/src/config/optimizations.js`. Tests: `backend/test/phase1Optimizations.test.js`, `dashboardCache.test.js`, `bandwidthOptimizations.test.js`.

## Phase 2: Smarter sync (only where Phase 0 shows it is worth it)

**Goal:** stop re-sending unchanged data. Built **beside** the current endpoints; old clients keep working.

- [x] **2.1 Me:** desktop project and task lists revalidate instead of re-downloading. Finding: the desktop loaded them with `cache: "no-store"`, so the server's ETag/304 never applied and the full lists came down every 30 s whenever no timer ran (also the whole time the screen is locked). Now `cache: "no-cache"`: Chromium sends the ETag, an unchanged list costs a body-less 304, and edits still arrive at once because the ETag changes with every edit. Chromium's HTTP cache persists across app restarts. The clients list already worked this way. **Ships with desktop 2.0.1.**
- [x] **2.2 Me:** open dashboard reports no longer re-download their whole range every 5 minutes. With each delta the server sends a **fingerprint** of the complete report (row count + sum of last-change seconds; active timers listed by ID and left out) when the dashboard asks (`checksum=true`). The dashboard computes the same fingerprint over its merged copy:
  - match → the copy is proven complete and keeps using deltas; a full reload still happens at least once an hour;
  - mismatch (a missed change, a deletion, any surprise) → the previous rule applies: full reload after 5 minutes. So it can never do worse than before.
  - Desktops and older dashboards don't ask, so they cause no extra database work. The desktop's own "today" timesheet (~20 rows) keeps the 5-minute rule.
  - Switch: `OPT_REPORT_CHECKSUM=false`. Code: `backend/src/services/reportSync.js` (`reportChecksum`), `dashboard/src/utils/reportLoader.js`.
- [x] **2.3 Me:** shadow-compare: covered by design. Every delta is checked against the server's fingerprint of the full result, and any difference falls back to a full reload.
- [ ] **2.4 You (after the final push):** install desktop 2.0.1 on 2-3 PCs first, then everyone through auto-update.

**Exit:** zero differences in the shadow compare; measured byte reduction.
**Rollback:** clients fall back to the current endpoints automatically.

**Status (2026-10-26):** built and tested (backend 185, dashboard 51, desktop 113 tests pass). Not yet deployed.

Expected effect (estimate): a dashboard report left open re-downloads its full range at most hourly instead of 12 times an hour, e.g. a month for 15 employees (~5,000 rows, ~0.4 MB compressed) drops from ~5 MB to ~0.4 MB per hour per open tab. Idle desktops (no timer) stop downloading the project and task lists every 30 s; they get a full copy at most every 5 minutes (the server's ETag window).

## Phase 3: Timer and session safety

**Goal:** make start/stop/heartbeat safe against retries, races, sleep and restarts. Timing rules stay the same (20 s / 90 s / 30 s).

- [x] **3.1 Me:** operation IDs for start and stop: a retried request returns the first result instead of acting twice. Optional field, so old desktops still work.
  - Server: `startOperationId` / `stopOperationId` on the time log (unique per employee for starts, so two identical starts at the same moment still create one timer). Reusing an ID for a different task is refused (409 `OPERATION_ID_REUSED`).
  - A stop may name its timer (`timeLogId`): a late or repeated click can never stop a timer started afterwards (409 `TIMER_CHANGED`).
  - "Already have an active timer" now carries the code `ACTIVE_TIMER_EXISTS`.
  - Desktop (**2.0.1**): sends the IDs and reuses them when retrying after a lost response; on `ACTIVE_TIMER_EXISTS` it shows the running timer instead of an error; on `TIMER_CHANGED` it refreshes like it already did for "already stopped".
- [x] **3.2 Me:** state checks on every timer change: a late heartbeat can never reopen a stopped timer; recovery and stop cannot both "win".
  - **Bug fixed:** stop used to read the timer, compute and then save the whole document. If the 30 s sweep closed the timer at its last heartbeat in between, the save overwrote that with a later stop time and counted time the desktop never confirmed. Stop is now one conditional update (only while the timer is still active in the status that was read); otherwise the sweep's result stands and the desktop is told the timer was already stopped.
  - Pause, resume, note, heartbeat and the sweep were already conditional updates; tests now cover them.
- [x] **3.3 Me:** document and test the maximum delay for sign-out and permission changes:

  | Change | Takes effect | Why |
  |---|---|---|
  | Sign-out, second-device approval, password change, account deactivated, session revoked | **Next request** | Every Employee/AuthSession write clears the sign-in cache (`services/authCache.js`); desktop long-polls are woken at once (1.1) |
  | Role permissions saved on the Permissions page | **Next request** | The saved role replaces the in-memory snapshot (`permissionService.setRoleOverride`) |
  | Personal grants (create/edit employees) | **Next request** | Employee write clears the sign-in cache |
  | Any of the above changed **directly in the database** (not through the app) | up to **15 s** (sign-in) / **30 s** (permissions) | Cache lifetimes |
  | Session reaching its expiry time | **Next request** | Checked on every request even when cached |

  Tests: `authCache.test.js`, `permissions.test.js`, `legacyCompatibility.test.js`.
- [x] **3.4 Me:** test suite (`backend/test/timerSafety.test.js`, 10 tests): stop vs sweep race, repeated stop, stop aimed at a replaced timer, malformed IDs, pause/idle totals, repeated start, two identical starts at once, second start without ID, late heartbeat after stop, sweep re-run after restart. Already covered elsewhere: overnight timers and attendance days (`attendanceService.test.js`), two devices (`authSessionService.test.js`), lease closing at the last heartbeat (`desktopTimerLease.test.js`). Desktop retry behaviour: 3 tests in `desktop-app/test/work-selection.test.js`.
- [x] **3.5 Me:** graceful shutdown on Render deploys (`backend/src/services/gracefulShutdown.js`): on SIGTERM the server refuses new connections, lets open requests finish (long-polls end within 20 s), stops the sweep and the metrics log, logs the last metrics window, closes MongoDB, and exits; anything still open after 25 s is cut off (Render allows 30 s).

**Exit:** all race/retry/restart tests pass; no change in totals for the sample week.

**Status (2026-10-26):** built and tested (backend 197, desktop 116 tests pass). Not yet deployed. These are correctness fixes, so they have no off-switches (switching them off would bring the races back); rollback is reverting the commit. Server changes are compatible with every desktop version; the desktop part ships in **2.0.1**.

## Phase 4: Cleaner code structure (optional, no user-visible change)

**Goal:** group backend code by business area, as in the report's target tree. Pure moves, one module per change.

- [x] **4.1 You (decision D5):** yes, do it now (2026-10-26).
- [x] **4.2 Me:** backend grouped by business area, every URL and response unchanged:

  ```
  backend/src/
    modules/        auth, employees, teams, clients, projects, tasks (+ taskPermissions),
                    timers (time logs + manual entries), attendance, billing, permissions,
                    settings, scheduling (shifts + schedules); index.js lists module → URL
    monitoring/     trafficMetrics.js, metricsRoutes.js
    jobs/           timerSweep.js (the 30 s lease sweep, also run at startup)
    middleware/     shared: authMiddleware, authorizeRoles, catalogCache, rateLimit, errorHandler
    services/ models/ utils/ config/   unchanged
  ```

  Moved with `git mv` (history kept) and every `require` path rewritten by script; all 122 backend files checked for broken paths, and the server was started to confirm every module loads. New `test/modules.test.js` loads every module and checks the URL list, so a broken path fails the tests.
  - Not done, deliberately: splitting the dashboard into `features/` and `desktop-app/renderer.js` into `services/`. Both are large moves of user-facing code with no data saving; the desktop tests and packaging also treat `renderer.js` as one file. Revisit if those files become hard to change.
  - `CODEBASE_GUIDE.md` still shows the old `routes/` and `controllers/` paths; it is updated in 5.6.
- [x] **4.3 Me:** `shared/api-contracts/README.md`: compatibility rules, sign-in errors, timer start/stop/heartbeat (operation IDs, `timeLogId`, codes), report delta sync and fingerprint, catalog ETag/304, long-polls, metrics.

**Exit:** tests pass after every move. **Rollback:** revert the single move.

**Status (2026-10-26):** done; backend 199 tests pass. Pure moves: no behavior change and no switch needed.

## Phase 5: Operations, security and backups

- [ ] **5.1 You:** check Atlas backups for your tier. If the tier has none (M0/M2), decide on a daily backup job and where to keep it (decision D3). Everything for the job is ready (5.2).
- [x] **5.2 Me:** backup and restore scripts (`npm run backup:db`, `npm run restore:db`): gzipped collections with exact types (EJSON) plus a manifest of counts and indexes; restore only into a separate database (refuses the live one), recreates indexes and verifies counts. Guide: `docs/BACKUP_AND_RESTORE.md` (Atlas check, read-only backup user, daily Windows task, restore drill, real recovery). Backups contain personal data and never go into git (`backend/backups/` ignored).
  - **You:** run the first restore drill once backups are set up.
- [x] **5.3 Me:** alerts as `[alert]` log lines per 10-minute window (`monitoring/trafficMetrics.js`): over 20 server errors, over 10 timers closed by the sweep, over 20 new MongoDB connections, failed MongoDB monitoring checks, failed sweeps (plus once after 3 failures in a row, `jobs/timerSweep.js`), long-poll storms (300+ long-polls averaging under 5 s), over 50 MB to one destination (`METRICS_ALERT_MB_PER_WINDOW`). `/health` answers 503 while MongoDB is disconnected, so Render does not switch a deploy over to an instance without a database and restarts one that stays unhealthy (`healthCheckPath: /health` in `render.yaml`; `HEALTH_CHECK_DATABASE=false` restores the old always-200).
- [x] **5.4 Me:** security review: `docs/SECURITY_REVIEW.md`. Fixed: tokens signed and accepted only as HS256; dependency vulnerabilities 3 + 4 → 0 (`nodemailer` 10, reset email tested over SMTP); desktop refuses all permission requests (camera, microphone, location…). Checked: access rules per area on the server, sessions and revocation, sync scope, input limits, headers, Electron settings. Recommendations: code signing (D4), tokens out of `localStorage`, narrower desktop CSP.
- [ ] **5.5 You (decision D4):** buy a Windows code-signing certificate? It removes "Windows protected your PC" warnings and lets the updater verify the publisher. Build steps are in `docs/DEPLOY_AND_ROLLBACK.md`.
- [x] **5.6 Me:** `docs/DEPLOY_AND_ROLLBACK.md` (server deploy, checks, settings, rollback; desktop release, rollback by a higher version; code signing; first release order). `CODEBASE_GUIDE.md` updated to the new layout.
- [x] **5.7 Me:** `docs/OPTIMIZATION_FINAL_REPORT.md`: changes by phase, estimates, test evidence, how to measure.
  - **You (after deploy):** fill in its before/after table from Render and the `[metrics]` lines.

**Status (2026-10-26):** done; backend 224, dashboard 60 (plus lint, route audit, build), desktop 119 unit tests and both Electron smoke tests pass; `npm audit` 0 in all three apps. Desktop **2.0.1** built (`desktop-app/dist`). Nothing deployed yet.

---

## Decisions needed from you

| ID | Question | Recommendation |
|---|---|---|
| D1 | May reports show a disconnected timer as "running" for up to 30 s longer (until the background sweep closes it)? Time recorded stays exact either way. | Yes: it only affects the live display, never the hours. |
| D2 | Stop the dashboard's "another device" long-poll? Browsers never receive approval requests. | Yes |
| D3 | If Atlas has no backups on your tier: run a daily backup job (to where)? | Yes; decide the storage place. |
| D4 | Buy a code-signing certificate? | Recommended before adding more employees. |
| D5 | Do the code restructure (Phase 4)? | Later, after the savings phases. |
| D6 | Offline mode for the desktop (keep working without internet, sync later)? The report mentions a local sync queue; today the timer needs the server. | Not now; it changes timer rules. |

## What I need from you to start Phase 0

1. Render bandwidth numbers per day (task 0.1).
2. Atlas metrics and tier (task 0.2).
3. Working hours, overnight sign-ins, open dashboard tabs (task 0.3).
4. A "go" to add the measurement code (it changes no behavior).
