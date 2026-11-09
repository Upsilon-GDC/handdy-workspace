# Phase 1: collect a traffic baseline

This phase measures usage without changing timer or refresh behavior. The offline analyser never reads `.env`, connects to MongoDB or contacts Render.

## Collect production evidence

1. With `METRICS_ENABLED=true` deployed, let CRM run through a representative working period. Startup messages alone are not measurements: `[metrics]` JSON windows are emitted every ten minutes.
2. Export full application log lines containing `[metrics]` from Render for that period. Keep each JSON entry intact on one line. Save the plain-text export locally; screenshots cannot be parsed by this tool.
3. Alternatively, save one authenticated admin `GET /api/metrics` JSON response. This is cumulative since server start; analyse it separately from log windows and other snapshots.
4. Record the same period's Render HTTP Responses and Service-Initiated figures, deployment versions, approximate signed-in employee-hours and whether apps remained open overnight. Twenty people signed in for eight hours each is 160 employee-hours, but enter actual usage rather than assuming everybody used CRM all day.

## Run locally

From `backend`:

```powershell
npm run analyze:traffic -- "C:\path\render-metrics.log"
npm run analyze:traffic -- "C:\path\render-metrics.log" --employee-hours 160 --out "C:\path\baseline.md"
npm run analyze:traffic -- "C:\path\metrics-snapshot.json" --json
```

The output file's parent must exist. Existing files are never overwritten. Use a new filename for each collection. The report ranks response bytes, request counts, database commands, outbound destination bytes, failures, timer-lease events and reconnections. Retain raw exports privately; the analyser does not upload them anywhere.

## Interpret carefully

- Application logs include top-N routes and database commands, not every row. The report labels route and command totals as observed lower bounds.
- Route body bytes are compressed and omit headers. Database BSON sizes are estimates before compression. Socket totals are directional and omit some TLS/TCP overhead. Received bytes are not added to outbound bytes.
- External-service subtotal excludes `http-clients`; check any internal or local destinations before comparing with Render's public outbound billing.
- Duplicate exported windows are skipped. Different records with an identical start time, multiple cumulative snapshots, or mixed snapshots/windows are rejected to prevent double-counting. Gaps between exported windows are not filled or extrapolated.
- This report does not assert that a timer-lease closure means a network fault or that one endpoint caused the full monthly bill. Compare matched periods and employee-hours before claiming savings.

Phase 1 finishes when real production measurements identify the main traffic sources. Installing the analyser and passing synthetic tests alone do not complete the baseline.
