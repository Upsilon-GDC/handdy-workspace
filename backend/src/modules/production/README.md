> Finance navigation is retired. `/admin/billing` redirects to Production Billing
> Management. Billing Management uses the former Finance page layout: date presets,
> summary cards, member totals, project-wise task totals and expandable daily sessions.
> It reads authorized saved Production snapshots, preserving classifications,
> employee/project rates, currency grants and approvals. Legacy Billing APIs remain
> available for existing clients but are not exposed as a separate website section.
> The billing review workbook additionally includes Project summary; Report data
> includes session start/end timestamps. New snapshots record tracked and Break / Idle
> summary metrics; older finalized snapshots are not backfilled or rewritten.
> `npm run test:billing` now runs the consolidated Production billing browser suite.

> Billing review flow: select Team, one employee or All team employees, and dates.
> POST `/billing/prepare-review` prepares at most 100 active home-team employees in
> one transaction. Existing per-employee periods are reused without resetting status.
> Team preparation requires Admin/Alpha or an explicit review grant. Individual
> cross-team preparation remains an optional authorized path. No auto-verification,
> approval, finalization or submission occurs during report preparation.
> POST `/billing/review-report` reads up to 100 same-team/same-date saved periods,
> checks each scope, and returns a signed, redacted report (max 5000 work rows/8MB).
> Excel uses the existing export authorization and snapshot hash. Summary,
> Employee review and Report data sheets include saved amounts, status and issues;
> current rate changes do not silently recalculate saved periods.

> Inline rate editing: Billing rates now includes Edit rates / Add rates controls.
> PATCH `/settings/employee-project-rates/:employee` updates `Employee.projectRates`
> directly, shared with the ordinary employee form. Only Admin/Alpha may call it;
> Alpha targets stay protected. Requests contain team, projectRates and the catalog
> expectedUpdatedAt. Team membership, reference/rate validation and compare-and-set
> guards prevent stale writes. New project choices follow the selected team.
> This replaces earlier notes describing the rates tab as read-only.

> Current billing rate behavior: employee project rates are authoritative. Earlier
> stage notes about editable Production rate scopes or rate corrections describe
> the superseded configuration. The rate API is now read-only history; edit rates
> in Employees, refresh drafts, and preview adjustments for finalized billing.

# Production implementation: Stages 1–4

Stage 1 provides configuration storage and Admin-only APIs. The existing Billing
page and desktop timer behavior remain unchanged.

Stage 2 adds the calculation engine and bounded database loader. Stage 3 connects
that engine to the authenticated report API and dedicated Production screens.
Existing Billing screens retain their previous behavior.

## Storage and history

`production_settings_revisions` stores four setting kinds: `team-billing`,
`classification`, `rate`, and `access`. Related settings share one append-only revision
mechanism rather than duplicating history logic in separate models. A stable key
identifies each setting. Each new revision requires the latest saved version
(`expectedVersion`) and preserves all earlier revisions. Unique indexes and
transactions prevent concurrent changes from overwriting one another.

Effective dates are local calendar dates using `APP_TIMEZONE` (Asia/Kolkata by
default). Normal edits cannot backdate settings. Future revisions do not affect
earlier dates. Same-day corrections use the greatest revision number. A future
revision remains scheduled even if a later edit starts earlier; schedule changes
must be made explicitly by saving another revision for the scheduled date.

`production_audit_events` links the new and previous revisions, actor, reason,
and timestamp. Configuration and its audit event commit or roll back together.
No update/delete endpoint is exposed. Historical billing recalculation and
finalization protection will be implemented in the later billing stage.

Production uses `Employee.projectRates` by exact employee and project ID, the
same source as the existing Billing report. Team currency applies because employee
rates have no currency field. Missing employee/project rates block billing; old
Production client/team rate revisions are retained as history but never used as
fallbacks. Rate POST endpoints return 409 directing users to the employee form.
The Billing rates tab is a read-only team/employee reference with an Employees link.
Employee rates have no effective-date history: live estimates and explicit refreshes
use current rates, including past work. Finalized snapshots remain immutable;
financial corrections require a previewed adjustment. Calculation version is 2.

