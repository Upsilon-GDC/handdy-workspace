# CRM traffic optimization release verification

Date: 2026-11-06. Desktop candidate: **2.0.5**.

**Superseded:** this records the earlier 2.0.5 verification. The security follow-up is **CRM 2.0.6 with Electron 44.10.2**; see [the updated audit and verified installer](RECENT_CHANGES_AUDIT_2026-11-06.md#verified-desktop-release). The current `desktop-app/dist/latest.yml` belongs to 2.0.6 and must not be paired with the older installer described below.

The local backend, dashboard and desktop changes reduce repeated downloads and database reads while preserving the 20-second timer heartbeat and 90-second server lease. Release files are prepared locally. Production rollout and measured bandwidth savings remain pending.

## Changes included

| Phase | Result |
|---|---|
| 1 | Traffic logging and an offline analyser; preliminary production baseline from the supplied screenshots |
| 2 | Five-minute desktop profile/timesheet budgets, immediate action updates, checksum deltas and periodic complete reconciliation; five-minute dashboard polling |
| 3 | Authorized catalog caching, revision invalidation and validators that remain usable across five-minute polls |
| 4 | Overview shares the productivity roster and avoids duplicate current-day activity downloads |
| 5 | Hidden desktop windows skip nonessential downloads; failed automatic data reads and approval checks use separate bounded retry delays |
| 6 | Final regression checks, installer integrity verification and rollout/measurement instructions |

The heartbeat, idle detection, idle-policy refresh, explicit timer actions and time calculations retain their existing rules. Healthy desktop device-approval checks continue while minimized.

## Regression evidence

| Check | Result |
|---|---|
| Backend unit tests | 315 passed |
| Backend integration tests using isolated loopback databases | 54 passed |
| Dashboard unit tests | 98 passed |
| Dashboard lint and production build | Passed |
| Dashboard route audit | 47 static navigation targets and 69 registered routes passed |
| Desktop unit tests | 153 passed |
| Electron smoke checks | Startup, inactivity, activity links, manual entry, time corrections, Overview, project/task creation, bulk links, working hours, client access and Chromium catalog caching passed |
| Dashboard lifecycle smoke | Passed: five-minute timer, stable navigation, report exports, permissions, device approval/revocation, pagination and independent web sign-out |
| NSIS shortcut fixture | Passed; no real installation or employee shortcuts changed |
| Read-only database index audit | All 9 expected timestamp-index checks across 7 collections passed; no duplicate matching definitions |

The dashboard lifecycle test previously expected a 30-second poll. It now checks that no automatic reload occurs in that window, captures the real five-minute interval through an isolated test preload and invokes its callback to verify refresh behavior without waiting five minutes. Its failure path now exits Electron with a nonzero code, so an assertion cannot be hidden by a successful process exit. A four-minute watchdog bounds a stalled run; production desktop settings are unchanged. All smoke checks passed, including the corrected lifecycle rerun.

Vite reports large optional export chunks. The build succeeds; this warning does not measure recurring API traffic. The index audit read metadata from the configured database through the native client, without loading model connections that could initialize indexes. No production records or indexes were changed. Employee installations and release publication were not performed.

## Verified desktop artifacts

Files in `desktop-app/dist/`:

- `CRM-2.0.5-Windows-x64.exe`
- `CRM-2.0.5-Windows-x64.exe.blockmap`
- `latest.yml`

Installer size: **111,462,010 bytes**.

SHA-256:

```text
7d0a8726dc24a5e3bd0ad619404c90060db5bc402d283917ccc73654829d0550
```

The installer SHA-512 matches both checksums in `latest.yml`; its filename, version and size match the metadata. The blockmap is present. All 12 explicitly packaged source files match the workspace byte for byte, and the packaged application version is 2.0.5. Windows Authenticode reports this local installer as **NotSigned**. The checks do not confirm that this version is higher than every public release. Use the existing signed-release workflow if distributing through the signed publisher pipeline.

## Rollout

1. Review and commit the intended source files. The workspace also contains earlier UI and client-access work; do not discard those changes or commit local repair snapshots, credentials, logs or installers. Build artifacts belong in a release, not normal Git history.
2. Deploy the backend and dashboard together. `render.yaml` builds the dashboard with the backend service and uses `/api`. Keep one backend instance because several caches and coordinators are in memory. Confirm the deployed revision and database-connected `/health` response.
3. Verify Overview, a report and project/client choices. Keep `METRICS_ENABLED=true` for comparison windows. The new backend also supplies the longer report-sync marker validity needed for efficient five-minute delta reads.
4. Install 2.0.5 on one pilot PC between active timers. Verify sign-in/startup defaults, project/client restrictions, Training Start, a minute of heartbeat operation, Stop, timesheet updates, minimize/reopen and reconnect behavior.
5. Roll out the verified desktop to the other PCs. If using the updater, first confirm the version is greater than the latest published stable release and follow [Deploy and roll back](DEPLOY_AND_ROLLBACK.md). Publish the installer, matching blockmap and matching `latest.yml` together. Rebuilding changes checksums, so reverify and replace the entire unpublished artifact set together.

This phase does not push Git commits, deploy Render, publish GitHub releases or install CRM automatically.

## Measure actual savings

Collect at least several complete ten-minute `[metrics]` JSON windows during normal work after rollout; a full working day is preferable. Save an equivalent before period, actual employee-hours, backend/dashboard revisions, desktop version counts and Render HTTP Responses/Service-Initiated usage for exactly those periods. Exclude deployment/startup windows from a steady-state comparison and keep workload and open-window behavior comparable.

Run the existing offline analyser for each period from `backend`:

```powershell
npm run analyze:traffic -- "C:\path\before.log" --employee-hours 200 --out "C:\path\before-report.md"
npm run analyze:traffic -- "C:\path\after.log" --employee-hours 200 --out "C:\path\after-report.md"
```

Here 200 employee-hours is an example assuming all 20 employees used CRM for ten hours. Replace it with actual usage for each export. Use distinct output filenames; the analyser refuses to overwrite existing files.

Compare requests and bytes per employee-hour, route response bytes, database command counts and outbound destination bytes. Compute savings as `100 * (before per employee-hour - after per employee-hour) / before per employee-hour`. Do not add received database bytes to outbound totals. Body-byte instrumentation omits headers and some transport overhead, so compare Render totals separately.

| Production evidence | Status |
|---|---|
| Preliminary before window | Screenshot summary available; deployment window and actual employee-hours limit comparison |
| Representative matched before export | Pending |
| Post-rollout export and actual employee-hours | Pending |
| Matched Render bandwidth totals | Pending |
| Verified MB or percentage savings | Not yet measured |

The earlier 1.07 GB figure is monthly; it cannot be compared directly with a two-day request graph or one ten-minute log window. See [Baseline collection](TRAFFIC_BASELINE_COLLECTION.md) and [Preliminary baseline](TRAFFIC_BASELINE_2026-11-06.md).

## Rollback

Restore a known-good backend/dashboard revision through the existing deployment workflow. For desktop updater rollback, ship the known-good behavior under a higher version rather than replacing a published installer or expecting a downgrade. Preserve the same heartbeat/lease rules and recheck the three release artifacts after rebuilding.
