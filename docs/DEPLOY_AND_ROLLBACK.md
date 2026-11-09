# Deploy and roll back

Two separate routes: **server + dashboard** go live on Render when code reaches `main`; the **desktop
app** goes out through a GitHub Release. Deploy the server first after the compatibility checks in
the Phase 2/4 notes: supported clients must send timer heartbeats, and legacy attendance writes now
return 410. Pause time writes during deployment handoff so old/new processes do not concurrently
serve writers protected only by the Phase 3 process queue.

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

Phase 3 adds the `manual_entry_operation` unique partial index at startup; verify it before rollout.
Historical rows are not backfilled. A rollback can reintroduce fixed authorization/concurrency bugs
and the legacy attendance write path; review compatibility and pause writers before rollback.

## Desktop app (GitHub Releases)

1. In `desktop-app/package.json` raise `version` (e.g. `2.0.1` → `2.0.2`); it must be higher than
   the last release.
2. `cd desktop-app`, then `npm test`, then `npm run build:signed` with the publisher certificate configured. Unsigned local builds are not approved release artifacts.
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

1. In the terminal used for building only: set `CSC_LINK` (path to the `.pfx`),
   `CSC_KEY_PASSWORD`, and `CRM_PUBLISHER_NAME` (the exact publisher name on that certificate).
   Never store certificate credentials in the repository. No certificate was provisioned by Phase 6.
2. Build with `npm run build:signed` (fails if signing does not work), or use `npm run publish` with
   `GH_TOKEN` to create a signed draft release.
3. Run `powershell -NoProfile -File scripts/verify-installer.ps1 -Installer dist/CRM-<version>-Windows-x64.exe`.
   It requires a valid Windows signature and the configured publisher and outputs SHA-256. Verify
   installer size/version/SHA-512 against `latest.yml` and its blockmap as a separate release check.
4. After the first signed release, sign **every** release with the same publisher certificate policy.
   Existing unsigned installations need a staging upgrade test to the first signed release.

## Automated quality checks

`.github/workflows/quality.yml` adds backend unit/integration recovery tests and dashboard tests,
lint, route audit and build on Linux, plus the desktop suite on Windows. It requests read-only
repository permissions and does not deploy, publish or use signing secrets. The workflow has been
prepared locally; GitHub execution and branch-protection required checks must be verified/configured
after an authorized push. CI success does not itself approve a production recovery or release.

## Release after the readiness phases

1. Finish Phase 7 verification and review the phase-specific compatibility/recovery notes before an authorized push or rollout.
2. Confirm CI on GitHub and configure required checks; local workflow creation does not enable branch protection.
3. During the authorized backend deployment, pause time writers across handoff, verify startup indexes, then check health, permissions, live timers, attendance and reports in staging/production as appropriate.
4. For the desktop release, choose a stable version higher than the current public version. Build and verify the signed artifact set, including a staging upgrade from the previously installed unsigned client.
5. Publish/distribute only after the release has been reviewed and authorized. Monitor application errors and comparable traffic metrics after rollout. No push, deployment, publication or employee installation was performed by the local readiness phases.
