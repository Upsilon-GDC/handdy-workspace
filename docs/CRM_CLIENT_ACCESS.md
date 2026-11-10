# Team and employee clients

Administrators, Alpha and Managers can use **Task linking → Team & employee clients**.

1. Select a team. Only that team's active employees appear.
2. Choose **Only selected clients**, check the team's clients and save.
3. Select one or more employees. **Inherit team clients** uses their team's list. **Only selected clients** narrows that list. **Selected clients across teams** lets you choose active clients outside the team's list for those employees. This selected list replaces their team client limits; include their usual clients too if they still need them. **Select whole team (N)** includes all active team members, even those hidden by search. **Select all shown** adds only the visible matches.
4. Save the selected members together. A successful save clears member selection; failures preserve the selection and choices. Switching teams clears member selection. If selected members have different existing settings, choose the replacement explicitly before saving.

## Employees who work with another team

Employees keep one main team for membership, reporting and management. **Additional work teams** grants another active team's projects and shared tasks without moving the employee.

For three Tax employees who also work on WCPA Audit and Bookkeeping:

1. Select **Tax** and check those three employees.
2. Choose **Selected clients across teams** and select **WCPA**, plus any usual clients they still need.
3. Under **Additional work teams**, check **WCPA** and save the selected employees together.
4. Refresh their desktop choices after the current timer stops. WCPA projects and shared tasks are available alongside their usual work, subject to selected clients and project/client/task links.

Tasks assigned exclusively to another employee remain private. Additional work teams do not grant task editing, team management or access to other employees' reports. Removing a work team withdraws access for new selections while preserving existing timers and recorded time. Inactive teams cannot provide work access. History records before/after work-team names, and settings persist across restart.

## Share only specific projects

To give selected Tax employees Audit and Bookkeeping without every WCPA project:

1. Select **Tax** and the employees.
2. Set their allowed clients as needed, using **Selected clients across teams** for clients outside Tax's list.
3. Leave **WCPA** unchecked under **Additional work teams**. That option grants all of WCPA's projects.
4. Search **Additional projects**, check **Audit** and **Bookkeeping**, and save.

Additional projects add to normal team access. They grant the selected active projects and their linked shared tasks, subject to client access and task links. They do not grant sibling projects, private tasks assigned exclusively to someone else, task editing or management duties. A work-team grant remains broader than a specific-project grant, so remove the work-team grant when narrowing access to projects only. Project grants are recorded in history and survive restart; removing them affects new selections while preserving running timers and historical entries.

## History

History appears below the editors and persists across reloads and backend restarts. It records the time, administrator name, team, affected members and each member's before/after client settings. A bulk save produces one history entry containing all selected members. History begins with saves made after this update; earlier changes are not reconstructed.

Both single and bulk saves use a MongoDB transaction. A stale version, changed team membership or failed audit write aborts the entire save. Nothing is published to the timer-picker snapshot until commit succeeds. The database must support transactions (MongoDB Atlas or a replica set).

Effective choices normally intersect active project links, the enabled team policy and an enabled employee policy. An employee policy with `overrideTeam: true` uses its selected clients independently of team client limits. Client access alone does not grant another team's projects; configure **Additional work teams** too when needed. Project links and task-assignment rules still apply. An enabled empty client selection blocks new timers and entries. Disabling a team client policy restores project-based selection; disabling an employee client policy restores client inheritance. Additional work teams are independent of the client-selection mode. Existing policies retain their previous behavior because `overrideTeam` defaults to false and `workTeams` and `workProjects` default to empty arrays.

These limits apply to the desktop activity-options API, timer Start, manual-entry options and submission, and changes to an entry's activity. Existing timers can finish normally. Unchanged historical activities remain editable, and stored times, assignments, billing and attendance are not rewritten.

Configuration is opt-in. No team or employee policy is created automatically and no existing project/client link is removed. Save Software → Upsilon in this page to restrict Software team members even when the Software project has additional clients.

## Deployment and persistence

Deploy the backend and dashboard. The existing desktop consumes the filtered activity-options response; this feature does not require a new desktop installer. Restart the backend before using the settings page locally.

Startup creates the additive `clientaccesspolicies` and `clientaccesschanges` collections and their indexes, then loads the policy snapshot before accepting requests. Writes use optimistic versions and update the snapshot before responding. As with the existing permission cache, exactly one backend instance is required (`render.yaml`). Change policies through this API; direct database edits need a backend restart to refresh the snapshot. No extra database policy read is added to timer heartbeats or activity polling.

`GET /api/client-access` returns minimal teams/employees, active clients and saved policies. `PUT /api/client-access/:type/:id` accepts `{ enabled, clients, version, overrideTeam?, workTeams?, workProjects? }`, where type is `team` or `employee`. Cross-team client mode is allowed only for enabled employee policies. Additional work teams and projects apply only to employee policies and must be active. Both endpoints require an administrator-level role and `manage_activity_links`.

`POST /api/client-access/employees/batch` accepts `{ team, employees: [{id, version}], enabled, clients, overrideTeam?, workTeams?, workProjects? }` for 1–500 unique active members of one team (`team: "unassigned"` for employees without a team). Omitted `workTeams` or `workProjects` preserves saved grants for older callers; an explicit empty array revokes the corresponding grants. `GET /api/client-access/history?page=1&limit=10` returns paginated history, newest first, including before/after cross-team mode, work teams and projects. Both use the same administrator and activity-link permission checks.

Verification: backend client-access unit tests and isolated MongoDB integration tests; `npm run test:client-access` in desktop-app runs the real dashboard against loopback fixtures and checks saves, failed-save retention, team isolation and responsive layout.


## Per-employee project client limits

Employee policy saves also accept optional `projectClients: [{ project: "<project ID>", clients: ["<client ID>"] }]`.
These limits narrow the enabled employee's effective clients for the specified project; they never grant additional clients,
projects or tasks. Projects omitted from the array inherit normal client access. An empty client list blocks that project's
new selections; an empty `projectClients` array clears the limits. Disabling the employee policy restores inheritance.
Omitting the field preserves existing limits, including saves from the current dashboard. Configuration is available through
the administrator API; the dashboard does not yet have per-project controls. Saves validate active projects and clients,
use optimistic versions and transactions, and record before/after limits in client-access history.

Activity options and project catalog cache keys include these effective limits. Timer starts, new manual entries and activity
changes to completed entries enforce them through the shared selection validator. Existing timers and historical selections
are retained. Deploy the updated backend before relying on stored limits; older backend versions ignore this additive field.
