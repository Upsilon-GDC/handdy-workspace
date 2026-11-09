# Phase 3: time-entry integrity

Implemented locally on 9 November 2026. Nothing was deployed and no production records were changed.

## Changes

`backend/src/services/timeEntryWrites.js` serializes interval-changing work by employee. Live starts/stops, manual creation/deletion, and administrative corrections use the same queue. Different employees remain independent. A failure releases the queue so later valid work can continue. Queue keys normalize ObjectId casing.

Manual creation checks overlaps after earlier writes finish. Corrections retain their MongoDB transaction, optimistic revision check, immutable audit insert, and attendance reconciliation, now inside the shared queue. Deletion checks the loaded update timestamp after acquiring coordination, so it cannot silently delete a changed revision. Touching intervals remain valid. Live starts use server time after acquiring the queue; manual entries and corrections cannot end in the future. Together with the overlap/active-timer checks, this keeps new live starts outside previously accepted historical intervals. Lease expiry only shortens open intervals and continues using its existing conditional write.

Manual creation accepts an optional `operationId`. A unique partial index named `manual_entry_operation` covers employee, creator, and operation ID. Backend startup explicitly creates that index before listening. The entry stores the original normalized request hash, retained when the entry is edited or soft-deleted. Same-payload retries return the existing entry; different payloads under the same ID receive 409. Deleted entries receive 409 rather than being recreated. Authorization is checked before replay. Clients without an operation ID still work and receive overlap protection.

The Add Entry modal keeps its operation ID after response failures and blocks duplicate in-flight saves. A changed submitted payload gets a new ID. The ID survives retries within the open modal, not a browser restart or reopening the modal. The server's durable operation identity survives backend restarts.

## Scope and rollout

- This is process coordination for the existing **single API process** deployment. Do not enable multiple instances, Node cluster workers, or concurrent external/script interval writes. The manual-operation unique index prevents duplicate request identities but is not a general database interval-exclusion constraint.
- Pause time writes while switching server versions. Do not allow an old process and a new process to handle time writes concurrently during a rolling deployment. This queue cannot protect against an old server that does not participate.
- Deploy the backend and confirm successful index creation before releasing the new dashboard. The optional request field preserves older client shapes. If the index fails to build, startup fails; inspect the named index/error rather than dropping unrelated indexes.
- No historical intervals are repaired or rewritten automatically. Existing overlaps still need authorized review and corrections. Phase 2's null-heartbeat review remains outstanding before production rollout.
- Manual entry plus attendance synchronization retains its existing behavior; this phase does not redesign legacy attendance endpoints or provide database-wide backup consistency. Those belong to later phases.
- A distributed coordination design is required before relaxing the single-process restriction. Correction transactions alone do not make non-participating writers safe.

## Verification

- Backend: **327 tests passed**, including queue ordering across a rejected write and independence between employees.
- Disposable MongoDB suite: **64 tests passed**. New scenarios include eight overlapping manual submissions with exactly one success; six retries with one saved record; changed-payload rejection; replay after correction; no resurrection after deletion; touching intervals; manual creation competing with correction; live start/manual activity and active-timer protection; and recovery after a forced database insertion failure.
- Dashboard: **98 tests passed**, ESLint passed, and the production build passed with the existing large-chunk warning.
- Isolated Electron manual-entry smoke test passed. The fixture saved the first request but returned 500; the form displayed the standard server-error message, retained its request ID, and retried successfully with exactly one saved entry. The fixture also checks existing entry/deletion/permission flows. Its initial assertion expected raw server error text; that expectation was corrected to the app's standard 500 message before the successful run.
- `git diff --check` passed. The full Electron suite and production/staging rollout were not run.

Logs are in `artifacts/phase3-backend-tests.log`, `phase3-integration.log`, `phase3-dashboard-tests.log`, `phase3-lint.log`, `phase3-build.log`, and `phase3-manual-entry-smoke.log`.