Classification targets are existing task or activity-mapping IDs, scoped to a
team. Categories are `productive`, `training`, `excluded`, and `break-idle`.
Only `productive` classifications may be marked billable. Classification does
not activate team billing. Legacy work still needs explicit classification in
the calculation stage; task names are never used to infer billing eligibility.

## API

All routes require the existing authenticated session and an actual `admin` or
`alpha` role. Manager inheritance intentionally does not grant settings access.
General role permissions and the existing Billing endpoints are unchanged.

- `GET /api/production/settings/:kind`: paginated settings; optional `team`,
  `asOf`, `page`, and `limit` (maximum 100).
- `GET /api/production/settings/:kind/history?key=...`: paginated revisions.
- `POST /api/production/settings/:kind`: append a validated revision.
- `GET /api/production/settings/audit`: paginated audit events, optionally by team.

Common write fields: `team`, `effectiveFrom` (YYYY-MM-DD), `expectedVersion`
(0 for a new setting), and `reason` (3–500 characters).

Kind-specific fields:

- `team-billing`: `billingEnabled`, `approvalRequired`, `currency` when enabled.
- `classification`: `targetType` (`task` or `activity`), `target`, `category`, `billable`.
- `rate`: optional `client` and `employee`, `enabled`, `hourlyRate`, `currency`.
- `access`: `employee`, `enabled`, `canViewBilling`, optional `canApproveBilling`
  (defaults false); scoped to the selected team. Approval requires financial visibility.

List responses include the applicable `revision` and `latestVersion`. Use
`latestVersion` for a subsequent write even when viewing an earlier `asOf` date.
The default list shows the latest effective-date revision, including scheduled
future settings. Monetary settings are not returned to unauthorized roles.

## Initialization

Run from `backend`. Preview is the default and makes no database writes:

```powershell
node scripts/initializeProduction.js --effective-from YYYY-MM-DD --currency USD
```

The currency is an explicit operator choice; USD above is an example. WCPA is
identified once by exact normalized name, or by an explicit `--team-id` if the
name is ambiguous. Calculation code will use saved IDs, not team-name matching.

After reviewing the preview, append `--apply --actor ADMIN_ID`. Application
creates only the new collections/indexes and missing team settings. It enables
the selected WCPA team and starts other active teams in hours-only mode. Existing
settings are preserved on reruns. The actor must be an active Admin/Alpha.

Initialization is never run automatically at startup. Settings writes fail with
503 if required unique indexes are absent. Newly created teams without a saved
configuration are treated as hours-only by the calculation engine.

No time logs, employees, rates, activity classifications, or historical team
allocations are rewritten by this script. Ambiguous historical allocations will
be reported by the calculation stage, not inferred by initialization.

## Verification

```powershell
node --test --test-isolation=none test/productionSettings.test.js
node --test --test-isolation=none integration/productionSettings.cjs
node --test --test-isolation=none test/productionCalculation.test.js
node --test --test-isolation=none integration/productionCalculation.cjs
```

The integration suite starts an isolated loopback MongoDB replica set and never
loads `.env`. It verifies initialization preview, reruns, history, audit rollback,
simultaneous edits, effective dates, reference validation, pagination, and index
readiness. No live database initialization has been performed during development.

## Stage 2 calculation contract

`services/production/calculationEngine.js` exposes `calculateProduction` as a
pure calculation over existing records. It returns provisional totals, employee,
team and daily summaries, resolved detail intervals, and actionable warnings.
`services/production/calculationService.js` loads bounded inputs on the backend.
It requires an explicit authorized employee-ID list; it never defaults to all
employees. The API layer enforces role/team scope and decides
whether to grant `includeBilling`. This internal option is not a public query
parameter or an authorization mechanism.

The loader uses MongoDB aggregation for bounded log/allocation reads and batched
queries for relationships, targets, attendance and revisions. Interval overlap
resolution runs once on the server, not in the browser. It rejects reports above
1000 employees, 50,000 logs/settings revisions or 100,000 output detail intervals
instead of returning silently truncated totals. The Stage 3 API paginates the
calculated views; export APIs remain part of the later reporting stage.

