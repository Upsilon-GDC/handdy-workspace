# CRM development readiness audit

Date: 9 November 2026. Scope: current local backend, dashboard, and desktop source; local automated verification. No application source was changed, no production data was accessed, and nothing was deployed.

## Phase 1 implementation update — 9 November 2026

The original audit below describes the baseline before implementation. **Findings 1 and 4 are now addressed in the workspace**; the remaining phases are still outstanding. Application source has been changed for Phase 1; no deployment or production data changes were made.

- Team creation now checks `assign_team_leads` before accessing team/employee data when a lead is supplied. Creating a team without a lead still requires only `create_teams`. Changing an existing lead retains the existing `edit_teams` plus assignment rule.
- The Add Team lead selector is disabled without assignment permission and explains the required permission. Add/edit requests omit the lead field without that permission, including when form state predates a permission change.
- All three team/company attendance report routes now use effective permission checks, honoring revocations for configurable roles. Default HR/team-lead access, delegated grants, and existing admin-level behavior remain covered. Personal attendance access and report data scoping were not changed.
- The permission description now explains assignment during both team creation and editing.
- Regression coverage exercises denied assignments without database access, unassigned creation, authorized movement of an existing lead, assignment-only denial, and attendance defaults/grants/revocations. The old test that expected revoked team-lead access was corrected.

Phase 1 verification: **324 backend tests and 98 dashboard tests passed**; dashboard lint, production build, and `git diff --check` passed. The build retains its existing large-chunk warning. Backend log: `artifacts/phase1-backend-tests.log`; build log: `artifacts/phase1-dashboard-build.log`. No real-database or Electron GUI suite was rerun for this permission-gate/form change; the baseline integration results below remain historical audit evidence.

## Decision

### Phase 7 final status — 9 November 2026

**All seven local phases are implemented and verified; ready for staging validation.** Final results: **339 backend, 73 database integration/recovery, 98 dashboard and 154 desktop unit tests passed (664 total)**, plus the complete Electron GUI suite, isolated NSIS fixture, dashboard lint/routes/build and a separate Windows validation package. Packaged source assets and update hashes match. A final team-edit permission race affecting redundant lead fields from older clients was fixed and regression-tested.

The validation installer is unsigned and was not installed/distributed. Publisher signing, hosted CI/branch protection, installed-client staging checks, historical-record review and a production-representative recovery drill remain release requirements. Fresh scans show no high/critical advisories, with moderate development/build-tool alerts remaining (backend 2, dashboard 4, desktop 6 affected-package counts). No forced dependency changes were applied.

See [final verification and release requirements](FINAL_VERIFICATION_PHASE_7.md). No production write, push, deployment or publication was performed. Earlier findings and phase results below remain historical evidence; the final report records the current local state.

### Phase 6 implementation update — 9 November 2026

**Finding 7 is addressed in the local recovery tooling.** New backups use one data snapshot, preserve BSON types, record checksums/options/indexes, and publish a completion marker only after successful export and catalog checks. Restore verifies all files before writes, refuses source/occupied targets, recreates validators/indexes, and runs read-only cross-record checks. Legacy exports require explicit `--allow-legacy` and remain unverified for a common recovery point. Incomplete/legacy exports are excluded from automatic retention. See [updated recovery procedure](BACKUP_AND_RESTORE.md).

Added a read-only-permissions GitHub Actions workflow for backend, integration/recovery, dashboard and Windows desktop checks. It is prepared locally, not remotely executed or configured as a branch-protection gate. Signing builds/publication now require an explicit certificate publisher and credentials and enforce signature verification. The installer verification script rejected the current unsigned installer as expected. **Finding 8 still requires an actual publisher certificate and a newly signed, verified release; neither was provisioned or produced.**

Verification: **338 backend tests, 73 disposable-MongoDB integration tests, and 154 desktop unit tests passed**; workflow YAML and installed builder signing configuration validated locally. See [Phase 6 results and limits](RECOVERY_RELEASE_PHASE_6.md). No production backup/restore, hosted CI, deployment, publication or installation was performed. Phase 7 broad final verification remains outstanding.

### Phase 5 implementation update — 9 November 2026

