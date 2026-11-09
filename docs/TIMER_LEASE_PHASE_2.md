# Phase 2: server-enforced live timer leases

Implemented locally on 9 November 2026. This document is a rollout procedure, not evidence of a production deployment or data migration.

## Behavior

Every successful new live timer start sets `desktopHeartbeatAt` to the server's `startedAt`, regardless of request `clientType`, session label, or submitted timestamps. A caller cannot disable expiry by sending `web` or omitting metadata. No new required request field, status code, or response envelope was introduced.

Heartbeat timing remains 20 seconds, expiry remains 90 seconds, and the sweep still runs every 30 seconds and at server startup. Expiry closes the timer at the last confirmed heartbeat, not at the sweep time. The existing conditional close protects concurrent heartbeat/stop updates. Start-operation replays do not renew a lease or modify an old record.

All API callers starting live timers must send heartbeats, including callers using web sessions. This preserves the existing API's ability to accept those sessions while applying one expiry policy. The dashboard does not start timers. Native-client labels are not a security attestation.

The schema still permits null heartbeats for completed manual entries and historical records. Existing active null-heartbeat timers remain outside the automatic sweep until reviewed and stopped; this phase prevents new API starts from adding more of them. It does not claim that historical unleased timers have been resolved in production.

## Rollout and existing records

1. In staging, test the actual oldest installed desktop version that will remain supported. Confirm its start response contains a heartbeat date and it sends successful `/api/time-logs/heartbeat` requests about every 20 seconds, including during pauses/breaks and while minimized. The current renderer already does this. A client that never sends heartbeats is incompatible with sustained tracking under this policy and must be updated before rollout; do not reintroduce an opt-out for it.
2. Before deployment, arrange a controlled pause in timer starts and have employees stop current timers normally. Inventory legacy active timers using the read-only MongoDB query below. Confirm the collection name in the selected application database before running it.
3. Review each null/missing-heartbeat result with its employee and time-record owner. There is no reliable last-contact timestamp in these records. Do not bulk set heartbeat timestamps to deployment time or blindly close at `startedAt`; either action invents work/contact history. Agree the actual stop time, stop the old timer through the normal workflow, then correct its historical interval through the authorized entry editor if needed. Recheck its attendance and report totals.
4. Deploy after the legacy inventory is empty and the supported-client staging checks pass. Verify a new start without `clientType` receives a lease; confirm regular heartbeats keep it live. Simulate disconnect on a dedicated staging account: after 90 seconds the next sweep closes it at last contact. Verify the installed client reconciles the closure.
5. Resume work and monitor `[timer-lease]` logs and support reports. Unexpected closures require checking client heartbeat requests and connectivity. Rolling back to the earlier controller reopens the metadata opt-out; fix incompatible clients rather than using rollback as a permanent policy.

Read-only inventory in mongosh, against the intended database:

```javascript
db.task_time_logs.find(
  {
    isActiveTimer: true,
    status: { $in: ["running", "paused"] },
    desktopHeartbeatAt: null // Matches null and missing fields.
  },
  { _id: 1, employee: 1, project: 1, task: 1, startedAt: 1, status: 1, desktopHeartbeatAt: 1 }
)
```

No production inventory, correction, employee upgrade, or deployment was performed as part of the code change. The manual/create/edit concurrency issue remains Phase 3 work.