Hours-only calculations do not fetch project rates or financial settings and omit
financial output. Financial calculations use team configuration effective on the
reporting date and current employee project rates. Currency totals stay separate.
Integer arithmetic preserves precision until currency-specific rounding. Missing
rates produce incomplete estimates, never an assumed zero. Snapshot fingerprints
include rated lines, so changing employee rates invalidates draft estimates even
when offsetting rate changes leave the aggregate unchanged.

The engine sweeps interval boundaries per employee, splitting at local midnight
and unioning overlapping pauses. Break/Idle and other excluded intervals take
precedence over simultaneous work. Duplicate work on the same tuple counts
once. Different simultaneous productive tuples are held as conflicting time;
they are not billed. Live timers are capped at the calculation time, and stale
desktop timers at their last heartbeat. Timestamp intervals are authoritative;
stored worked/paused totals are not added again. Deleted manual entries are
ignored. Unclassified activities stay visible as unclassified tracked time and
are not implicitly productive or billable based on their names.

Work allocation uses the greatest explicit allocation version where available.
Otherwise, a unique team allowed by existing task/project relationships is
reported with a warning that current relationships were used. Ambiguous
relationships remain unallocated and unbilled. This inference is provisional,
not proof of historical team ownership; review/approval and finalization must
require verified allocations in the later billing workflow. The allocation
model references original logs, and initialization creates its index without
creating allocation records. Allocation editing is not exposed yet.

Expected targets retain existing attendance-policy semantics: present employees
need their effective quota, half-day uses the configured fraction, and approved
leave/absence requires zero. Missing policies are flagged. Manager/Alpha target
exclusions remain unchanged. Targets belong once to the employee's current home
team, while work can belong to other teams. Home-team membership is not a
historical roster. Client/project/task filters restrict work, not the employee's
daily quota. Overtime does not cancel another employee/day's shortfall; aggregate
achievement can exceed 100%. A zero denominator has no achievement/utilization
percentage. Team-local target gaps need not sum to company gaps when employees
work across teams, because the home-team quota is not duplicated or prorated.

Approval, finalized snapshots and historical recalculation are not implemented
in Stage 2. All new engine results are explicitly provisional. Existing financial
endpoints, rates, time tracking, attendance and targets are not rewritten.

## Stage 3 screens and report access

The Production sidebar has Overview, Employees, Teams, Clients & projects, Tasks,
and Admin-only Settings. Billing Management and Production Reports are scheduled
for the following stages. Employee/team/client/task drill-downs preserve the
applied period and filters. Details are grouped per employee/day/client/project/
task/category/rate. Work, training, exclusions and pauses remain distinguishable.

`GET /api/production/report` accepts `startDate`, `endDate`, `view` (`overview`,
`employee`, `team`, `client`, `task`, `details`), optional `employee`, `team`,
`client`, `project`, `task`, and bounded `page`/`limit`. Only one paginated view
and its summary are returned, rather than every raw timesheet. `includeChoices=false`
omits repeated filter catalogs on subsequent pages. Labels are joined in batches
on the server. Financial visibility never comes from query-string parameters.
The legacy `/api/billing/production` URL delegates to the scoped report controller;
the normal `/api/billing/report` endpoint is unchanged.

Actual Admin/Alpha accounts have company-wide hours/estimates and configuration
access. Managers see their assigned home/led teams and any explicitly granted
teams; general admin inheritance cannot widen Production access or financial
visibility. Team leads see assigned employees intersected with active led teams
when `view_team_timesheets` is granted. Employee accounts always remain personal.
HR with `view_all_reports` can see company hours; otherwise HR remains personal.
An unassigned manager/lead falls back to personal access, never company access.

Admin-created `access` revisions grant additional team scope to managers/leads
and separate financial visibility to any role. Financial access is per team;
an employee's grant covers only that employee's work. A grant uses today's
effective configuration even for historical reports. Removing a grant therefore
revokes historical visibility as well. Existing `view_billing_amounts` alone
does not grant monetary access in Production. Admin Settings supports billing,
task classification, employee project rate reference, team access and recent audit history.

Work from outside a scoped team's authority is excluded after interval overlap
resolution. This prevents cross-team work from leaking through an employee's
current roster membership, or a task filter restoring time overlapped by a break.
Warnings omit raw log identifiers in public summaries. Full role/API scope,
financial tampering, labels, and pagination are verified by integration tests.

