# Desktop idle safeguard verification

`node --test --test-isolation=none integration/idleHeartbeat.cjs` uses only an
isolated loopback database. It checks OS-idle heartbeat samples against the
current global/employee policy, excludes reported idle seconds from work,
retains break/exempt/active-work behavior, and rejects stale timer IDs. Samples
store only the latest idle seconds, observation time and app version.
No idle is inferred from long sessions or absent input telemetry. Existing
records are not backfilled. Deployment plus desktop 2.0.7 is required for the
independent heartbeat safeguard; older clients retain their existing protocol.

Timer-start validation now overlaps the lease sweep with independent reference
reads. Start and active responses include serverNow; desktop live clocks align
to it, avoiding a stopped-looking counter when the Windows clock is behind.
The UI still waits for a confirmed server start. Diagnostic timing logs separate
request latency from controller processing; local tests do not establish live
Render/Atlas start latency.

# Activity mapping and entry correction MongoDB integration tests

Timer start performance regression (run from `backend`):

```powershell
node --test --test-isolation=none integration/timerStartLatency.cjs
```

This uses its own disposable loopback database and checks that a fresh mapped start reads project/client/task references once each, returns only permitted metadata, records attendance before replying, and safely replays duplicate requests. It prints local timings and database command counts; these do not measure deployed latency. Independent validation reads run together, but lease cleanup, authorization, per-employee write serialization and attendance updates still complete before success. The optimization is in the backend; it does not require a desktop version change.

Optional `TIMER_START_BASELINE_PATH` accepts a trusted local pre-change controller source file for before/after command comparison. It executes that source in the test process; leave it unset for normal regression runs. Run different integration files in separate Node processes so their isolated databases do not share a Mongoose connection.

Run from the repository root:

```powershell
npm --prefix backend ci
npm --prefix backend run test:integration
```

This suite uses a real MongoDB **7.0.24** process with WiredTiger and a single-member replica set, managed by the development-only `mongodb-memory-server-core` package. It is independent of the mock-based `npm test` suite. The first run downloads the platform's MongoDB binary (about 600 MB on Windows); later runs reuse the binary cache. Allow network access and local child processes. Startup has a 15-minute limit for the initial download.

The runner creates a random `crm_activity_integration_*` database on a newly started **127.0.0.1** server. It does not load `.env`, accept an application database URI, start the application server, or connect to Atlas. Fake identities and catalog records are generated for every test. The suite disconnects and stops the disposable server afterward; it never calls `dropDatabase` against a supplied connection.

Coverage:

- Server-enforced lease creation for omitted/web/desktop client metadata, heartbeat renewal, the exact 90-second expiry boundary, closure at last contact, and late-heartbeat rejection. Existing null-heartbeat records remain unchanged pending explicit rollout review.
- Retired attendance writes cannot create presence or mutate timer-owned attendance, including requests racing live starts/stops. Historical legacy rows and overnight start-day attendance are covered.
- Explicit index initialization and unique project/client/task tuples.
- Ten simultaneous link saves with one accepted version and nine conflicts.
- Eight simultaneous same-name task batches with exactly one complete batch and its mappings.
- TL own-team creation, separate-team access and company-wide manager choices using real queries.
- Manual-entry option controller reads shared mapped tasks for the target employee and removes tasks after assignment revocation.
- A database collection validator deliberately rejects mapping insertion after tasks were inserted; all task, mapping and version writes must roll back.
- A second database validator rejects the final project update after mappings were disabled; the client and mappings must remain intact.
- Five races between linked creation and project-client removal, checking the resulting relationships and task counts.
- Unlink/relink keeps mapping identity and historical time records; removing the last link keeps strict selection enabled.

Collection validators are installed temporarily only inside this disposable database. Model methods, sessions, queries and transaction retries are real; no mocked database methods are used. Controllers are invoked directly with fixture request/response objects, so HTTP authentication middleware is covered separately by the ordinary regression suite.

`backupRecovery.cjs` starts another isolated loopback replica set and exports only synthetic collections to temporary folders. It verifies a common snapshot during concurrent writes, BSON types, restored indexes/validators, interrupted exports, corruption/path rejection, empty-target/source protection, explicit legacy-export review, and read-only domain checks. It never loads `.env` or uses the configured application URI.

This establishes transaction behavior on local MongoDB, not Atlas networking, deployed credentials, multi-node failover, production index contents, or the separate manual-time overlap concurrency audit finding. Those remain deployment/pilot checks.

The integration command also runs `timeEntryEditing.cjs`: administrative correction transactions, audit snapshots, old/new attendance days, stale saves, shared per-employee time-write coordination, concurrent overlapping manual creates, durable manual-operation replay through correction/deletion, touching intervals, manual/create-versus-correction contention, live-timer protection, failure recovery, rollback under real audit/attendance database validation failures, archived activity and unattributed historical entries. It starts its own disposable local replica set and never loads `.env`. See [website entry corrections](../../CRM_TIME_ENTRY_EDITING.md) for behavior and the single-process concurrency limit.
