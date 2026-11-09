# API contracts: desktop app, dashboard and server

The parts of the API that clients rely on beyond "call this URL". Change them only in
backwards-compatible ways: **installed desktop apps update gradually**, so every rule here must
keep working for older versions. All paths start with `/api` (except `/health`). The full endpoint
list is in `CODEBASE_GUIDE.md` (section 6.4); the server code is in `backend/src/modules/`.

## Compatibility rules

1. New request fields are **optional**. A server must accept requests without them, and a client
   must work with a server that ignores them (deploy order is never guaranteed).
2. New response fields are **additions**. Never rename or remove a field an existing client reads.
3. Error responses keep their HTTP status. A new `code` field may be added to explain them.
4. Opt-in behaviour is requested by a query flag (`sync=true`, `checksum=true`); without it the
   server answers the original way.

## Every protected request

| Item | Contract |
|---|---|
| Header | `Authorization: Bearer <token>` (from `/auth/login` or `/auth/quick-login`) |
| Response header | `X-Permissions-Version`: 12-character fingerprint of the caller's effective permissions. It changes when an administrator or manager changes them; the dashboard then reloads `/permissions/me`. Other clients may ignore it. |
| 401 `SESSION_REVOKED` | Session ended (sign-out, another device approved, expired). Clients return to login. |
| 403 `ACCOUNT_INACTIVE` | Account deactivated. Clients return to login with the message. |
| 409 `DEVICE_APPROVAL_REQUIRED` | (login only) Another PC holds the desktop session; wait with `/auth/login-requests/:id/wait`. |

## Timer (desktop)

### `POST /time-logs/start`
Body: `project`, `task`, optional `client`, `note`, `clientType: "desktop"`, **`operationId`** (8–100 chars `A-Z a-z 0-9 _ -`, desktop 2.0.1+).

| Answer | Meaning |
|---|---|
| 201 `{ timeLog }` | Started. |
| 200 `{ replayed: true, timeLog }` | Same `operationId` seen before: the first result (the timer may have been stopped since; check `timeLog.status`). |
| 400/409 `code: "ACTIVE_TIMER_EXISTS"` | Another timer is running; reload it with `GET /time-logs/active`. |
| 409 `code: "OPERATION_ID_REUSED"` | The `operationId` was used for a different project/task/client. |
| 400 | Missing project/task or malformed `operationId`. |

Desktop rule: reuse an `operationId` only to retry the **same selection** after a lost or 5xx response; make a new one after any other answer.

Server lease policy (9 November 2026): every newly created live timer receives a server-generated `desktopHeartbeatAt` equal to `startedAt`. Omitted or altered `clientType`, session client labels, and supplied heartbeat timestamps cannot opt out. Older requests without `clientType` or `operationId` remain accepted. All API clients that start live timers, including web-session callers, must send heartbeats to keep them running; the dashboard does not start live timers. The server does not treat a client label as proof of a native application.

Existing null-heartbeat records are not backfilled or silently closed. An operation replay returns its original record without renewing it. See [Phase 2 rollout](../../docs/TIMER_LEASE_PHASE_2.md) for the required legacy-record review and client checks.

### `POST /time-logs/stop`
Body: optional `idleSeconds` (whole seconds, max 12 h), `logoutReason: "inactivity" | "manual"`, **`operationId`**, **`timeLogId`** (desktop 2.0.1+).

| Answer | Meaning |
|---|---|
| 200 `{ timeLog }` | Stopped. Totals are computed by the server. |
| 200 `{ replayed: true, timeLog }` | Same `operationId` seen before: the first result; nothing changed. |
| 404 | No running timer (already stopped, possibly by the 90 s lease at its last heartbeat). Clients reload their state. |
| 409 `code: "TIMER_CHANGED"` | `timeLogId` names a timer that is no longer running while another one is. Nothing was stopped. |

The stop is a single conditional update: it never overwrites a stop made at the same moment by the lease sweep or another request.

### `POST /time-logs/heartbeat`
Every 20 s while a desktop timer runs. 200 `{ timeLogId }` extends the lease; 404 means the timer is gone (the server closed it at its last heartbeat after 90 s of silence). **The 20 s / 90 s / 30 s timings belong together; change none of them alone.**

## Retired attendance writes

