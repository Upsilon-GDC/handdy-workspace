# Phase 1 — existing activity data and migration readiness

**Completed:** 2 November 2026, inventory captured at 15:35:49 IST (10:05:49 UTC).  
**Scope:** Read-only database inventory, source review, migration dry-run classification and mapping review worksheet.  
**Database:** The MongoDB database selected by the existing backend `MONGODB_URI`. This audit did not independently verify that its target is the currently deployed production database. Connection details and credentials are not included in this document.  
**Outcome:** Phase 1 is complete. No database records, indexes, live timers, website flows or desktop behavior were changed. Phase 2 is not implemented.

## Findings from the connected database

| Item | Count |
|---|---:|
| Projects, including inactive/deleted history | 19 |
| Active, non-deleted projects | 7 |
| Clients, including inactive history | 12 |
| Tasks, including inactive/deleted history | 134 |
| Enabled, non-deleted tasks | 72 |
| Other tasks retained as history | 62 |
| Teams | 3 |
| Employees | 21 |
| Time-entry documents | 1,875 |
| Distinct recorded project/client/task combinations | 183 |
| Safe automatic-link candidates under the conservative rules below | **0** |

This is a live inventory, not a point-in-time backup. An earlier read returned 1,874 time entries; the final read returned 1,875 while the application continued operating. Rerun the inventory before any migration. Historical counts include retained soft-deleted manual entries and must not be interpreted as current billable totals.

### Existing task structure

- All **72 enabled tasks are projectless/shared**, not directly linked to one project.
- All 72 are team-wide tasks; none have explicit individual employee assignees.
- Of these, **69 are work tasks and 3 are break tasks**.
- All **7 active projects have no explicit client references** in either `client` or `clients`.
- The source currently allows shared tasks to appear under projects available to their teams and offers a shared active-client catalog in the desktop.

Therefore, task names, project names and prior selections do not supply an authoritative mapping. Creating links automatically would introduce new business assumptions. **Existing tasks can still be reused; they do not need to be recreated.** Each shared task can receive several approved project/client mappings while keeping its ID and team assignments.

Across all historical/current projects, 12 have no explicit client reference. Seven projects reference at least one inactive client. These historical records must not be reactivated or repointed simply because an active record has the same name.

### Names cannot identify records safely

The inventory found **21 duplicate normalized-name groups**: 5 client groups, 7 project groups and 9 task groups. Normalization ignores case, repeated spaces and outer whitespace. These are review signals, not proof that records should be merged: groups may include old/deleted versions or legitimate separate tasks.

Use MongoDB IDs for mappings. Preserve distinct same-name records and their history.

### Requested default activity

| Requested record | Actual finding | Phase 2 handling |
|---|---|---|
| `No Project` | Two name matches: one active and one inactive/deleted | Reuse the active ID after confirming it; preserve the old ID |
| `Upsilon` | Two name matches: one active and one inactive | Reuse the active ID after confirming it; preserve the old ID |
| `Idle Break` | No exact normalized-name match | Create a specifically approved system task later; do not rename an existing break task automatically |

The active No Project has no client linkage yet. Its Upsilon mapping and default configuration do not currently exist as an explicit approved relationship.

**Open behavior decision:** Preselection only versus automatic timer start remains undecided. Recommended: preselect without recording time, and classify a subsequently started Idle Break as non-billable break time. Phase 1 does not implement either option or alter attendance.

### Historical references needing preservation

| Historical condition | Distinct combinations | Time-entry documents |
|---|---:|---:|
| Referenced task ID has no document in current tasks collection | 52 | 181 |
| Referenced project ID has no document in current projects collection | 17 | 67 |
| No recorded client ID | 62 | 209 |

These conditions overlap: **69 distinct combinations** have at least one of these issues. Do not add the rows together. “Missing” means absent from the queried collection, not merely inactive or soft-deleted. The cause was not established by this audit.

For 56 enabled shared tasks, historical usage includes project/client combinations that are not represented by their current null project relationship. That is expected to be possible under the old shared-task design; it is not, by itself, evidence of invalid historical tracking.

Historical usage is included in the private worksheet as evidence. It is **never treated as approval** for future access. No old time entry will be rewritten, merged, deleted or assigned a guessed client in the proposed mapping migration.

### Assignment and index checks