`GET /api/production/settings/catalog` is Admin-only and supports a bounded name
search for settings dropdowns. Run the existing initialization preview/apply
process before saving configuration; Stage 3 does not automatically initialize
or alter a live database. Missing configuration/classifications are surfaced
for review rather than inferred from task names.

Website browser checks: build `dashboard` with `VITE_API_URL=/api`, then run
`electron test/production-smoke.cjs` from `desktop-app` with
`ELECTRON_RUN_AS_NODE` unset. Fixtures use only a temporary loopback web server;
the desktop application's timer source is not modified. The suite covers five
views, drill-downs, filters, pagination, hours-only/financial displays, Admin
settings, employee/HR visibility, errors/retry, and mobile overflow.

## Stage 4 Billing Management

`/admin/production/billing` adds preparation, scoped period lists, saved work
details, team assignment review, approval history and historical adjustments.
Billing Management is separate from the existing Billing report. All mutations
run in a MongoDB transaction together with their audit events. Workflow writes
require initialized unique indexes; the initialization preview now lists the
new storage/index plan. Initialization is still explicit and has not been run
against a live database during development.

New collections:

- `production_billing_batches`: one employee/team/date-range definition, revision,
  status, immutable-after-finalization original snapshot, source fingerprint,
  and optional last adjustment reference.
- `production_billing_events`: append-only actor, reason, state change, revision,
  source fingerprint and unique action request ID.
- `production_billing_claims`: unique employee/team/day claims held by submitted,
  approved and finalized periods. Rejection releases claims. This prevents
  overlapping date ranges from billing the same employee/team/day twice.
- `production_billing_adjustments`: append-only Admin-authorized currency deltas
  and corrected snapshots; the original finalized snapshot is never replaced.

Workflow: Draft → Submitted → Approved → Finalized. Submitted/Approved work can
be rejected; refreshing a Rejected period returns it to Draft. Finalization is
actual Admin/Alpha-only. If every billable interval's effective team setting
does not require approval, Admin may finalize Submitted work directly.

Submission/review/finalization require completed timers, verified allocations,
valid classifications and applicable rates. Future periods and ambiguous or
conflicting work are blocked. Missing rates remain missing, never zero. Only
eligible billable productive intervals appear in billing lines; training and
Break/Idle are excluded. Stopped source timestamps, rate/config/classification
history and explicit allocations are fingerprinted. Changed sources require a
fresh draft and review instead of silently updating a submitted/approved amount.
Snapshot capture, claims, status and audit commits are atomic. Read-only source
queries use the same database session; operations within a transaction are serial.

The employee or an authorized reviewer can prepare/submit the employee's period.
Managers/team leads need an explicit `access` revision with both `canViewBilling`
and `canApproveBilling` for that team to approve/reject or verify allocations.
General admin inheritance and financial read access alone do not grant approval.
Non-admin reviewers cannot approve their own work. HR does not receive approval
authority automatically. Existing employee/team scope checks apply to every
read and mutation. Employees without monetary access can submit work and see
status/history, while amounts, rates, currency fields and adjustment deltas are
redacted on the backend.

Allocation verification writes append-only allocation revisions with actor and
reason and refreshes the estimate. It requires the source fingerprint and current
allocation versions. Reviewers may verify only compatible current team links;
inconsistent/unknown links require Admin review. Private incompatible source
labels are hidden from team reviewers. A log already included in a finalized
snapshot cannot be reassigned through this workflow.

After finalization, normal refresh/status changes are prohibited. Admin can
request a historical adjustment preview. Recording that adjustment requires the
exact preview fingerprint, current batch revision and reason. A stale preview is
rejected. Deltas are calculated automatically per currency against the latest
recorded corrected snapshot (or original snapshot); no conversion or manual
amount entry occurs. The original snapshot/hash stay unchanged; corrections,
actor, reason and source fingerprint are recorded separately. Adjusted totals
come from the latest correction, not from a truncated history list. All audit
events are retained; the UI shows the latest 100 events/adjustments.

Endpoints, all behind the existing authentication middleware:

- `GET /api/production/billing`: scoped pagination, optional employee/team/status.
- `POST /api/production/billing`: employee/team/startDate/endDate/reason/requestId.
  A duplicate definition opens the existing period rather than duplicating it.