From Phase 4 (9 November 2026), authenticated `POST /attendance/check-in` and `POST /attendance/check-out` return **410** `{ success: false, code: "ATTENDANCE_TIMER_MANAGED", message }`. They do not read or modify attendance or time records. Unauthenticated requests still receive 401. This is a deliberate retirement of the old successful-write contract, not an optional feature flag; clients using those writes must migrate to timer start/stop before rollout. Current dashboard/desktop screens do not call these endpoints.

Attendance reads remain available under their existing permissions. Presence and checkout are derived from time entries, including authorized manual entries/corrections. Historical `source: "check_in"` rows are not rewritten by the retired endpoints. See [Phase 4 rollout](../../docs/ATTENDANCE_CONSISTENCY_PHASE_4.md) for legacy-client and open-row review.

## Manual entry retries

`POST /time-logs/manual` accepts optional `operationId` (8–100 characters, letters/digits/underscore/hyphen). Use one ID per submitted payload and reuse it after response loss or a 5xx failure. The server scopes it to the actor and target employee and stores the normalized original payload hash with the entry.

- First save: 201 with `timeLog`.
- Same request retried: 200 with `replayed: true` and the current saved entry, including later corrections; no insertion or overwrite.
- Same ID with different content: 409 `OPERATION_ID_REUSED`.
- Original entry subsequently deleted: 409 `ENTRY_DELETED`; no resurrection.
- Malformed operation ID: 400. Omitted ID remains accepted for older clients, with overlap protection but without replay identification.

Current permission and target-employee authorization still apply to replay. Manual-create identities remain on soft-deleted/corrected records. The Add Entry modal retains an ID for unchanged retry content while open and generates a new ID when the submitted content changes. Closing/reopening the modal starts a new action.

## Reports: delta sync (dashboard, desktop timesheet)

Query: `sync=true` and, after the first answer, `syncSince`, `syncScope`, `syncReferences` copied from the previous `sync` marker. Dashboard 2026-10+ also sends **`checksum=true`**.

| Response field | Meaning |
|---|---|
| `sync` | Marker for the next request. |
| `delta: true` | Only changed rows in this answer; merge them into the previous copy. |
| `removedIds` | Rows to drop from the copy (deleted manual entries, rows leaving the range or filter). |
| `checksum { count, seconds, activeIds }` | Fingerprint of the **complete** report: row count and sum of `floor(updatedAt / 1000)`, leaving out the active timers listed in `activeIds` (time logs only). If the merged copy gives the same numbers, nothing was missed. |

Without `delta`, the answer is complete and paginated (`page`, `limit` ≤ 100, `totalPages`). The server answers in full when the marker is older than 5 minutes, the scope or referenced names changed, or more than 100 rows changed. Clients fully reload a copy that has not been proven complete for 5 minutes, and at least hourly.

## Catalog lists: clients, projects, tasks

Answers carry `ETag` and `Cache-Control: private, no-cache`. A client that sends `If-None-Match` with the last ETag gets **304** (no body) while the list is unchanged. The ETag changes with any edit to the list or its dependencies and at least every 5 minutes. Browsers and Electron do this automatically when the request is not made with `cache: "no-store"`.

## Long-polls

| Endpoint | Waits up to | Answers |
|---|---|---|
| `GET /auth/login-requests/pending` | 20 s | `{ loginRequest }` when another PC asks to sign in, `{ loginRequest: null }` at the deadline, 401 when this session ends. Browsers never receive requests. |
| `POST /auth/login-requests/:id/wait` | 20 s (or the request's expiry) | The decision for a waiting second PC. |

The server reads MongoDB once per long-poll and again only when something changed on this server (single instance; see `render.yaml`). Clients start the next long-poll after each answer.

## Login throttling

Password and quick login share a 100-attempt IP budget per 15 minutes. Password login also limits normalized email to 20 attempts across IPs and IP/email pairs to 10. Quick login applies the same 20/10 limits per remembered credential and IP/credential pair; supplying an email does not replace the credential identity. The first exhausted budget returns the existing 429 JSON message with `Retry-After` in seconds. Successful attempts also consume budgets; denied attempts do not extend a fixed window. Stores are bounded and new identities can receive 429 when capacity is full. See [Phase 5 details](../../docs/LOGIN_PROTECTION_PHASE_5.md) for expiry, capacity, and the single-process limitation.

## Monitoring

`GET /api/metrics` (admin, alpha, manager), when `METRICS_ENABLED=true`: traffic counters since start and for the current 10-minute window. Counts only; no personal data. See `backend/src/monitoring/trafficMetrics.js`.