**Finding 6 is addressed within the current single-process deployment.** Password and quick login share an IP budget of 100 attempts/15 minutes. Password login adds a normalized-email budget of 20 across IPs and retains the 10-attempt IP/email pair threshold. Quick login uses corresponding remembered-credential and IP/credential budgets; spoofed emails do not change its credential identity. Each limiter store is bounded to 10,000 hashed keys, expired windows are cleaned on subsequent requests, and capacity saturation throttles new identities without evicting active limits. Existing 429 message/Retry-After behavior remains; registration/password-reset thresholds retain independent route budgets.

Verification: **337 backend tests passed**, including nine new tests for mounted route enforcement, rotating identities/IPs, shared-office retries, expiry, malformed identity fields, and storage saturation. No frontend or database-write behavior changed, so those suites were not rerun. See [Phase 5 policy and deployment scope](LOGIN_PROTECTION_PHASE_5.md). Nothing was deployed or tested against production login traffic. Phase 6 and final verification remain outstanding.

### Phase 4 implementation update — 9 November 2026

**Finding 5 is addressed in the workspace.** Legacy attendance check-in/out writes are retired: authenticated requests now receive HTTP 410 `ATTENDANCE_TIMER_MANAGED` without reading or modifying attendance/time-log records. Authentication still applies, and admin callers receive the same retirement response. Supported attendance writes come from time-entry activity; reads, report permissions, historical records, and existing start-day/overnight rules remain intact.

Verification: **328 backend tests and 67 disposable-MongoDB integration tests passed**, including direct requests without activity, legacy calls racing timer start/stop, unchanged historical legacy rows, and overnight paused attendance followed by time-entry reconciliation. No frontend code changed. See [Phase 4 policy and migration notes](ATTENDANCE_CONSISTENCY_PHASE_4.md): any client relying on the retired successful-write contract must migrate before rollout, and historical open legacy rows require review rather than fabricated checkout timestamps. Nothing was deployed. Phase 5 and later work remains outstanding.

### Phase 3 implementation update — 9 November 2026

**Finding 3 is addressed within the existing single-process deployment.** Manual creation/deletion, corrections, and live starts/stops now share per-employee time-write coordination. Correction transactions remain intact. Manual creation has durable optional request identities and a startup-created unique index; the Add Entry form reuses the identity after response failure. Retries do not duplicate, overwrite corrected entries, or resurrect deleted entries. Older requests without the new optional field remain accepted.

Verification: **327 backend tests, 64 disposable-MongoDB integration tests, and 98 dashboard tests passed**. Lint, production build, and the Electron manual-entry smoke fixture passed, including a save followed by a failed response and successful retry. See [Phase 3 details and rollout limits](TIME_ENTRY_INTEGRITY_PHASE_3.md). This queue does not support multiple API processes or direct database writers; time writes must pause during deployment handoff. No historical overlaps were changed and nothing was deployed. Phase 4 and later work remains outstanding.

### Phase 2 implementation update — 9 November 2026

**Finding 2 is addressed for all new live starts in the workspace.** The server always initializes the heartbeat at the server start time. Request metadata, supplied timestamps, and web/desktop session labels cannot disable the lease. The existing 20-second heartbeat, 90-second expiry, and 30-second sweep are unchanged. Older request shapes remain accepted; clients must actually send heartbeats to sustain a live timer. Start retries retain their original result without renewing it.

Existing null-heartbeat records are intentionally not rewritten or automatically closed without reliable contact history. Their inventory/reconciliation and testing of the oldest supported installed client are required before deployment. See [Phase 2 behavior and rollout procedure](TIMER_LEASE_PHASE_2.md). No production inventory, migration, deployment, or employee upgrade was performed.

Phase 2 verification: **326 backend tests, 59 disposable-MongoDB integration tests, and 45 desktop selection/retry tests passed**. New real-database coverage verifies omitted/web/desktop metadata, heartbeat renewal, expiry at the exact 90-second boundary, closure at last contact, rejection of late heartbeats, and preservation of legacy null-heartbeat records. Unit coverage also exercises forged timestamps, session labels, and unleased-operation replay. Logs: `artifacts/phase2-backend-tests.log`, `artifacts/phase2-integration.log`, and `artifacts/phase2-desktop-tests.log`. The desktop GUI suite and production installed-client checks were not rerun. Phase 3 and later work remains outstanding.

**Ready for continued development. Updates are needed before a wider production rollout.** The existing architecture and regression coverage provide a useful base; a rewrite is not justified by this review. Authorization and time-record integrity need attention first.

