# Optimization: final report

Plan: `docs/CRM_OPTIMIZATION_PHASE_PLAN.md`. Source: `docs/Handdy_CRM_Updated_Architecture_and_Render_Data_Optimization_Report.pdf`.
State on 26 October 2026: **all phases built and tested, not yet deployed.** Server and dashboard go
live with the next push to `main`; the desktop part ships as **2.0.1**.

## Starting point

Render, since early October, 15 employees: **4.8 GB "service-initiated"** (traffic the server
starts: MongoDB Atlas, email) and **1.92 GB "HTTP responses"** (what the server sends to apps and
browsers). No business rule, timing rule (20 s heartbeat, 90 s lease, 30 s sweep) or feature was
changed to reduce it.

## What changed

| Phase | Change | Effect | Off-switch |
|---|---|---|---|
| 0 | Traffic measurement: bytes per API route, per MongoDB command, per destination; `[metrics]` log line every 10 min; `/api/metrics` | Shows where the bytes go | `METRICS_ENABLED=false` |
| 1.1 | "Another device" long-poll waits for an in-process signal instead of asking MongoDB every 5 s | Largest suspect for "service-initiated" | `OPT_LONGPOLL_EVENTS` |
| 1.4 | Heartbeat: one conditional update instead of query + update | Half the heartbeat commands | `OPT_HEARTBEAT_SINGLE_WRITE` |
| 1.5 | Reports rely on the 30 s background sweep (decision D1) | One query less per report request | `OPT_REPORTS_SKIP_SWEEP` |
| 1.6 | Dashboard files cached a year (hashed names), `index.html` always re-checked | Fewer HTTP responses | `OPT_STATIC_ASSET_CACHE` |
| 1.7 | MongoDB pool limited to 10 connections | Fewer idle connections and checks | `MONGODB_MAX_POOL_SIZE` |
| 2.1 | Desktop project/task lists revalidate (304) instead of re-downloading every 30 s (desktop 2.0.1) | Fewer HTTP responses from idle desktops | — (desktop) |
| 2.2 | Open reports check a fingerprint instead of re-downloading the whole range every 5 min | Large reports: hourly instead of 12× per hour | `OPT_REPORT_CHECKSUM` |
| 3 | Timer safety: operation IDs on start/stop, atomic stop (fixes a stop-vs-sweep race that could count unconfirmed time), clean shutdown on deploys | Correctness, no traffic change | — (revert) |
| 4 | Backend grouped by business area; API contracts written down | Maintenance only | — |
| 5 | `/health` reports a lost database; `[alert]` log lines; security fixes; backup/restore scripts; deploy/rollback, backup, security guides | Operations | `HEALTH_CHECK_DATABASE`, `METRICS_ALERT_MB_PER_WINDOW` |

## Expected effect (estimates from the code, to be confirmed)

MongoDB commands per signed-in desktop per minute, background only:

| Source | Before | After |
|---|---|---|
| "Another device" long-poll | ~23 | ~6 |
| Heartbeat | 6 | 3 |
| Timesheet refresh sweep | 2 | 0 |
| **Total** | **~31** | **~9** |

- Each open dashboard tab: ~11 → ~3 long-poll reads per minute.
- A report left open (e.g. one month for 15 employees, ~0.4 MB compressed): ~5 MB → ~0.4 MB per
  hour per tab.
- An idle desktop (no timer running): project and task lists cost a body-less 304 every 30 s
  instead of a full download.

If the long-poll is the main source of "service-initiated", as the code suggests, that category
should fall by well over half. Only the measurements below can confirm it.

## Test evidence (26 October 2026)

| Area | Result |
|---|---|
| Backend | 223 / 223 tests pass (`npm test`) |
| Dashboard | 60 / 60 tests pass, lint clean, route audit passed (41 navigation targets, 63 routes), production build OK |
| Desktop | 119 / 119 unit tests pass; Electron smoke tests pass (inactivity popup and logout, dashboard lifecycle with 125 employees) |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities in backend, dashboard and desktop |
| Installer | `CRM-2.0.1-Windows-x64.exe` built; `latest.yml` version 2.0.1; updater points at `Upsilon-GDC/handdy-workspace` |

New tests cover: metrics and alerts, each Phase 1 switch, cache headers, report fingerprint (server
and dashboard), 10 timer race/retry/restart cases, desktop retry behaviour, graceful shutdown, health
check, module loading, backup round-trip (ObjectIds, dates, number types), password-reset email over
SMTP, Electron permission refusal.

## Measuring the result after deploy

Because everything ships at once, Render's October numbers are the "before" and the new metrics
give the "after".

1. **Days 1–3 after the push:** Render → Metrics → Bandwidth, note each working day's two
   categories. Render reports with about an hour's delay.
2. **Same days:** Render → Logs, search `[metrics]`; copy the lines. The largest `mongodb-atlas`
   commands and `routes` by bytes show what is left.
3. **Atlas** → Metrics: Network and Opcounters should drop at the time of the deploy.
4. **Compare per employee-hour** so busier days don't distort it:
   `MB per employee-hour = category MB for the day ÷ (employees signed in × hours CRM was open)`.

| Category | October (per day / per employee-hour) | After (per day / per employee-hour) |
|---|---|---|
| Service-initiated | _fill in_ | _fill in_ |
| HTTP responses | _fill in_ | _fill in_ |

If a category did not fall, `[metrics]` names the route or command responsible; each fix can be
switched off on its own (`docs/DEPLOY_AND_ROLLBACK.md`).

## Still open (needs you)

1. Push all changes; Render deploys; run the checks in `docs/DEPLOY_AND_ROLLBACK.md`.
2. Publish desktop release **v2.0.1** (3 files from `desktop-app/dist`); try it on 2–3 PCs first.
3. After 2–3 working days, fill in the table above (plan tasks 0.1, 0.2, 0.7).
4. Atlas Backup tab: decide on backups (D3) and run the first restore drill (`docs/BACKUP_AND_RESTORE.md`).
5. Code-signing certificate (D4), recommended in `docs/SECURITY_REVIEW.md`.
