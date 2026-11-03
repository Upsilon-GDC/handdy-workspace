# Website activity-link management

Added 2 November 2026. This is the additive mapping foundation and website management increment. The offline mapping worksheet is optional: users can choose links directly on the website.

## Follow-up: create tasks and links together

The shared **Add New Task** form now supports admins and team leads:

1. Select the project once.
2. Its sole active linked client is selected automatically. If several clients are linked, choose one for the batch.
3. Enter one or several task names (up to 100 names, 200 characters each).
4. Team access is automatic: TLs use their own team; managers/admins (and existing company-wide HR creators) default to the project's teams. Authorized company-wide creators can choose **Change team access** to select a subset. When `reassign_tasks` is granted, specific employees may be chosen instead of the whole assigned team.
5. Save. All new task records and their project/client mappings are inserted in the same MongoDB transaction.

Projects with no active linked clients cannot be used in this creation flow until an administrator saves their client links. Team leads see only projects available to their own active team and cannot assign other teams or employees outside the chosen teams. Project changes clear the client choice and incompatible team/employee selections. Failed saves keep entered task names for correction.

The new routes are `GET /api/tasks/creation-options` and `POST /api/tasks/linked`, both gated by `create_tasks`. The options response uses minimal employee identities only for users allowed to reassign tasks. The save handler validates project/client membership and live team/employee status, and infers the client on the backend only if there is exactly one eligible active linked client. No UI-supplied display name establishes a relationship.

Automatic assignment uses a `teamAssignment` request mode (`own`, `project`, or `selected`). The server resolves automatic teams from live records inside the save workflow; it does not trust a browser-supplied list as the project default. TLs cannot request the company-wide mode or assign another team. A legacy project with no configured teams requires an explicit authorized override or project setup, rather than silently assigning all company teams. Existing callers supplying explicit team IDs retain their validated selection behavior.

New task team IDs are stored as a snapshot. Editing project team membership later does not rewrite access on previously created tasks. Managers retain visibility of all TL tasks without individual assignment. No existing task or historical time entry was migrated for this change.

Duplicate task names are checked within the chosen project/client/type and overlapping teams; separate clients can have separate tasks with the same name. Project version writes serialize competing transactions with link/client changes so transaction retries revalidate the relationships and duplicate checks. Duplicate/retried submissions cannot create a second same-name batch in that scope; they receive a conflict rather than a replay response. The transaction requires Atlas/a replica set and has no partial-write fallback.

Existing task edit forms now omit the project field instead of resetting it to null. Existing mappings, assignments, historical time entries and reporting calculations are preserved. The old `/tasks` and `/tasks/bulk` creation APIs retain their previous behavior for requests without a client; when a client is supplied they delegate to the validated linked-creation path instead of silently ignoring it. The updated website creation forms exclusively use `/tasks/linked`.

Validation for this follow-up includes backend tests for automatic client selection, invalid clients, own-team scope, individual assignment permission, duplicate names and mapping-failure abort; frontend helper tests; and a real React/Electron-hosted mock-API smoke exercising both admin and TL creation, multi-name batches, single/multiple/no-client cases and failed-save recovery. Real local MongoDB transaction races and rollback checks have also passed; see the [database integration report](CRM_ACTIVITY_LINKS_DATABASE_TEST_REPORT.md). Deployed Atlas configuration remains a rollout check.

## Using the controls

1. Open **Projects → Link clients & tasks**, or **Tasks → Link multiple tasks**.
2. Choose an active project.
3. Expand **Project clients**, select its clients and click **Save project clients**.
4. Choose one of the saved active clients.
5. Search tasks by name, code or team. Check individual tasks or click **Select all shown**.
6. Click **Link selected tasks**. Repeat for other project/client combinations.
7. To remove links, select tasks and click **Unlink selected tasks**. Task records are retained.
8. After employees have the updated desktop app and the project's required links are ready, a company task administrator can click **Enable linked selection**. New desktop timers and manual entries then require an active link for that exact project/client/task combination. **Restore legacy selection** reverses the policy without deleting links or historical entries.

Selection persists across search filters; the displayed selected count includes hidden selections. **Clear selection** resets it. Changing project/client clears selections. A bulk action supports at most 500 selected tasks.

Existing task IDs and assignments are reused. Different IDs with the same name remain separate, and codes/team names help distinguish them. The same task can be linked under multiple project/client pairs. No guessed links or default activity are created.

## Permissions and validation

Both `manage_projects` and `edit_tasks` are required by the UI and API. Admin-level roles always hold those permissions. HR uses its effective grants; delegated non-HR users can only link tasks within their task-team scope.

Task linking checks active project/client membership, active non-deleted tasks, explicit task project compatibility and overlapping project/task teams. Assignments are never broadened by editing a mapping. Removing a project client soft-disables its mappings; delegated users cannot thereby unlink tasks outside their allowed scope.

Every save carries the project's `activityLinksVersion`. A MongoDB transaction updates mappings and increments that project version together. Stale saves receive 409 and must be retried after reopening the linking window. Tuple upserts plus the unique `(project, client, task)` index prevent duplicate links. No transaction fallback performs partial writes.

## Database and deployment

- New `activity_mappings` collection with unique tuple, picker, task and revision indexes.
- New additive `Project.activityLinksVersion` field, defaulting to zero when absent, and `Project.activityMappingEnabled`, defaulting to false.
- New mapped live/manual entries store optional `TaskTimeLog.activityMapping`. The disabled-by-default `SystemSettings.defaultActivity` structure remains reserved; no backfill or automatic default activity is applied.
- Server startup explicitly creates the mapping collection/indexes. Merely importing the model does not create them.
- API routes: `GET /api/projects/activity-links` and `POST /api/projects/activity-links`. POST actions are `clients`, `link`, `unlink`, and `policy`.
- Authenticated employee choices: `GET /api/projects/:id/activity-options` applies active project/team/task/employee permissions and returns active clients and tasks, including per-task client IDs for enabled projects.
- Saving requires transaction-capable MongoDB, such as the existing Atlas deployment. A standalone non-replica-set MongoDB server is not supported for these writes.