This audit rechecked earlier findings against current source rather than treating historical audit documents as current proof. Two authorization/throttling behaviors were reproduced locally with synthetic requests. Other findings below are source-confirmed behaviors or explicitly identified concurrency risks, not claims of a successful production exploit.

## Findings, in priority order

### 1. High: team creation bypasses the lead-assignment permission

Evidence: [teamRoutes.js](../backend/src/modules/teams/teamRoutes.js), POST handler beginning at line 89; permission check at line 92; lead assignment at lines 160–162. The update route uses `guardTeamLeadChange`, but creation only requires `create_teams` and accepts `teamLead`. `syncEmployeeTeam` can change an existing lead's team and related employee relationships.

An account with team-creation permission but without `assign_team_leads` can therefore initiate an assignment that the update endpoint would reject. This is confirmed from the route and handler; no live team was created.

Update: require the effective lead-assignment permission whenever a new team includes a lead. Keep the form consistent with that rule. Verify a create-only user receives 403 without any team/employee writes, and authorized creation still succeeds.

### 2. High: request metadata can disable timer expiry

Evidence: [taskTimeLogController.js](../backend/src/modules/timers/taskTimeLogController.js), line 301; [desktopTimerLease.js](../backend/src/services/desktopTimerLease.js), lines 33–38; [taskTimeLogRoutes.js](../backend/src/modules/timers/taskTimeLogRoutes.js), timer-start route.

New timers receive a heartbeat timestamp only if the request body says `clientType: "desktop"`. The stale-timer sweep only processes records with a date-valued heartbeat. An otherwise valid authenticated request can omit or change that field and create a timer outside the expiry mechanism. The route does not enforce a desktop-session policy. This can permit elapsed time to accumulate without heartbeats.

Update: make heartbeat expiry a server-enforced rule for new live timers. Define how supported older clients and existing null-heartbeat timers migrate. Verify omitted/altered client metadata cannot disable expiry. Session labels alone do not establish that software is a trusted native client.

### 3. Medium: time-entry writers do not share an overlap lock

Evidence: [manualTimeEntryController.js](../backend/src/modules/timers/manualTimeEntryController.js), conflict read at line 188 and separate create at line 203; [timeEntryEditController.js](../backend/src/modules/timers/timeEntryEditController.js); [documented correction limitations](../CRM_TIME_ENTRY_EDITING.md).

Two concurrent manual submissions can both pass the overlap read before either inserts. Administrative edits serialize against other administrative edits, but legacy manual creation and live timer starts do not participate in the same coordination. This is a source-level concurrency risk; this audit did not reproduce the overlapping-write race against MongoDB. Existing passing integration tests do not establish this missing guarantee.

Update: coordinate all potentially conflicting interval writers per employee, recheck overlaps inside that coordination, and add manual-create idempotency. A transaction containing only a conflict read and insert does not by itself force competing writers to conflict. Acceptance: parallel overlapping submissions yield one accepted interval; retries replay the original result; non-overlapping intervals remain valid. Include manual/create/edit/live-start combinations in real-database tests.

### 4. Medium: revoked attendance permissions still allow role-based access

Evidence: [attendanceRoutes.js](../backend/src/modules/attendance/attendanceRoutes.js), lines 19–20; [authorizeRoles.js](../backend/src/middleware/authorizeRoles.js), `authorizeRolesOrPermissions`.

Local synthetic reproduction: an HR identity with `view_all_reports` revoked was denied by `requirePermission("view_all_reports")` with 403, but allowed by the company-attendance gate because its HR role independently passes. Team leads have an equivalent team-attendance exception. This makes revocation inconsistent with permission-gated time reports.

Update: use effective permissions consistently, or explicitly define and display attendance as a non-revocable role entitlement. Verify revoked users cannot read the corresponding attendance endpoints if revocation is the intended policy.

### 5. Medium: legacy attendance writes compete with timer-derived attendance

Evidence: [attendanceRoutes.js](../backend/src/modules/attendance/attendanceRoutes.js), lines 23–24; [attendanceController.js](../backend/src/modules/attendance/attendanceController.js), check-in creation at line 57 and checkout lookup/save at lines 84–108.

Any authenticated user can call legacy check-in/out endpoints. Check-in can record presence without a timer, and checkout does not restrict its lookup to legacy-owned records. Timer-derived attendance can consequently be modified independently until a later timer event recomputes it. This is source-confirmed; no attendance record was changed during review.