- `GET /api/production/billing/:id`: saved snapshot, permitted actions, recent
  audit/adjustments, and authorized adjusted totals.
- `POST /api/production/billing/:id/actions`: action, expectedVersion, reason,
  requestId. Exact retries reuse the recorded result; conflicting IDs/versions
  are rejected. Supported actions: refresh, submit, approve, reject, finalize,
  verify-allocations and recalculate.
- `GET /api/production/billing/:id/recalculation-preview`: Admin-only preview.
  Recording needs `previewHash`. Verification needs `verificationHash` plus
  allocations containing timeLog and expectedVersion.

Per-period source/detail bounds prevent oversized MongoDB documents. Lists omit
full snapshots; selected details paginate locally within the bounded saved
snapshot. New indexes support scope, period uniqueness, recent/status/employee
lists, action retries, daily claims and finalized-log checks.

Verification: `node --test --test-isolation=none integration/productionBilling.cjs`
from `backend`; `npm run test:production-billing` from `desktop-app` after building
the dashboard. The browser suite uses the real controllers/workflow and a temporary
loopback replica set with fixture authentication. It covers personal submission,
manager rejection/resubmission/approval, Admin finalization, adjustment preview,
immutable originals, redaction and mobile. No desktop timer source is changed.

Stage 5 adds the reports and reconciliation described below. Live rollout remains
a separate operation; no production database initialization or deployment has
been performed during development.

## Stage 5 Production Reports and exports

The eighth Production menu entry, Reports, offers daily, weekly, monthly,
employee, team, client/project, task and employee-detail reports. Shared filters
use real database IDs. Weekly/monthly summaries reuse the interval calculation
engine and round amounts after aggregation; they never sum already-rounded daily
estimates. Summary totals match the Production views for the same filters and
calculation time. Work without an applicable configured attendance target remains
visible in production but does not inflate target achievement. All durations
retain second/millisecond precision.

Report source choices are deliberately separate:

- Live production estimates: current interval/classification/rate calculations.
- Saved approved billing: the saved Approved snapshot, pending finalization.
- Original finalized billing: original frozen values, excluding corrections.
- Recorded historical adjustments: recorded correction deltas only.
- Finalized billing after adjustments: each period's latest recorded correction,
  or its original snapshot when no adjustment exists.

Saved sources include only billing periods fully contained in the selected date
range. They are not silently prorated. Their filters use employee/team/period;
client/project/task filters apply only to live production. Company-authorized
historical reports retain frozen records even after an employee record is removed.
Monetary fields are independently redacted per team using current permissions.
Disabled/hours-only teams have no monetary columns in their normal reports.
Currencies have separate columns/totals and no implicit exchange conversion.
Live partial estimates retain their known subtotal and missing-rate warnings.

`GET /api/production/reports` prepares one bounded complete report table plus
summary, readable selections, basis, notes and as-of time. The screen paginates
that table locally (25 rows); downloads include all rows, not just the visible
page. Calculations and grouping run on the server, not from employee timesheets
in the browser. The limit is 5000 rows/8 MB; PDF additionally limits 1000 rows.
Large requests fail explicitly instead of silently truncating data.

`POST /api/production/reports/export-authorization` validates the report token
and requested format against the authenticated user, current employee/team/
financial scope, and `export_reports`. Tokens expire after 15 minutes. A signed
hash and browser hash check bind the normal download flow to the exact table
shown on screen; exporting does not refetch/recalculate the report and introduce
drifting totals. Changed filters require regenerating the report. Revoked access
or expired authorization requires a refreshed report. No server cache stores
report datasets. The existing dashboard ExcelJS/jsPDF libraries create files.

Excel has a Summary sheet (basis, period, as-of, metrics, selections and notes)
and Report data sheet (all table rows). Time cells are numeric Excel durations
with `[h]:mm:ss` formatting, not rounded decimal-hour strings; percentages and
currency values are numeric. Missing Rate and Not applicable remain explicit.
PDF uses readable repeated headers, page numbers and repeated row/identity
columns when wide tables span horizontal sections. Currency codes avoid
ambiguous symbols. Sample PDFs were rendered and visually checked; sample
workbooks were reopened and their exact durations/currency totals checked.
The samples use synthetic local data and are not company billing reports.

