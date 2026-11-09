# CRM full codebase audit

**Audit date:** 2 November 2026 (Asia/Calcutta)  
**Repository commit:** `0927022f4f258bbe846a940debe97b32c46b7569`  
**Desktop version:** 2.0.1  
**Method:** Current-source review, automated checks, dependency audits, and targeted local middleware probes.  
**Changes made:** This report and audit evidence only; no application fixes were implemented.

## 1. Executive assessment

The application has a substantial working regression suite, and its main builds and tests pass. Existing protections include session revocation, administrator-only account security changes, database indexes for active timers, timer operation IDs, heartbeat expiry, permission-aware dashboard navigation, report reconciliation, soft deletion, and Electron renderer isolation.

Passing tests do not cover every business-rule boundary. The most important remaining findings concern team-lead assignment authorization and client-controlled timer leasing. Manual entries also have a concurrency gap and use client-association rules that differ from live timers. Attendance retains two competing write paths and role exceptions that bypass permission revocation.

**Recommendation:** Address the two high-priority findings first, then manual-entry integrity and attendance consistency. Do not use the older review plan as a current defect list without checking this report's reconciliation section.

This is a repository-wide engineering audit, not a claim that every line or every runtime path was exhaustively verified. Production data, deployed configuration, physical device behavior, and recovery drills were outside the executed checks.

## 2. Scope and coverage

| Area | Review performed | Limits |
|---|---|---|
| Backend authentication | Login/register routes, JWT/session middleware, device approval service, recovery mail, rate limits, account boundaries | No live account attack testing or production SMTP |
| Authorization | Employee, task, team, project, billing, attendance, scheduling, settings and permission route gates; dashboard guards | Targeted negative probes, not an exhaustive role-by-endpoint matrix |
| Time and attendance | Start/stop/heartbeat logic, stale-timer sweep, manual entries, attendance derivation and legacy endpoints | No live MongoDB concurrent-write load test |
| Reporting and billing | Query scoping, date boundaries, client attribution, delta sync, checksums, export loading and existing tests | No reconciliation against real payroll/billing data |
| Dashboard | Authentication/permissions, routes, report/manual-entry helpers, build/lint, Electron-hosted UI smoke scenarios | No complete browser/accessibility audit of every screen |
| Desktop | Main/preload boundary, navigation, lock safety, updater/release configuration, packaging rules and automated lifecycle checks | No clean-machine installer, signing validation or physical multi-monitor exercise |
| Operations | Render blueprint, startup, database setup, health, shutdown, backup/restore scripts, dependency lockfiles | No deployment, database restore, production metrics or query-plan inspection |
| Documentation/shared | Existing audit/guide/plan, API compatibility contract and operational runbooks | Historical claims were not treated as fresh evidence |
| Ancillary files | Repository inventory; `code-city/` identified as a standalone visualization | No dedicated functional audit of that auxiliary tool; generated assets/vendor code excluded from manual line review |

The working tree already contained six modified UI-review artifacts before this audit. They were not reverted. Test scripts can regenerate UI-review artifacts; these files are not application fixes from this audit.

## 3. Verification results

Environment: Windows PowerShell, Node `v24.19.0`, npm `11.17.0`; existing installed dependencies were used. A clean `npm ci` installation was not performed.

| Check | Result |
|---|---|
| Backend `npm test` | **224 passed, 0 failed** |
| Dashboard `npm test` | **60 passed, 0 failed** |
| Dashboard `npm run lint` | Passed; no diagnostics |
| Dashboard `npm run test:routes` | Passed: **41 static navigation targets, 63 registered routes** |
| Dashboard `npm run build` | Passed; bundle-size warning described below |
| Desktop `npm test` | Passed: **119 unit tests**, inactivity Electron smoke, dashboard lifecycle Electron smoke |
| Root `npm audit --json` | 0 known vulnerabilities |
| Backend `npm audit --json` | 0 known vulnerabilities |
| Dashboard `npm audit --json` | 0 known vulnerabilities |
| Desktop `npm audit --json` | 0 known vulnerabilities |

