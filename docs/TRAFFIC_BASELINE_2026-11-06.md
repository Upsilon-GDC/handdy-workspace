# Phase 1 — preliminary production traffic baseline

Status: one production window analysed; steady-state confirmation pending. No Phase 2–5 optimizations were applied as part of this measurement.

## Evidence and scope

Source: user-provided Render application-log screenshot, 6 November 2026. The service reports metrics enabled at 14:58:48 and its first JSON summary at 15:08:48 in the displayed log timezone. The summary says `windowMinutes: 10` and `startedAt: 2026-11-06T09:28:37.308Z`. This is the first window immediately following deployment, so it includes startup effects. It is not a full working day.

The user reports 20 employees total. Concurrent active/signed-in employees and actual employee-hours during this window are unknown; no per-employee normalization or daily/monthly extrapolation is justified yet.

The values below were read from the screenshot, not imported as a full raw log into the offline analyser. Full exported JSON is preferred for exact ranking and aggregation.

## Visible API measurements

| Route | Requests in this window | Reported response body bytes |
|---|---:|---:|
| GET /api/time-logs/history | 219 | 176,276 |
| GET /api/auth/me | 211 | 131,998 |
| GET /api/projects/:id/activity-options | 17 | 23,192 |
| POST /api/time-logs/heartbeat | 272 | 14,960 |
| GET /api/settings/idle-policy | 96 | 11,904 |
| GET /api/auth/login-requests/pending | 283 | 10,388 |

History and profile account for 430 requests and approximately 0.308 MB of reported response bodies in this sample. They are the largest two response-body contributors visible in the entry. Heartbeats have many requests but much smaller responses; frequency alone is not a reason to change the timer lease.

Device-approval monitoring uses held long-poll requests. A roughly 20-second duration is expected from the current implementation, and must not be treated as a timeout or slow database operation on that evidence alone.

## Visible destination counters

| Destination | Connections opened | Sent bytes | Received bytes |
|---|---:|---:|---:|
| mongodb-atlas | 16 | 1,462,786 | 2,233,793 |
| http-clients | 751 | 1,413,269 | 1,459,885 |
| smtp smtp.gmail.com | 1 | 1,912 | 5,169 |

The MongoDB destination is the dominant external destination visible in this sample; SMTP is small. Sent and received bytes must remain separate. Inbound MongoDB replies are not added to Render outbound usage. HTTP-client socket bytes include more than the compressed route bodies, including response headers; top-N route reporting also limits direct reconciliation. Socket estimates omit some transport overhead and cannot reproduce Render billing exactly.

Connection counts in this first post-deployment window do not prove a reconnect storm. Compare later windows before attributing normal pool initialization or HTTP connection creation to a persistent fault.

## Visible database workload

| Command / collection | Commands |
|---|---:|
| find clients | 649 |
| find authsessions | 630 |
| find employees | 342 |
| find deviceloginrequests | 279 |
| findAndModify task_time_logs | 273 |
| find task_time_logs | 255 |
| find projects | 237 |
| find tasks | 231 |

These are observed top-N counts, not all database commands. The measurements count commands by collection, not by calling HTTP route. They cannot directly assign all client/auth-session reads to the timesheet endpoint. Code inspection confirms that personal history reads populate project/client/task references and that recurring authenticated requests involve session checks; these are candidates to investigate, not exact per-route database attribution.

## Preliminary interpretation and phase order

1. Phase 2 (desktop profile and timesheet refresh reduction) is supported by the observed request counts and response-body ranking. Preserve immediate timer-action updates, manual refresh, heartbeat frequency and session revocation behavior.
2. Phase 3 (unchanged list caching) remains a candidate because client/project/task reads are frequent. Verify callers and existing cache behavior before adding new caches.
3. Preserve the 20-second timer heartbeat and 90-second lease. This sample does not justify changing those safety rules.
4. The earlier CPU/memory screenshots showed low CPU use, stable memory around 120–135 MB of a 512 MB limit, one instance and 173,758 requests over the selected two-day period. They do not indicate a compute-capacity problem in that displayed period.
5. The earlier 1.07 GB bandwidth figure is monthly (520 MB HTTP responses and 571 MB service-initiated). It must not be divided by the separate two-day request count or this ten-minute sample.

## Evidence still needed to finish the baseline

- Two or three additional complete ten-minute JSON summaries during ordinary work, after the initial deployment window. A representative working-day export is stronger evidence.
- Actual signed-in employee-hours for the matched period, overnight app behavior, and deployed desktop/dashboard versions.
- Render HTTP/service-initiated usage for exactly the same measurement period, allowing for its reporting delay.

The offline analyser is available through `npm run analyze:traffic` in backend. It can aggregate intact exported log entries while skipping duplicates and identifying coverage limits. This screenshot-based baseline does not claim measured savings from an optimization.
