# Phase 4 — shared dashboard reads

Status: implemented and tested locally. Deploy the backend and dashboard to apply it in production. No desktop installer is required for this phase.

## Shared data and request counts

The Admin/Alpha/Manager Overview asks the existing productivity endpoint for `includeRoster=true`. Its existing employee query is reused for both productive-hours calculations and the activity roster. A single minimal team-definition query supplies both the populated employee team names and the activity team list. Employee private contact/rate/account fields are not added to this response; Alpha remains excluded.

The page has one automatic five-minute refresh coordinator. Initial overlapping productivity consumers share one in-flight HTTP request. Settled results are not retained in a new client cache; subsequent manual refreshes fetch again. Keys include the session and date, and results arriving after a session change are rejected.

Typical unpaginated data-request counts per normal refresh, excluding authentication/security requests:

| Activity range | Before | After |
|---|---:|---:|
| Today | 4 (employees, teams, activity, productivity) | 2 (activity, productivity with roster) |
| Week/month including today | 5 (employees, teams, period, today, productivity) | 2 (period, productivity with roster) |
| Historical range excluding today | 5 | 3 (period, today, productivity with roster) |

Pagination may require additional report requests. Existing report delta/checksum behavior remains in use; period reports are not replaced with a new full-download-only endpoint.

The activity calculation needs only active records for current status. When a selected period includes today, that period already includes those records, so the same report is reused. Historical-only periods still fetch today's report to avoid presenting historical timers as current status.

## Compatibility and failure handling

`GET /api/working-hours/overview?date=YYYY-MM-DD&includeRoster=true` adds a minimal `roster: { employees, teams }` only for an unfiltered company request. Existing responses without the flag remain compatible. A team-filtered request does not return a roster that could be mistaken for the company roster.

The existing authorized Admin/Alpha/Manager and `view_all_reports` guards remain in place. Roles without productive-hours access retain their original authorized catalog endpoints. Older servers without the roster envelope and failed productivity reads fall back to those catalog endpoints, rather than losing activity totals. Productivity requests have a ten-second client timeout and retain their last successful data on failure. Other HTTP/timer timeouts are unchanged.

The productive-hours calculation stays on the server. It still uses actual attendance, effective policies, clipped work intervals, pause/break exclusions and overlapping-interval rules. Activity totals and productivity totals remain distinct. Their log queries remain separate: this phase does not claim that all repeated database work has been removed.

## Validation

- `dashboard/test/overviewData.test.js`: shared roster, today/week reuse, historical live status, legacy/outage fallback, empty rosters, request failure, in-flight sharing, session/date isolation and fresh manual reads.
- `backend/integration/workingHours.cjs`: one employee read and one team read for shared context, unchanged totals, minimal fields, Alpha exclusion and filtered-request safeguards, alongside existing working-hours integration coverage.
- Electron Overview and working-hours smoke tests: actual request counts, fallback behavior, team/member filters, drilldown, historical/current separation, stale-result recovery and mobile layout.

## Production measurement

Compare matching post-deployment `[metrics]` windows and employee-hours. Expect fewer Overview `/employees/options`, `/teams`, duplicate `/time-logs/admin` calls, and corresponding roster reads. Do not interpret the request-count ratios above as the percentage reduction in total CRM bandwidth; active timers, database communication, manual actions and other pages still contribute.
