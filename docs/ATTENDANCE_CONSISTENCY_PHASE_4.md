# Phase 4: attendance consistency

Implemented locally on 9 November 2026. No production records were accessed or changed and no deployment was performed.

## Policy and changes

Attendance comes from recorded time-entry activity. Legacy `POST /api/attendance/check-in` and `POST /api/attendance/check-out` are retired. The routes remain authenticated and return HTTP **410** with `success: false`, `code: "ATTENDANCE_TIMER_MANAGED"`, and a message directing callers to the timer workflow. Both handlers perform no attendance/time-log reads or writes. Admin-level callers cannot override retirement.

This removes the alternative write path that could manufacture presence without recorded activity or close a timer-owned day while work was still running. Current dashboard and desktop screens do not use these endpoints. The old successful-write behavior is intentionally discontinued; it is not silently emulated and there is no switch to re-enable it.

The attendance model retains `source: "check_in"` for historical compatibility. This phase does not rewrite historical timestamps, delete old rows, or change attendance read/report permissions. Existing time-entry reconciliation remains authoritative for days with time logs; actual reconciliation can replace a same-day legacy row with timer-derived values, as it already did before this phase. With no time activity, the existing reconciler leaves legacy rows alone.

Running or paused time entries keep the start day open; timer stop or lease expiry produces the checkout. Overnight entries remain assigned to the business date on which the session started. Authorized manual entries, corrections, and deletions continue to reconcile attendance through the existing service. Attendance hours continue to mean first check-in to last checkout; this phase does not redefine them as net worked hours.

## Rollout

1. Identify any integrations or older installed clients still calling the legacy POST endpoints. Update them to use authenticated timer start/heartbeat/stop and handle lease expiry before deploying. Do not assume a release version proves compatibility; test the installed build in staging.
2. In staging, verify legacy calls receive 410 with the documented code, unauthenticated calls receive 401, and starting/stopping work through the supported client still updates attendance. A client must display an actionable error rather than treating 410 as a successful check-in/out.
3. Inventory historical open `check_in` rows in the intended database using the read-only query below. Missing sources are included because older rows may predate the source field. Review their intended historical checkout with the record owner. Do not close them automatically at deployment time or label them as timer-derived without evidence. Any approved historical correction is a separate data operation.
4. Observe attendance reads, current timer starts/stops, overnight work, and lease expiry after rollout. Existing Phase 2 and Phase 3 deployment requirements still apply. No new schema migration or index is needed for Phase 4.

Read-only mongosh inventory (confirm the actual attendance collection name and database):

```javascript
db.attendances.find(
  {
    $or: [{ source: "check_in" }, { source: null }],
    checkIn: { $ne: null },
    checkOut: null
  },
  { _id: 1, employee: 1, date: 1, source: 1, checkIn: 1, checkOut: 1 }
)
```

This checklist was not run against production. Retiring the API does not establish that historical open rows or older integrations have been reconciled.

## Verification

Regression checks cover old request shapes without attendance/time-log access, authentication on both URLs, and retirement for admin callers. Disposable MongoDB coverage verifies no presence is created without activity, legacy requests racing real timer starts/stops cannot change timer-owned rows, historical legacy rows remain untouched by those requests, and overnight paused attendance closes only through time-entry reconciliation on its start day. Existing timer, manual-entry, correction, permission, and attendance-service regressions are included in the backend suite.

Results: **328 backend tests and 67 disposable-MongoDB integration tests passed**; `git diff --check` passed. Logs: `artifacts/phase4-backend-tests.log` and `artifacts/phase4-integration.log`. No frontend code changed, so frontend builds and Electron GUI tests were not rerun for this phase. Production client compatibility and historical-row review remain rollout tasks.
