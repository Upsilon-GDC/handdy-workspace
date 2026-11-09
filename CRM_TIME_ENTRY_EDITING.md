# Website time-entry corrections

Implemented locally on **3 November 2026**. Production was not changed.

## Using Edit entry

1. Sign in as **Admin, Alpha or Manager**.
2. Click **Edit Entries** under **Entry management**. Click a **team card** at the top, then an **employee card** below: their entries load automatically for the selected date range (today by default). No company-wide results load on entry. Use **Load entries** to refresh after changing the project/date filters. Switching employees discards old results and ignores late responses for the prior employee. The direct route is `/admin/time-entry-edits`.
3. Click **Edit entry** beside a completed work, break or idle row.
4. The editor shows **only the segment clicked**, with its type/start/finish. Other segments are retained without displaying every segment at once. Change its timing/type as required. Project/client/task/note fields still apply to the **whole saved entry**, including all its segments; this feature does not assign different projects/tasks to segments within one entry.
5. Enter a correction reason, choose **Review correction**, then **Confirm and save correction**.

The form uses the company timezone, including seconds/milliseconds. Moving a shared boundary changes the adjacent segment's boundary too, keeping the saved entry continuous. Changing the first segment's start or last segment's finish changes the whole entry's time range. Durations are calculated from times; they are not independent editable totals.

**Between tasks** is a calculated gap between saved entries, not a database record. Its **Edit gap** button opens a focused gap editor without listing the preceding entry's work/idle segments. Changing the gap's start adjusts only the preceding entry's finish. The displayed gap finish is read-only because it belongs to the following entry's start; edit that entry separately to change it. The gap editor preserves existing project/task/note values and requires a correction reason. Creating a separate stored gap entry or directly assigning a project/task to a synthetic gap is not supported.

The selected segment is matched against freshly loaded type/start/finish values. If that row or gap boundary has changed, the editor asks to reload instead of falling back to a different segment. Shared boundary edits continue to update the adjoining segment boundary to keep stored segments connected. Confirmations display the selected segment/gap interval, rather than the entire session interval.

Running/paused timers cannot be edited. Stop them first. HR, TLs and employees have no Edit action and receive 403 from both edit APIs, even when they have manual-entry/report duties. Existing Add entry permissions remain unchanged.

The Edit Entries tab remains visible when the other sidebar groups are collapsed. Its route is restricted to Admin, Alpha and Managers; it is not a delegated report duty. Existing Edit entry buttons in Detailed Timesheet also remain available.

**Entry management** also includes **Add Entry** (`/admin/time-entry-add`) for these same roles. Both pages show the same team-card directory at the top, with member counts. Clicking a team displays only its members underneath, with names, IDs, roles/designations and initials. Search within that team by name, employee ID or role, then click a member card to select them. Selection is highlighted; clicking an already selected team/member retains the selection. Changing team clears the employee/search; Edit Entries also invalidates pending responses and removes prior results. Add Entry lists eligible active employees; Edit Entries retains historical/inactive choices when available. A **No team assigned** card supports accounts without a team. Then click Add entry to use the existing project/client/task/time form and its review/confirmation step. Existing manual-entry API permissions and validations still apply. A success notice identifies the employee and date; open Edit Entries, choose the team/member and that date to review it. Older Add entry controls elsewhere remain available.

The original activity tuple can be retained when correcting historical times, even if archived/inactive or missing a client attribution. No client is guessed and no historical mapping is invented. A changed activity must currently be active, available to the target employee, and valid under project/client/task mapping rules. A physically missing task record must be replaced with a valid choice.

## Database behavior

- The existing `task_time_logs` ID, employee, timer/manual origin and manual creation metadata are retained.
- `TaskTimeLog.editVersion` starts at zero for legacy records and increments on each correction. Both the loaded version and exact `updatedAt` must still match when saving; stale edits receive 409.
- `time_entry_edits` stores a new revision with actor, server timestamp, reason and before/after snapshots. Prior revisions are not overwritten by this API. The editor displays the latest 20 correction summaries; complete snapshots remain in the audit collection.
- Work, pause and idle totals are recalculated from contiguous segments. Break task classification remains authoritative for reports/billing, as before.
- Correction, revision insertion and old/new attendance-day recalculation commit in **one MongoDB transaction**. Any audit/attendance failure aborts everything. There is no partial-write fallback; use the existing transaction-capable MongoDB deployment.
- An employee document write serializes competing administrative edits for that employee, including changes to different entries. Overlapping saved intervals/open timers are rejected, and touching boundaries are allowed.
- Report refresh reloads saved values after success. Subsequent reports, billing calculations and newly generated exports read the corrected records. Previously downloaded Excel/PDF files cannot change and must be exported again.

