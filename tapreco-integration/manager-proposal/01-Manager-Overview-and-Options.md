# Adding CRM to Tapreco: proposal for management

Prepared: 13 November 2026  
Status: proposal for discussion; integration is not implemented by these documents.

## Recommendation

Add **CRM as another tool in the Tapreco launcher**, alongside Mutual Fund, Estimated Tax, Entity Comparison and Audit Risk. Users should sign in through Tapreco and open CRM with the same account and navigation style.

Start with shared identity and linked clients while keeping CRM's operational database separate. This gives users an integrated product without requiring an immediate rewrite of employee attendance, desktop timers and production billing. If one PostgreSQL database is a firm requirement, use the migration path below rather than attempting a direct database connection-string change.

**Shared login, a shared client directory, one repository and one database are four separate decisions.** They can be delivered in stages.

## What we know today

| Area | Tapreco | CRM |
| --- | --- | --- |
| Main purpose | Tax calculations, workpapers and assessments | Employee work, projects, time, attendance, production and billing |
| Web UI | Four React/TypeScript applications, according to the supplied architecture notes | React dashboard in this checkout |
| Authentication | External portal handoff, Firebase identity and provisioned user context, according to the notes | CRM-issued JWTs, Employee records and device-specific AuthSession records |
| Database | PostgreSQL through the shared Tools API, according to the notes | MongoDB through Mongoose |
| Client records | Separate tool client tables described in the notes | Client collection linked to projects, tasks and time records |
| Access model | Tool records are owner-scoped; firm membership alone does not grant access | Roles, permissions, team/client restrictions and Production access rules |
| Desktop application | Not established by the supplied notes | Electron timer with operating-system idle detection |

Evidence boundary: CRM source was inspected locally. Tapreco findings come from the supplied [source-based architecture report](../tapreco.md), not a fresh inspection of the separate Tapreco repository or cloud deployments. The older [discussion-based report](../chatgpt.md) differs on hosting; live providers and domains remain to be verified before implementation.

## Three possible approaches

| Approach | What users receive | Database arrangement | Relative effort | Assessment |
| --- | --- | --- | --- | --- |
| A. Launcher shortcut | CRM tile opens the existing CRM | Existing MongoDB | Lowest | Useful navigation, but separate login and client duplication remain. Does not meet the full requirement. |
| B. Integrated CRM service | Common login, matching shell, linked clients and tool work, shared user identity | PostgreSQL for Tapreco/shared directory; MongoDB for CRM operations | Medium | Recommended first delivery. Requires explicit identity, firm and permission boundaries. |
| C. CRM rebuilt onto the shared platform | Same experience as B, with CRM persistence moved to PostgreSQL and platform conventions | Shared PostgreSQL, with dedicated CRM tables/schema | Highest | Best fit if one database is mandatory. Requires a deliberate data and application migration. |

Putting CRM in the Tapreco GitHub repository is compatible with B or C. Moving folders alone does not integrate authentication, permissions or data.

## Proposed user experience

1. Employee signs in through Tapreco.
2. Launcher shows CRM only if that employee has CRM access.
3. CRM opens with Tapreco branding, app switcher and account context.
4. Authorized employees choose a shared client and see linked CRM projects and permitted tax work.
5. A tool work item can open its CRM task. Desktop timer use remains explicit.
6. CRM produces time-based production and billing reports using its configured rules.

Example: a firm creates client **Example Services LLC**. Its Estimated Tax workpaper and Audit Risk assessment can link to the same business client. CRM can hold an Estimated Tax project/task for that client and record the employee time spent preparing the workpaper.

A client is not a project, and a tax workpaper is not a time entry. Linking these records preserves their different purposes.

## Recommended first release

- CRM tile, common navigation and portal sign-in.
- Explicit mapping from Tapreco users to existing CRM employees.
- Firm-scoped shared client identifiers and controlled linking of existing records.
- Ability to link one selected tool work item to a CRM project/task.
- Existing desktop timers, team permissions and employee/project billing rates retained.
- No automatic access to another user's tax work just because a CRM client is linked.

Automatic timer start, copying tax documents into CRM, company-wide client merging and full PostgreSQL migration belong outside this first release.

## Decisions this proposal recommends

| Decision | Proposed default |
| --- | --- |
| Shared authentication | Tapreco identity is authoritative for integrated users |
| CRM access | Separate entitlement and employee mapping; no automatic administrator role |
| Client identity | Shared firm-scoped identifier with links to each existing tool record |
| Projects and tasks | Owned by CRM; link them to tool work items |
| Tax calculations and documents | Remain in the relevant tool |
| Billing | CRM time-based billing remains distinct from tax estimates, subscription fees and client invoices |
| Database consolidation | Defer until integrated behaviour is proven; choose C if management requires one database |
| Rollout | Staging, a small pilot, then wider release |

These are proposed defaults, not approvals to migrate production data.

## Reading order

1. This management overview.
2. [Authentication, permissions and database architecture](02-Authentication-Permissions-and-Database.md).
3. [Client, project and tool-work linking](03-Clients-Projects-and-Tool-Linking.md).
4. [Phased delivery and acceptance plan](04-Phased-Delivery-and-Acceptance.md).