- No employees had a referenced team that was missing/inactive, or a referenced lead ID absent from employees, in these limited checks. This does not establish that every team/lead role relationship is correct.
- No enabled task was flagged for a missing/inactive referenced team or explicit assignee.
- The database already has the unique partial active-timer index and the start-operation uniqueness index.
- Existing project/task code uniqueness and relationship indexes were inventoried without modifying them.
- No activity-mapping model, collection or new index was created by Phase 1.

## Dry-run migration rules

The inventory tool classifies each task; it has no migration/apply path.

| Classification | Conditions | Current result |
|---|---|---:|
| Automatic-link candidate | Enabled task has an explicit active project, exactly one explicit active client, valid referenced scopes, no conflicting primary/client array or inconsistent historical combination | 0 |
| Review required | Enabled task is shared/projectless, has ambiguous clients, or has a reference/scope issue | 72 |
| Retain inactive history | Task is inactive or deleted | 62 |

An automatic candidate is still a proposal for later controlled migration, not a database change. A single observed historical client or a matching display name is insufficient to create an automatic mapping. Team-compatible project IDs in the worksheet are review aids only; they are not final client mappings or authorization grants.

After the worksheet is approved, Phase 2 should:

1. Revalidate approved IDs and statuses against a fresh inventory.
2. Verify that mappings do not widen the intended team/employee scope.
3. Take and verify an appropriate backup before writing.
4. Add mapping documents and indexes through a repeatable migration, recording inserted IDs and migration identity.
5. Keep old clients compatible until the new backend/UI flow is deployed and validated.
6. Preserve every existing task/time-entry ID. Rollback removes/disables only migration-owned unused mapping/configuration records; it must never remove historical time entries.

Strict mapping enforcement cannot be enabled yet: it would leave the existing 72 enabled tasks without configured combinations.

## Review artifacts

Detailed business names, record IDs and historical combinations are kept in the existing **Git-ignored** `backend/.local-repairs/activity-phase1/` directory. Employee names, emails, passwords, tokens, notes and rates were not queried for this inventory.

- [Readable mapping review worksheet](backend/.local-repairs/activity-phase1/MAPPING_REVIEW_WORKSHEET.md)
- [Structured review worksheet](backend/.local-repairs/activity-phase1/review-worksheet-2026-11-02T10-05-49-261Z.json)
- [Full inventory and database index definitions](backend/.local-repairs/activity-phase1/inventory-2026-11-02T10-05-49-261Z.json)

The worksheet lists active clients, the seven active projects needing client assignments, and all 72 existing enabled task IDs. Each task supports multiple approved project/client pairs. All approvals are initially blank/pending; no proposed pair is silently accepted. These private links will not travel with a Git commit; share them separately if another reviewer needs access.

## Tooling and validation

Added [auditActivityMappings.js](backend/scripts/auditActivityMappings.js), which uses the native MongoDB driver exposed by the installed Mongoose dependency. It does not import Mongoose models, so it cannot initialize model indexes or trigger application write hooks. Its database operations are collection reads, a grouped history aggregation and index inspection. It does not call insert/update/delete/create-index operations. Connection failure output avoids exposing driver connection details.

Run from the repository root:

```powershell
node backend/scripts/auditActivityMappings.js
```

The tool reads the existing backend environment and writes timestamped private JSON reports plus a structured worksheet. The readable Markdown worksheet was prepared from the final snapshot for this review; rerunning the tool generates new JSON artifacts rather than overwriting that reviewed Markdown.

Added [activityMappingInventory.test.js](backend/test/activityMappingInventory.test.js). Six tests cover conservative single-client proposals, multi-client ambiguity despite history, shared-task handling, inactive/missing references, historical orphan preservation, and duplicate/default-name handling.

**Verification:** Six new inventory tests passed. The full configured isolated backend test suite passed: **230 tests, 0 failures**. No frontend changes were made, so frontend/build/Electron suites were not repeated for Phase 1.

## Decisions needed for the next phase

1. Which active clients belong to each of the seven active projects?
2. For each existing shared task, which project/client pairs should offer it? The same task ID may be reused in several pairs.
3. Are any shared break tasks intentionally available under every authorized pair, or should they have specific mappings?
4. Should Idle Break be selected only, or automatically start recording? Confirm applicable roles and the proposed non-billable break classification.

**Phase 1 result:** Existing tasks can be retained, but no automatic links are justified by the current explicit relationships. The private worksheet is ready for mapping decisions. Database and application behavior remain unchanged.