Update: retire/restrict the endpoints with a compatibility plan, or isolate legacy records and prevent these handlers from modifying timer-owned attendance. Test direct endpoint requests and overnight work.

### 6. Medium: login limits do not bound rotating-email traffic

Evidence: [authRoutes.js](../backend/src/modules/auth/authRoutes.js), line 29 and login routes at lines 52–53; [rateLimit.js](../backend/src/middleware/rateLimit.js).

The login budget is keyed by IP plus supplied email. A local middleware probe sent 100 synthetic requests from one IP with different email values: all 100 passed the configured 10-request limiter. No HTTP login requests or password attempts were made. This does not bypass the budget for a fixed IP/email pair, but leaves password spraying across accounts without an aggregate IP budget. Buckets also lack a hard size bound.

Update: add layered IP/account budgets, bound bucket storage, and test shared-office-IP behavior. Use shared enforcement before introducing multiple server instances.

### 7. Medium: logical backups lack a shared recovery point

Evidence: [backupDatabase.js](../backend/scripts/backupDatabase.js), sequential collection reads at lines 32–35.

The script reads collections separately without a common snapshot. Concurrent writes can produce a backup whose related records come from different moments. This is a design limitation, not evidence that an existing backup is corrupt. Production Atlas backup configuration was not inspected.

Update: establish a tested point-in-time backup mechanism or stop writes during logical backups. Restore to an isolated database and validate cross-collection business invariants as well as counts.

### 8. Release hardening: current Windows installer is unsigned

Local Windows `Get-AuthenticodeSignature` reports `NotSigned` for `desktop-app/dist/CRM-2.0.6-Windows-x64.exe`. A signed-build script exists, but that does not sign the current artifact. This affects publisher identity and distribution trust; it does not prevent local development.

Update: configure publisher signing for release builds and verify the final distributed installer. Recheck the artifact after packaging. Installer publication and employee rollout were not performed.

## Verification performed today

| Check | Result |
| --- | --- |
| Backend standard `npm test` | 319 passed |
| Disposable MongoDB integration suite | 57 passed |
| Dashboard unit tests | 98 passed |
| Desktop unit tests | 153 passed |
| Dashboard ESLint | Passed |
| Dashboard route audit | Passed: 47 targets, 69 routes |
| Dashboard production build | Passed; large-chunk warning remains |
| Installer publisher signature | NotSigned |

Total: **627 passing tests** across the four test groups. Logs are in `artifacts/readiness-backend-standard.log`, `readiness-integration.log`, `readiness-dashboard-tests.log`, `readiness-desktop-tests.log`, `readiness-lint.log`, and `readiness-build.log`.

The first backend/build attempts hit sandbox `spawn EPERM` restrictions. Standard backend tests and the build subsequently passed with the required process permissions. A combined backend run with process isolation disabled produced cross-file interference; it is not used as the acceptance result. All 52 backend test files also passed when invoked individually. No test failures remain in the standard backend run.

Limits: the full Electron GUI smoke suite was not rerun; this was not a production penetration test, load test, fresh dependency-advisory scan, deployment verification, or production restore drill. Passing regression tests do not negate the gaps above. Earlier audit claims about dependency counts or production configuration were not reused as fresh verification.

## Development improvements

- Keep the current single-instance deployment restriction until caches, rate limits, write coordination, and background work support multiple instances. `render.yaml` already states this restriction.
- Add CI enforcement for backend/dashboard/desktop tests, disposable database tests, lint, routes, and the dashboard build. No tracked `.github` workflow was found; external CI was not inspected.
- Split the desktop renderer and large dashboard pages gradually by behavior as features change. This is maintainability work, not a release blocker requiring a rewrite.
- Update historical sync documentation: desktop catalog polling is currently 30 seconds while visible, with focus/reconnect refresh and active-timer restrictions; the default dashboard refresh hook is five minutes. The older synchronization audit still describes ten-second polling.
- Consider moving desktop session secrets to OS-protected storage and reducing browser token exposure as a separate authentication hardening project. Current localStorage use alone is not evidence of an exploitable script-injection path.

## Recommended order

1. Fix lead-assignment authorization and server-enforced timer leasing, with regressions and older-client compatibility checks.
2. Fix time-write coordination, attendance access/ownership, and aggregate login throttling.
3. Establish recovery verification, signed distribution, and automated release checks.
4. Continue feature work and gradual module cleanup on this base. Validate the repaired flows in staging with the intended installed desktop version before wider production distribution.
