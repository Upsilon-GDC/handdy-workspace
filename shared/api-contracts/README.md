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

## Monitoring

`GET /api/metrics` (admin, alpha, manager), when `METRICS_ENABLED=true`: traffic counters since start and for the current 10-minute window. Counts only; no personal data. See `backend/src/monitoring/trafficMetrics.js`.