The first sandboxed backend invocation failed to spawn isolated test processes (`EPERM`); that was an execution restriction, not 42 application failures. A diagnostic run with `--test-isolation=none` produced cross-file failures and is not the authoritative backend result: tests use mocks/module state and the configured script expects isolation. The normal isolated suite subsequently passed with process access. The initial dashboard build also encountered `EPERM`; its normal rerun passed.

The Electron smoke tests use controlled/mock API responses. They demonstrate UI/lifecycle behavior but do not establish real-database integrity or production availability. They cover current 30-second polling, permission-driven actions, reports/exports, session restoration, device approval/revocation, large selectors and independent web sign-out, plus idle/Continue/logout/break behavior.

Evidence saved locally:

- [Backend isolated test log](artifacts/audit-backend-isolated-2026-11-02.log)
- [Full desktop test/build/smoke log](artifacts/audit-desktop-full-2026-11-02.log)
- Dependency audit JSON: [root](artifacts/audit-dependencies-root-2026-11-02.json), [backend](artifacts/audit-dependencies-backend-2026-11-02.json), [dashboard](artifacts/audit-dependencies-dashboard-2026-11-02.json), [desktop](artifacts/audit-dependencies-desktop-app-2026-11-02.json)

Logs are ignored by Git and must be attached separately if this report is shared. Zero npm advisories describes the registry response for these lockfiles at audit time; it does not certify application security.

## 4. Prioritized findings

**Evidence labels:** “Reproduced gate behavior” means local middleware was executed with synthetic users, without a database. “Source-confirmed” means the current code establishes the behavior, but the complete HTTP/database scenario was not executed. “Concurrency risk” means a race follows from the write design and still needs a real-database reproduction.

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| AUD-01 | High | Creating a team bypasses the separate team-lead assignment permission | Source-confirmed; route/gate inspected locally |
| AUD-02 | High | Timer leasing depends on an optional client-controlled body field | Source-confirmed |
| AUD-03 | Medium | Concurrent manual entries can pass the same overlap check | Concurrency risk |
| AUD-04 | Medium | Manual entries cannot use the same client choices as live timers | Source-confirmed |
| AUD-05 | Medium | Legacy attendance endpoints can create/modify attendance independently of timers | Source-confirmed |
| AUD-06 | Medium | Attendance role exceptions bypass revoked reporting permissions | Reproduced gate behavior |
| AUD-07 | Medium | Login throttling has no aggregate IP/account budget | Reproduced limiter behavior |
| AUD-08 | Medium | Logical backups do not capture a consistent database-wide point in time | Source-confirmed design limitation |
| AUD-09 | Low | Historical review plan describes already-resolved issues as work to implement | Source/documentation comparison |

### AUD-01 — Team creation bypasses lead-assignment authorization

