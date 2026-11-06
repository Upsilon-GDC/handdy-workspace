# Employee working hours and team productivity

Admins and Alpha can open **System → Working Hours Settings** at
`/admin/working-hours`. Managers can view productivity in Overview, but cannot
read or update configuration. Other roles cannot use these APIs, even when
they hold delegated company report permissions.

Select employees individually or in bulk, enter decimal daily hours, choose
an effective date and save. `7.8` means 7 hours 48 minutes. Values from 0 to 24
hours with at most two decimal places are stored as integer seconds, so a
hundredth of an hour is exactly 36 seconds. Set a half-day percentage per
employee (default form value 50%). Requirements are grouped by current team;
inactive staff remain visible and Alpha accounts are excluded, matching Overview.

Start by choosing a team card. Only that team's employees appear. **Whole team**
selects all its employees, including members hidden by search. **Choose employees**
clears the selection so individuals can be selected instead. Changing teams clears
the previous selection. Saving applies only to the explicitly selected employees.

The compact editor stays above the employee list, with **Working hours** and
**Daily exception** tabs. Long rosters scroll within their own area. Editing a
row loads its values into the top editor without jumping down the page; selection
counts and save controls remain easy to reach on laptop and mobile layouts.

No employee is assigned a quota automatically. The initial form value of 8
hours is saved only when the Admin submits it. Unconfigured present employees
are counted as present and their tracked work appears in details; they are
excluded from required/completed totals until configured, with a visible warning.

## Attendance and daily exceptions

The existing `Attendance` record's `Present` status establishes presence. An
Admin can record an approved leave, absent or half-day exception for a selected
date, with a reason. These exceptions apply only to productivity; they do not
change existing check-in/out records or the timer-derived attendance status.
They are not a new leave-request or approval workflow. Record an exception here
after it has been approved through the business's existing process.

Leave and absent exceptions exclude the employee's requirement and completed
time from summary totals. A half day uses the configured fraction, rounded to
the nearest whole second, and requires an actual Present attendance record.
Marking a half day never creates presence. Clear exception restores ordinary
attendance treatment. The history of these changes remains on the Attendance
record and survives automatic attendance reconciliation.

## Daily calculations

**Team Working Hours Overview** is a separate daily section of the existing
Admin/Manager Overview. Its date and team filters are independent of the existing
activity range. Team cards open employee requirements, tracked work, pending
hours, progress and overtime. Data refreshes every 5 minutes and on window
focus/reconnection. A failed refresh retains the last successful result with
an error message. Teams use current employee membership.

Only productive work intervals within the selected company day are counted.
Break tasks, all pause intervals, idle gaps and deleted manual entries are
excluded. Overlapping and duplicate work intervals are merged. An expired
desktop lease is clipped to the last confirmed heartbeat without modifying
the timer. Running timers contribute up to the report's `asOf` time.
The backend uses `APP_TIMEZONE` (default `Asia/Kolkata`); configure the dashboard
with the matching `VITE_APP_TIMEZONE` when changing it.

Pending = max(required − completed, 0). Completion is capped at 100%.
Employee overtime is shown separately and preserved in actual tracked work.
Team pending follows the requested aggregate formula, so one employee's
overtime can offset another employee's shortfall in the team total. Details
also show the sum of individual pending hours so that distinction is visible.
Task completion status, billing calculations and existing reports are untouched.

## History, database rollout and API

The new `WorkingHoursPolicy` model stores one employee document with a version
and append-only effective-dated revisions, including the Admin and save time.
The latest applicable revision determines a date's quota. Same-effective-date
edits retain the old revision; scheduled future revisions remain scheduled.
Settings may take effect today or later. Retroactive changes are rejected, so
changing a quota cannot rewrite earlier reports. Historical dates before initial
configuration show Not configured; no past quotas are inferred or backfilled.
Attendance/time corrections can still change historical actuals intentionally.

Deployment is additive: backend startup creates the policy collection and its
unique employee index using `ensureWorkingHoursIndexes`. Existing Attendance
documents need no backfill; their new adjustment history field is optional.
Deploy both backend and dashboard. No desktop installer update is needed for
this web feature. No production data migration or production writes were run.

Authenticated endpoints:

- `GET /api/working-hours/settings?date=YYYY-MM-DD`: Admin/Alpha roster,
  effective policies, revisions, concurrency versions and daily exceptions.
- `PUT /api/working-hours/settings`: Admin/Alpha only, with `employeeIds`,
  `requiredHours`, `effectiveFrom`, `halfDayPercent`, and
  `versions: [{employee, version}]`. Up to 500 employees save atomically.
  Stale versions reject the whole batch with 409.
- `PUT /api/working-hours/adjustments`: Admin/Alpha only, with `employeeIds`,
  `date`, `type` (`normal`, `half_day`, `leave`, `absent`) and `reason`.
- `GET /api/working-hours/overview?date=YYYY-MM-DD&team=ID`: Admin/Alpha/Manager
  with `view_all_reports`; optional team filter also accepts `unassigned`.

Managers normally inherit Admin access elsewhere in CRM. These configuration
routes deliberately use an exact Admin/Alpha check instead of that shared
inheritance rule.

## Verification

Backend calculation and access tests: `node --test test/workingHours.test.js`.
Database/transaction tests: `node --test integration/workingHours.cjs`; these use
an isolated loopback MongoDB replica set, never a configured external database.
Dashboard: `npm run lint`, `npm test`, `npm run build`.
After building the dashboard, run `npm run test:working-hours` in `desktop-app`
for grouped settings, bulk/individual updates, decimal input, refresh persistence,
failed-save selection, daily exceptions, drilldown, date/team filters, outage
states, mobile layout and Manager read-only access. The UI uses mock APIs.
