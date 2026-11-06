# Phase 3 — unchanged catalog caching

Status: implemented locally; production deployment and measured savings pending.

## Changes

- Existing client/project/task list caching is retained. Employee lists, employee selectors, own-team member lists, team lists, project task selectors and per-project desktop activity choices now also use the catalog cache.
- Every response remains `Cache-Control: private, no-cache`: browsers must contact the backend to validate it. Authentication and route-level permission gates execute before the cache.
- Unchanged authorized requests receive a body-less 304. Chromium reuses the already downloaded body and presents the normal JSON response to existing dashboard and desktop code.
- Validators have an hourly fallback rollover instead of a five-minute rollover. This avoids re-downloading unchanged lists at every five-minute dashboard poll. It does not authorize an hour of stale reads: model revisions and caller scope are checked on every validation request.
- Employee and team caches are private to each caller. Cache keys also include role, team, team-lead relationship, effective permissions, query filters and model revisions. Relevant model writes invalidate revision metadata through existing hooks. External database edits have the existing revision-check TTL of up to five seconds.
- Per-project activity choices include the employee's effective team/individual allowed-client IDs in their key. A committed policy change changes that key immediately, including when the allowed list becomes empty. Project, task, assignment, team, employee, client and activity-mapping changes are also dependencies.
- Existing `Vary` values such as `Origin` are preserved when adding `Authorization`.

The bounded server body cache remains at 64 entries / 8 MB, with a one-minute body lifetime. Revision metadata retains its five-second refresh limit. There is no new recurring client polling or external service.

## Behavior preserved

No timer heartbeat, timer lease, attendance, billing, recorded time, five-minute desktop profile/timesheet budget or dashboard refresh interval is changed by Phase 3. A cache failure falls through to the original handler, and failed responses are not stored as successful lists.

This phase does not remove authentication checks or all database reads. Revision checks and session checks still cost requests/commands. It does not cache populated historical report rows; sharing/reducing duplicate dashboard reads is Phase 4.

## Verification

`backend/test/catalogPhase3.test.js` checks validators across five-minute polls, changes to model revisions, caller/filter/permission isolation, immediate allowed-client narrowing, middleware order, error responses and metadata failure fallback.

`npm run test:catalog-cache` in desktop-app runs Chromium against loopback fixtures using the real cache middleware. It verifies body-less server 304 responses become usable cached JSON, edits return new data, narrower client access cannot reuse old choices, caller/filter isolation and revocation-before-cache behavior.

## Rollout and comparison

Deploy the backend. No new desktop installer is required for Phase 3: existing browser/Electron HTTP caches obey the response headers. Phase 2's installer is still required for its separate five-minute desktop download limits.

After deployment, compare matched production windows: list response-body bytes and 304 counts, plus MongoDB sent bytes and commands. Keep employee-hours, active desktop versions and normal workload comparable. More 304s should reduce repeated body downloads, but total Render savings remain unmeasured until this comparison.