Schema additions are `TaskTimeLog.editVersion`, `Employee.timeEntryEditVersion` and the `TimeEntryEdit` collection. Backend startup explicitly creates the new collection and its unique `(timeLog, revision)` index before serving. No backfill, deletion or production database operation was run during development.

API routes (authenticated; controller-enforced Admin/Alpha/Manager role checks):

- `GET /api/time-logs/entries/:id/edit`: current editable record, target employee, eligible/original choices and correction summaries.
- `PATCH /api/time-logs/entries/:id`: activity IDs, segment boundaries/types, note, reason, expected version and expected update timestamp. The server computes totals and stores the correction.

### Concurrency scope

As of Phase 3 (9 November 2026), administrative corrections, manual creation/deletion, and live starts/stops share a per-employee process queue in `timeEntryWrites`. The existing correction transaction and employee-document version are retained. Overlap checks run after preceding queued writes commit; touching boundaries remain valid. Lease sweeps only shorten an open interval and retain their conditional updates. This protection requires one API process, including during deployments; it does not coordinate multiple servers or direct database/script writes. See [Phase 3 implementation and rollout](docs/TIME_ENTRY_INTEGRITY_PHASE_3.md).

This feature does not edit live timers, employee identity, attendance manually, task definitions or billing rates. Attendance is derived from corrected logs. Large edits are bounded to 200 segments and a 31-day entry duration; notes/reasons are bounded to 2,000/500 characters.

## Verification

- Backend: **277 regression tests passed**, including segment normalization, invalid input, role restrictions and existing attendance/timer behavior.
- Real MongoDB: **18 integration tests passed** (9 mapping tests plus 9 correction tests), on an isolated loopback MongoDB 7.0.24 replica set. Correction coverage includes exact mapped activity, totals, before/after history, cross-day attendance, stale/competing corrections, overlapping intervals, active-entry rejection, archived/original activity and missing client attribution.
- Database-injected audit insert and attendance write failures both prove rollback of the saved correction; attendance failure also rolls back the already-inserted revision.
- Dashboard: **71 helper tests passed**; lint, route audit and production build passed. The existing export bundle-size warning remains.
- Browser smoke uses the actual React page with a fixture API: manager visibility, hidden HR controls, disabled active entries, project/client/task changes, connected boundaries, review-before-save, failed-save recovery, refreshed report, calculated-gap explanation, history and desktop/mobile layout.
- Full desktop regression also passed: **134 unit tests and six browser checks**, including the new editor. The final direct editor check additionally covers preserving a historical entry with no client. Desktop/mobile screenshots were visually inspected.

Team-first UI follow-up: **72 dashboard helper tests**, lint, route audit and build passed. Browser checks verify both Add/Edit team selection, no members before selecting a team, raw/populated team references, clearing a previous employee, excluding another team and preventing company-wide results before selection. The later card-directory layout also passed both browser workflows, including member search and retaining an already selected team. This follow-up changes dashboard selection only; database APIs/authorization are unchanged. Latest card evidence: `artifacts/entry-cards-tests.log`, `artifacts/entry-cards-lint.log`, `artifacts/entry-cards-build.log`, `artifacts/entry-cards-edit-browser.log`, and `artifacts/entry-cards-add-browser.log`. Earlier evidence remains in the `artifacts/team-entry-*` logs.

Selected-segment follow-up: **73 dashboard tests**, lint and production build passed. The actual React browser smoke covers single Work/Idle segment visibility, retaining unselected timings, updating an adjoining boundary, a focused gap save with unchanged activity/note, stale-row detection (helper tests), confirmation and desktop/mobile layout. No backend schema/API or production records were changed by this UI follow-up. Evidence: `artifacts/selected-segment-tests.log`, `artifacts/selected-segment-lint.log`, `artifacts/selected-segment-build.log`, `artifacts/selected-segment-browser.log`.

Commands:

```powershell
npm --prefix backend test
npm --prefix backend run test:integration
npm --prefix dashboard test
npm --prefix dashboard run lint
npm --prefix dashboard run test:routes
npm --prefix dashboard run build
npm --prefix desktop-app test
```

Evidence:

- `artifacts/entry-edit-backend-regression.log`
- `artifacts/entry-edit-mongo-integration.log`
- `artifacts/entry-edit-dashboard-tests.log`
- `artifacts/entry-edit-dashboard-lint.log`
- `artifacts/entry-edit-route-audit.log`
- `artifacts/entry-edit-dashboard-build.log`
- `artifacts/entry-edit-browser-smoke.log`
- `artifacts/entry-edit-desktop-full.log`
- Private screenshots: `backend/.local-repairs/entry-edit-review/`.

## Deployment

Deploy the updated backend and built dashboard together. This website feature does not require another desktop installer update. Existing 2.0.3 desktop changes (running-break exemption) still require their own distribution as documented previously. No deployment, publish, production correction or live-data migration was performed.