Historical configuration correction closes the rate-editing loop:
`POST /api/production/settings/:kind/historical-corrections` is actual
Admin/Alpha-only for rates, classifications and team billing (never access
grants). It requires a longer explanatory reason and records immutable
`historicalCorrection` flags on the setting revision and audit event. It permits
past dates/current dates and existing inactive teams for historical review;
future settings use the normal path. Normal settings still reject backdating.
The UI allows past effective dates directly for team billing, classifications
and rates, automatically uses the historical-correction endpoint, and displays
the correction explanation and ten-character reason requirement. Access grants
still begin today or later. Saved finalized
snapshots stay unchanged; recording a financial difference still requires the
separate previewed Billing Management adjustment. Integration/browser tests use
this actual path rather than manually changing a finalized amount.

The initialization storage preview includes the new collections and indexes,
including a non-unique employee/stoppedAt/startedAt index on the existing time-log
collection. That index is created only on explicit initialization apply when
the collection exists; source time-log documents are not rewritten.

Final local verification commands:

```powershell
# From backend; run each integration file in its own process.
node --test --test-isolation=none test/productionCalculation.test.js test/productionSettings.test.js test/productionBillingRules.test.js test/billingUtils.test.js test/billingController.test.js test/workingHours.test.js
node --test --test-isolation=none integration/productionSettings.cjs
node --test --test-isolation=none integration/productionCalculation.cjs
node --test --test-isolation=none integration/productionBilling.cjs
node --test --test-isolation=none integration/workingHours.cjs

# From dashboard.
npm test
npm run test:routes
npm run build

# From desktop-app, after building dashboard with VITE_API_URL=/api.
npm run test:production
npm run test:production-billing
npm run test:billing
```

Separate integration processes are important: `--test-isolation=none` integration
files each create their own Mongoose connection. Do not combine their hooks in
one process. Tests never use `.env` credentials or the deployed CRM. The expanded
billing browser suite also exercises all-row exports, 7.8-hour targets, hours-only
teams, original/adjusted/delta reconciliation, financial redaction, export
permission revocation, historical rate correction and mobile layout.

## Rollout status and sequence

Local implementation and synthetic verification cover all five stages. No live
initialization, deployment, desktop release or GitHub push has been performed.

1. Review the code and the initialization preview against the intended database.
   Confirm the WCPA team ID, effective date and currency before applying it.
2. Use the existing backup/recovery process before a production schema rollout.
3. Apply initialization with an active Admin actor. Reruns preserve existing
   settings; the preview exposes every new collection/index.
4. Configure explicit task classifications and employee project rates in Employees.
   Production reads those rates directly rather than requiring rates in the new
   client/employee/default priority model.
5. Grant manager/team-lead team, financial and approval access explicitly. Verify
   historical team allocations before submitting billing.
6. Deploy the reviewed backend/dashboard together and verify real role/date/team
   samples before using finalized billing operationally. Existing desktop timer
   behavior and the old Billing report remain separate from this module.

Automated tests validate the requested scenarios: WCPA billing, training/idle
exclusion, hours-only teams, activation/rates, missing rates, billing-disabled
billable tasks, disabling billing, rate changes, cross-team allocation, decimal
targets, leave, overtime, reviewer actions/scope, unauthorized monetary access,
immutable finalized values, report reconciliation and existing attendance/time
tracking regression behavior.

### Daily viewing and team selections

Each Production tab has its own controls, summary cards and table columns:

- Overview: period/team, overall target progress and daily totals.
- Employees: period/team/employee, individual progress and employee drill-down.
- Teams: period/team, team comparison and member drill-down.
- Clients & Projects: period/client/project, productive client work and estimates.
- Tasks: period/task/project, productive, training and Break / Idle activity.
- Employee details: employee/client/project/task, dated work entries.
- Reports: controls and headline totals follow the selected report type. Saved
  billing reports use team/employee and their saved financial totals.
- Billing and Settings keep their dedicated workflow and configuration forms.