**Evidence:** [teamRoutes.js](backend/src/modules/teams/teamRoutes.js#L87), lines 87–164. `POST /api/teams` requires `create_teams` but accepts `teamLead` and calls `syncEmployeeTeam`. In contrast, update uses `guardTeamLeadChange` at lines 203–204. The [assignment service](backend/src/services/teamAssignmentService.js#L37) can remove a lead from another team and update member relationships.

**Impact:** A user allowed to create teams, including default HR, can assign or move an existing lead without `assign_team_leads`. This affects another team's reporting and task scope. A local route inspection confirmed only authentication, the create permission gate, and the handler on POST; default HR does not have `assign_team_leads`.

**Reproduction:** Use an account with `create_teams`, without `assign_team_leads`, and POST a new team with an existing active lead ID. The handler validates the lead's role/activity, but never checks the assignment permission. No live mutation was made during this audit.

**Fix:** Require `assign_team_leads` whenever creation specifies a lead. Make the Add Team selector follow the same authorization; keep API enforcement authoritative. Clarify whether creation should also require `edit_teams`, since the current permission description says assignment requires it.

**Acceptance:** A create-only account receives 403 and causes no team/employee changes when specifying a lead. Permitted creation succeeds. Tests cover moving a lead already assigned elsewhere.

### AUD-02 — Clients can opt out of heartbeat expiry

**Evidence:** [taskTimeLogController.js](backend/src/modules/timers/taskTimeLogController.js#L322), line 322 sets `desktopHeartbeatAt` only when `req.body.clientType === "desktop"`. [desktopTimerLease.js](backend/src/services/desktopTimerLease.js#L33), lines 33–38 sweeps only records whose heartbeat is a date. Timer routes require authentication but do not restrict start to a desktop session. Authentication already attaches `req.authSession` in [authMiddleware.js](backend/src/middleware/authMiddleware.js#L98).

**Impact:** An authenticated caller can omit the field or send `web`, creating a timer outside the stale-desktop sweep. It can remain active without heartbeats and later accumulate elapsed time on stop. This undermines the guide's desktop-only/server-lease policy; it does not require a forged JWT.

**Reproduction:** POST an otherwise valid start with an authenticated session and no `clientType`; inspect the created null heartbeat. Advance beyond the lease timeout and run the sweep: its date filter excludes that record. This sequence was established from source, not run against a live database.

**Fix:** Apply leasing as server policy for new timer starts; do not let request metadata disable it. If desktop-only operation is required, check the server session too, while recognizing that login client labels alone do not prove a trusted native device. Plan compatibility for older installed clients and existing null-heartbeat records rather than changing them blindly.

**Acceptance:** Omitting or changing the field cannot disable the lease; web sessions follow the explicit product policy; older-client behavior has documented migration/regression coverage.

### AUD-03 — Manual-entry overlap checks are not atomic

**Evidence:** [manualTimeEntryController.js](backend/src/modules/timers/manualTimeEntryController.js#L190), lines 190–205 performs a conflict read followed by a separate create. [TaskTimeLog.js](backend/src/models/TaskTimeLog.js) enforces active-timer/start-operation uniqueness but has no interval-exclusion guarantee for stopped manual records.

**Impact:** Two overlapping manual submissions can both see no conflict and both insert. A lost response followed by a retry can also create ambiguity because manual creation has no operation ID. Overlapping accepted records can inflate reports/billing. Running one server does not prevent asynchronous requests from interleaving.

**Validation limit:** Existing manual-entry tests mock a sequential conflict/no-conflict response; this audit did not run a real MongoDB race.

**Fix:** Serialize conflicting writes per employee in the current single-instance design, covering other time writes that can overlap, or use a database coordination design that makes concurrent contenders conflict. A transaction around only the existing read/insert is not sufficient unless the writers share a conflicting write/lock. Add idempotency for manual submissions.

**Acceptance:** Parallel overlapping POSTs produce one success and a conflict/replay; non-overlapping entries remain valid. Test against MongoDB with a synchronized race, including response-loss retries and timer start/stop overlap.

### AUD-04 — Live and manual time use different client rules

**Evidence:** [projectController.js](backend/src/modules/projects/projectController.js#L71), lines 71–82 intentionally allows projects with no linked clients. Live start accepts any active client at [taskTimeLogController.js](backend/src/modules/timers/taskTimeLogController.js#L242). Manual options only load linked clients at [manualTimeEntryController.js](backend/src/modules/timers/manualTimeEntryController.js#L133), and manual creation rejects an unlinked client at lines 181–185. The dashboard filters projects using these client IDs in [manualEntry.js](dashboard/src/utils/manualEntry.js#L37).

**Impact:** A valid live session against an unlinked project/client combination cannot be recreated with the same client through manual entry. Omitting the optional client can still save the hours, but loses explicit client attribution. The issue is inaccurate correction/client reporting, not a complete inability to add manual hours.

**Reproduction:** Create an active project with a linked eligible work task and no client associations. Use an active client in a live start. Try the same project/task/client in manual creation: client membership is rejected, and the manual picker cannot offer that client for the project.

**Fix:** Choose one client policy and share its resolver across live and manual paths. Based on current project-creation comments, allow active client selection for unlinked projects while preserving intentional restrictions for linked legacy projects if required.

**Acceptance:** Equivalent live/manual records support identical valid client choices and agree in client timesheets and billing exports.

### AUD-05 — Legacy attendance writes compete with automatic attendance

**Evidence:** [attendanceRoutes.js](backend/src/modules/attendance/attendanceRoutes.js#L23), lines 23–25 exposes personal check-in/out to every authenticated user. [attendanceController.js](backend/src/modules/attendance/attendanceController.js#L26) creates check-ins without timer activity; checkout at lines 80–108 selects any open attendance row without a source restriction. [attendanceService.js](backend/src/services/attendanceService.js#L46) independently recomputes the same employee/day from timer logs.

**Impact:** A user can register presence without starting work, or check out a `source: timer` row while its timer is still active. A later timer event may repair the row, leaving an inconsistent interim report. These endpoints remain reachable even though current screens do not call them.

**Fix:** Set an explicit legacy policy: retire or restrict check-in/out with an older-client migration, or isolate legacy rows and prevent checkout from modifying timer-owned attendance. Keep one authoritative attendance workflow.

**Acceptance:** Direct legacy requests cannot manufacture timer-derived attendance or close it while a timer runs. Regression tests cover old clients, overnight sessions and coexistence of legacy data.

### AUD-06 — Revoking report permissions does not revoke attendance access

**Evidence:** [attendanceRoutes.js](backend/src/modules/attendance/attendanceRoutes.js#L17), lines 17–20 explicitly allows HR for company attendance and team leads for team attendance regardless of permissions. The [catalog](backend/src/utils/permissions.js) says these permissions cover attendance, and time-log reporting uses permission gates.

**Local reproduction:** An HR user with `permissionOverrides.revoked: ["view_all_reports"]` was rejected by `requirePermission("view_all_reports")` with 403, but passed the exact role-or-permission gate used for company attendance. The same structure applies to team leads and `view_team_timesheets`.

**Impact:** Administrators can believe reporting access was removed while those users can still call attendance endpoints directly. This is a scope/privacy mismatch; it does not grant access to unauthenticated users.

**Fix:** Use effective permission gates for attendance if the catalog defines the intended policy. If always-on role access is intentional, describe it explicitly in the permissions UI and documentation.

**Acceptance:** A revoked grant has consistent effects across attendance, time logs, routes and menus, or the deliberate exception is clearly documented and tested.

### AUD-07 — Login limiting can be avoided by varying email

**Evidence:** [authRoutes.js](backend/src/modules/auth/authRoutes.js#L25), lines 25–29 keys the limiter by IP plus supplied email. [rateLimit.js](backend/src/middleware/rateLimit.js#L3), lines 3–10 creates an independent bucket per key and route. There is no second aggregate limiter on login/quick-login.

**Local reproduction:** 100 synthetic requests from one IP with 100 different email values all passed a limiter configured with the current key scheme and maximum 10. This probe did not send real login requests. It does not show bypassing the 10-attempt budget for one fixed IP/email pair.

**Impact:** Password spraying across accounts and arbitrary bucket creation are not bounded by an IP-wide budget. Distributed attempts against one account also receive separate IP buckets. The in-memory map is periodically cleaned, but is not size-bounded.

**Fix:** Layer aggregate IP and account controls with the existing pair limit; bound bucket memory. Retain the single-instance restriction until shared rate limiting exists.

**Acceptance:** Rotating emails cannot bypass an IP-wide threshold; varying IPs cannot give unlimited attempts on one account; legitimate retry and shared-office-IP behavior are tested.

### AUD-08 — Backup counts do not establish a consistent recovery point

**Evidence:** [backupDatabase.js](backend/scripts/backupDatabase.js#L27), lines 27–38 copies collections sequentially using ordinary `find({})` cursors, without a common snapshot. [restoreDatabase.js](backend/scripts/restoreDatabase.js) verifies counts and recreates indexes but does not validate cross-collection business invariants.

**Impact:** Writes during backup can leave related records from different moments, such as timer activity and derived attendance. Matching restored counts does not prove that reporting/account relationships are consistent. This is a limitation of the current logical backup design; no backup corruption was observed.

**Fix:** Use an appropriate point-in-time backup mechanism or explicitly quiesce writes during logical backup. Document its consistency/recovery guarantees. Add restore validation for references, active-timer uniqueness, attendance reconciliation and representative report totals.

**Acceptance:** A documented restore drill confirms both counts and application invariants for a backup taken under the expected operating conditions.

### AUD-09 — The old plan is stale

**Evidence:** [CRM_CODEBASE_REVIEW_AND_FIX_PLAN.md](CRM_CODEBASE_REVIEW_AND_FIX_PLAN.md#L3) identifies version 1.2.30 and explicitly says its findings were documentation-only. Current desktop is 2.0.1 and current source/tests contradict several open items in that file.

**Impact:** Implementing it verbatim would duplicate completed work or alter deliberate product decisions.

**Fix/acceptance:** Mark the historical plan as superseded for current defect status, retain its history, and use source-verified findings and current tests for new work. The old file was preserved during this audit.

## 5. Other risks and improvement opportunities

These items are not additional demonstrated high-severity bugs.

| Area | Current evidence and practical implication | Follow-up |
|---|---|---|
| Attendance repair | `recordAttendanceActivity` logs failures and returns null; a later event repairs only that employee/day. A failed final stop update can remain stale without another event for that day. A backfill script exists. | Add durable retry/reconciliation and an alert; test attendance failure after a successful final timer stop. |
| Cross-document team updates | `syncEmployeeTeam` changes teams/employees through several writes without a transaction. | Inject write failures and concurrent lead moves; establish atomicity or reliable reconciliation. |
| Browser/native credentials | Both clients store bearer and remembered-session tokens in localStorage. Production CSP and Electron isolation mitigate some exposure, but do not make tokens inaccessible to compromised renderer code. No XSS exploit was established. | Review persistent-token storage and lifetime against the actual threat model; keep recovery/revocation tests. |
| Mass assignment | Project, schedule and shift update paths pass broad body objects into model updates. Schemas constrain fields but do not express a controller-level editable-field policy. | Allowlist editable fields; test that authorship/deletion metadata cannot be altered unintentionally. No privilege escalation through this was demonstrated. |
| Bundle size | Build reports main JS **536.28 kB** and ExcelJS **929.38 kB** minified; CSS **207.32 kB**. Excel/PDF libraries are dynamically imported already. | Profile initial screen loading and export startup before further splitting. This warning does not mean the build failed. |
| Scale/availability | `render.yaml` pins one instance because coordination and caches are local memory. | Preserve this limit. Before scaling, replace coordination with shared mechanisms and run concurrent multi-instance tests. |
| CI/runtime reproducibility | No tracked `.github` workflow was present; local scripts are the verified quality gate. Render blueprint does not explicitly pin a Node runtime. | Add a repeatable CI gate and explicit supported Node version; test clean installs. An external CI service may exist but was not inspected. |
| Scheduling | Schedule relations check that team/employee/shift exist, but not whether the employee belongs to the selected team. | Confirm whether cross-team scheduling is allowed; add relation tests if it is prohibited. |
| Large reports | Billing loads matching logs into memory; several catalog endpoints return complete lists. No production load profile was obtained. | Measure realistic date ranges, query plans, memory and p95 latency; add limits or streaming where justified. |
| Installer/release | Publishing script requires signing and draft releases; general build commands can still produce unsigned local installers. | Verify the actual distributed artifact's signature and installed upgrade/rollback behavior. Do not infer release assurance from unit tests. |

## 6. Reconciliation with the earlier review plan

| Earlier item | Current assessment |
|---|---|
| CRM-01: dashboard ignores configurable permissions | Broadly addressed: AuthProvider loads effective grants, tracks permission fingerprints, navigation/actions/guards use grants, smoke scenarios pass. Specific attendance exception remains AUD-06. |
| CRM-02: catalog entries have `enforcement: none` | Still present, but explicitly described as unused/informational in the catalog. Do not claim those toggles enforce access. |
| CRM-03: no automatic attendance creation | Outdated: timer activity now derives attendance in `attendanceService`; remaining coexistence concern is AUD-05. |
| CRM-04: smoke expects 10-second polling | Outdated: full lifecycle smoke passed with current 30-second polling. |
| CRM-05: task creation needs `assign_tasks` | Outdated: create permission supports team-wide tasks; selecting particular employees uses `reassign_tasks`. |
| CRM-06: HR cannot add manual entries | Outdated: current scope explicitly allows HR to act company-wide, with route permission enforcement. |
| CRM-07: shifts/schedules missing from sidebar | Still absent deliberately; current navigation tests explicitly assert exclusion. Treat visibility as a product choice. |
| CRM-08: SMTP missing from Render blueprint | Outdated as a source claim: SMTP keys are declared with `sync: false`. Actual deployed values/delivery were not verified. |
| CRM-09: single-instance assumptions | Still relevant and explicitly documented/pinned. No unsupported scale-out was observed. |
| CRM-10: unused components | Not established as a current defect by this audit; require a reference/import analysis before deletion. |
| CRM-11: legacy project service type | Compatibility concern, not an established bug. Preserve historical billing/report behavior. |
| CRM-12: desktop packaging files | Still a release consideration; current unit suite includes packaging-file checks and passes. Installed artifact remains unverified. |

## 7. Remediation order and verification requirements

1. **Authorization/time integrity:** Fix AUD-01 and AUD-02 with denied-request tests and backwards-compatible timer rollout. Review existing unleased timers before changing them.
2. **Manual corrections:** Resolve AUD-03 and AUD-04 together. Add real-database concurrency tests and compare client attribution across live/manual reports and exports.
3. **Attendance:** Resolve AUD-05 and AUD-06, then add reliable repair for failed attendance derivation. Include overnight and legacy-client scenarios.
4. **Abuse/recovery:** Layer login budgets (AUD-07); establish consistent backup/restore guarantees and drill them (AUD-08).
5. **Delivery/maintenance:** Reconcile documentation, automate checks, pin runtime, then optimize measured bundle/report bottlenecks.

For changes involving MongoDB indexes or data, back up first, inspect existing duplicates, validate on a separate database and document rollback. Do not remove historical time logs or silently change HR, manager, attendance or billing policy.

Required local regression commands after fixes:

```powershell
npm --prefix backend test
npm --prefix dashboard test
npm --prefix dashboard run lint
npm --prefix dashboard run test:routes
npm --prefix dashboard run build
npm --prefix desktop-app test
```

Add narrowly targeted tests for each fix. Run MongoDB integration tests for interval races and cross-document consistency; mocked tests alone cannot establish those properties.

## 8. Production checks still outstanding

- Verify real Render environment values, HTTPS/security headers, CORS, health behavior, runtime version and deployed commit.
- Deliver a real password-reset email and complete its expiry/reuse/revocation flow.
- Inspect production indexes and historical duplicates without changing live records during discovery.
- Reconcile a representative employee/date period across raw time logs, attendance, dashboard, billing, Excel and PDF, including manual entries and overnight work.
- Perform a backup/restore drill into a separate database and record both counts and business-invariant checks.
- Exercise clean-machine installation, actual code signature, old-version upgrade, offline behavior, sleep/resume and physical multi-monitor lock recovery.
- Measure actual query plans, p95 latency, memory and traffic under realistic concurrent use.

**Final audit status:** Automated baseline passes. Nine prioritized findings/design gaps are documented with evidence and fix criteria. Application code and production systems were not changed.
