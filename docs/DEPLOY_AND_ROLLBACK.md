# Deploy and roll back

Two separate routes: **server + dashboard** go live on Render when code reaches `main`; the **desktop
app** goes out through a GitHub Release. Always deploy the server first: new servers accept old
desktop apps, and new desktop apps work with the old server too.

## Server and dashboard (Render)

1. Commit and push to `main` (GitHub Desktop: commit all changes → **Push origin**).
2. Render builds and starts the new version; the old one keeps serving until `/health` answers 200,
   then it shuts down cleanly (open requests finish first).
3. Watch Render → **Logs** for:
   - `Server running on …` and, with metrics on, `[metrics] Traffic metrics are on…`;
   - no `[alert]` lines and no repeated errors.
4. Check, in this order:
   - `https://handdy-workspace.onrender.com/health` shows `"database":"connected"`;
   - sign in to the dashboard; open Overview, Attendance, a timesheet report;
   - on one desktop: start a timer, wait a minute, stop it; the Attendance page shows the day.

### Settings (Render → Environment)

Changing a value restarts the service; no code change needed.

| Variable | Default | Purpose |
|---|---|---|
| `METRICS_ENABLED` | `true` | Traffic measurement (`[metrics]` log lines, `/api/metrics`) |
| `OPT_LONGPOLL_EVENTS`, `OPT_HEARTBEAT_SINGLE_WRITE`, `OPT_REPORTS_SKIP_SWEEP`, `OPT_STATIC_ASSET_CACHE`, `OPT_REPORT_CHECKSUM` | on | Each traffic fix; set one to `false` to switch only that fix off |
| `MONGODB_MAX_POOL_SIZE` | `10` | MongoDB connections |
| `HEALTH_CHECK_DATABASE` | on | `/health` reports a lost database as 503 |
| `METRICS_ALERT_MB_PER_WINDOW` | `50` | Traffic alert threshold per 10 minutes |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | — | Password-reset email |

### Rolling back the server

- **Fastest:** Render → the service → **Events/Deploys** → pick the last good deploy → **Rollback**.
- **One fix misbehaving:** set its `OPT_…` variable to `false` instead of rolling everything back.
- **Permanently:** revert the commit in GitHub Desktop (History → right-click → Revert) and push.

No database migration is needed for these changes: new fields are optional and old records stay as
they are, so a rollback needs no data change.

## Desktop app (GitHub Releases)

1. In `desktop-app/package.json` raise `version` (e.g. `2.0.1` → `2.0.2`); it must be higher than
   the last release.
2. `cd desktop-app`, then `npm test`, then `npm run build`.
3. GitHub → **Releases** → **Draft a new release** → tag `v2.0.2` on `main` → title `CRM 2.0.2` →
   attach the 3 files from `desktop-app/dist`: `CRM-2.0.2-Windows-x64.exe`,
   `CRM-2.0.2-Windows-x64.exe.blockmap`, `latest.yml` → **Publish release** (not draft).
4. Apps check 15 s after start and every 6 hours, download quietly, and install when no timer runs
   and the PC has been idle for a minute (or when CRM closes).

Never replace or delete the files of a published release: `latest.yml` holds the checksum of its
`.exe`, and changing them breaks updating.

### Rolling back the desktop app

Apps never update to a *lower* version. To undo a desktop release, revert the desktop change, raise
the version again (e.g. `2.0.3`) and publish that release; it replaces the bad one through the
normal auto-update.

### Code signing (decision D4)

With a Windows code-signing certificate (OV or EV, from a certificate authority):

1. In the terminal used for building only: set `CSC_LINK` (path to the `.pfx`) and
   `CSC_KEY_PASSWORD`. Never store them in the repository.
2. Build with `npm run build:signed` (fails if signing does not work), or use `npm run publish` with
   `GH_TOKEN` to create a signed draft release.
3. After the first signed release, sign **every** release with the same certificate.

## First release after the optimization phases

1. Push all code → Render deploys → run the checks above.
2. Let it run a working day; look at the `[metrics]` lines and `/health`.
3. Build and publish desktop **2.0.1** (operation IDs, list caching, permission refusal, screen lock lifts as soon as Start is pressed). Installed
   1.2.32 apps update themselves automatically.
4. After 2–3 working days, compare Render's daily bandwidth with the October numbers
   (`docs/OPTIMIZATION_FINAL_REPORT.md`).