Deploy the updated backend and built dashboard together using the existing Render build/start process. No production deployment or database mutation was performed during development. On startup the updated server will create the additive collection/indexes; user-selected links are written only when Save/Link/Unlink is clicked. No employee desktop release is required just to use website management.

There is no automatic migration of existing shared tasks, no rewriting of historical project/client/task IDs and no modification to attendance or billing calculations. Existing projects retain legacy task selection until explicitly enabled. Projects with explicit client references restrict supplied client choices to those references even before strict task selection is enabled. Choose intentional project clients.

## Desktop and time-entry selection phase

The desktop loads the selected project's activity options. For an enabled project, choosing a client shows only its active mapped tasks that the employee is permitted to use. Changing client clears the previous task choice. A single available active client is selected automatically; multiple clients require a choice. Shared/projectless tasks can be reused through mappings without duplicating task records. Existing task team/employee permissions still apply; linking never grants access by itself.

The manual-entry form follows **Project → Client → Task** and uses the target employee's current permissions. Enabled projects require a linked client and task. Manual entries remain limited to work tasks. Legacy manual projects retain their project-owned task behavior during mixed rollout.

Both start-timer and manual-entry APIs recheck the current project/client/task relationship before creating a record, so bypassing the dropdown cannot submit an unlinked combination. Removing every mapping from an enabled project leaves it with no eligible mapped tasks; it does not restore legacy access. Failed/malformed desktop activity-option requests block new starts until a successful refresh. Only an older server's missing endpoint (404) allows the legacy picker fallback; a known missing project or a project already known to enforce mappings does not.

Running/paused timers keep their recorded selection and can still be stopped. Idempotent retries of previously accepted starts retain their original behavior. Historical entries are not revalidated, deleted or relinked when mappings change. This phase does not address the separately audited manual-entry overlap concurrency issue.

Roll out backend and website first, distribute the updated desktop, configure project clients/tasks, then enable projects individually. Enabling enforcement while employees still use an old desktop can reject their unlinked choices. No policy was enabled against a live database during development. No installer was published or production deployment performed.

Database integration phase complete: nine tests passed on a disposable real MongoDB replica set, including concurrent saves, duplicate batches and database-injected rollback failures. Windows local build/pilot also passed: the 2.0.2 candidate and isolated installation/upgrade results are documented in the [Phase 2 report](CRM_WINDOWS_INSTALLER_PHASE_2_REPORT.md). Remaining release work: trusted signing and a real employee-PC logon/policy pilot, then deployment/publication and deployed Atlas verification. Automatic Idle Break/Lunch startup remains unimplemented; opening CRM selects No Project and its linked client without starting a timer.

For rollback, redeploy the previous application build while retaining the additive collection/fields. Stop writes during rollback and retain a database backup. Project-client changes made by users persist; restoring those business choices requires a reviewed recovery from backup, not dropping mappings or historical time entries. Disabling/removing a link does not delete prior tracked time.

## Validation

Latest selection-phase validation (2 November 2026):

- Backend: 272 passing tests, including exact-tuple rejection/acceptance, mapping ID persistence, team scope, empty-map behavior and explicit policy enablement.
- Dashboard: 68 passing tests; lint, route audit and production build passed. Existing large-bundle warning remains.
- Desktop: 133 unit tests plus local mock-API Electron checks for inactivity, automatic sign-in/default selection, dashboard lifecycle, activity-link management/task creation, and manual-entry flow. The browser checks exercise actual pages without production requests.
- Evidence: `artifacts/mapping-backend-tests.log`, `artifacts/mapping-dashboard-tests.log`, `artifacts/mapping-dashboard-lint.log`, `artifacts/mapping-route-audit.log`, and `artifacts/mapping-desktop-full-tests.log`.

Earlier increment evidence:

- Backend regression suite after automatic assignment: 262 tests passed, including linked-creation permission, own-team/default/override, manager visibility and transaction-operation tests.
- Dashboard helper suite: 67 tests passed, including bulk selection, automatic client/team choices and exclusion of unrelated Software teams.
- Dashboard lint, route audit and production build passed. The existing large-bundle warning remains.
- New Electron-hosted browser smoke passed using an isolated mock API: project client selection, 125-task select-all, link/unlink, exclusions, stale-save error and project reset.
- Full desktop suite passed: 119 unit tests plus the inactivity, existing dashboard lifecycle and extended activity-link/task-creation browser smoke checks. See `artifacts/linked-task-desktop-tests.log` and `artifacts/linked-task-backend-tests.log`.
- For the automatic-assignment follow-up, backend/frontend suites, lint, production build and the extended browser smoke were rerun. The smoke covers hidden default team controls, manager defaults, explicit admin subset selection, Software exclusion, TL own-team mode and manager visibility after TL creation. Desktop timer code was not changed; its full suite was not repeated for this follow-up. Backend evidence: `artifacts/automatic-team-backend-tests.log`.

The earlier controller tests use mocked database operations. They are now supplemented by nine real MongoDB integration tests, run with `npm --prefix backend run test:integration`. The [database integration report](CRM_ACTIVITY_LINKS_DATABASE_TEST_REPORT.md) records the results, isolation and remaining deployment checks. No production credentials or writes are used by the integration runner or browser smoke tests.