Activity classifications load tasks using `taskTeam` on the settings catalog.
Only the selected team's primary/shared tasks and unassigned legacy tasks whose
project belongs to that team are returned. Explicit foreign task assignments
are not broadened by a shared project. Search is combined with this scope
before the catalog limit. Archived tasks remain available for historical
classification through the explicit archive toggle; only active, non-deleted
tasks appear by default. Duplicate names display project and task-code labels
without merging task identities. Changing teams clears the task and hides stale choices until
the new catalog arrives; no existing task assignments are changed.

Billing rates send `rateTeam` to narrow active employees to their home team.
Client choices use the team's enabled client-access policy when configured;
otherwise they use the `client`/`clients` IDs linked to that team's projects.
Shared clients remain available in each related team. Search intersects this
scope, and no links means an empty list rather than company-wide fallback.
Client options default to active records; the explicit `includeInactiveClients`
option restores archived clients for historical rate configuration and previously
configured team rate clients, marked `Previous team rate` when outside current
links. Existing rate keys and client relationships are never changed by the
choice filter. Same-name
records remain separate identities, with inactive labels and record suffixes
when needed. Only repeated IDs are removed from dropdown choices; client
records, time-log references and existing rate keys are never merged. Team
changes clear the client/employee selection before loading the new catalog.
Team access uses the same active home-team employee rule via `accessTeam`;
search remains within that team. Team changes clear the employee immediately,
and stale responses cannot reintroduce the previous team's choices. This
changes selection lists only; existing grants are preserved.

Activity classifications support single-task editing and a `Select multiple
tasks` mode. Multiple mode offers local name/project search, Select all tasks
(or Select all shown while searching), clear selection and a review count.
One category/billing flag/effective date/reason applies to the selected tasks.
Changing teams or the archive toggle clears selection. Break tasks cannot be
classified as productive, billable or training, including through Select all.

`POST /api/production/settings/classification/batch` accepts the shared fields
and `tasks: [{ task, expectedVersion }]`. Its `/historical-corrections` suffix
uses the same past-date/reason rules as single edits. The team-scoped catalog
supplies each task's latest `classificationVersion`. The save checks every
task's current team membership and version, then inserts every revision and
audit in one transaction. A stale task, invalid selection or audit failure
rolls back the whole batch. No time entries or finalized snapshots are changed.
No rules are inferred from task names, and building/testing the UI does not
apply classifications to the configured company database.

Duplicate-task maintenance is separate from deployment. From `backend`,
`node scripts/archiveDuplicateTask.js --keep ID --retire ID` previews one exact
duplicate. `--apply --backup-dir PATH` applies reversible CRM deletion with a
BSON-preserving backup. It requires identical team/project/type/assignments
and behavior, equivalent active mapping coverage, no conflicting classification
history or unique project links, and no live timer on the retired task. Time
entries are never reassigned or deleted. Existing archived rows are not purged.

Preset periods supply dates automatically; Custom dates reveals date inputs.
Filters carried by drill-down links remain visible as removable context labels
when that filter is not a normal control on the destination tab. A selected
team immediately narrows the employee dropdown to authorized employees whose
current home team matches; changing teams clears the previous employee.
Reports and billing selectors use the same roster rule. This is a choice-list
rule, not a change to historical allocation or billing calculations: a team's
production can still include verified work contributed by another home team.
Billing draft preparation offers a separate optional cross-team control for
that case, always bounded by the existing employee access and reviewer rules.
Production settings configure classifications, rates and access; they do not
need to be entered again to view each report.

Team billing also controls Production setup notices. Only teams with billing
enabled on the work date contribute notices, and team/client/project/task
filters restrict the notices as well as the work shown. An unresolved entry's
home team routes its notice only; it does not assign production or billing.
Explicit Break/Lunch tasks do not produce production-allocation notices.
Hours-only reads fetch activation flags with currency and approval fields
excluded. New Billing Management reports offer only billing-enabled teams;
saved billing history remains available under the existing access rules.

An excluded classification can explicitly set `reportOptionalBillable: true`.
Admin work configured this way stays excluded by default. Live Reports offer
`includeOptionalWork=true` to count those intervals as productive and eligible
for billing using employee/project rates, subject to normal team billing and
financial permissions. Training, pauses, Break/Lunch and other excluded tasks
are not enabled by this option. The signed report and its downloads record the
option and its resulting totals. This option does not change dashboard totals,
saved classifications, billing drafts, approved periods or finalized billing;
saved report sources reject the override.
