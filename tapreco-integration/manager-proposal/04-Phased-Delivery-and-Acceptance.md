# CRM integration delivery plan

Prepared: 13 November 2026  
Status: proposed implementation stages. This document package changes no application behaviour or production data.

## Delivery principle

Deliver a familiar Tapreco experience first, while protecting the existing CRM timer and business history. Each stage has a concrete result and a release gate. Estimates should follow inspection of the actual Tapreco/portal repositories and environments; these documents do not claim a fixed delivery date or hosting cost.

## Phase 0: confirm contracts and establish staging

**Work:** Inspect the actual four-tool and portal code, application registration, identity provisioning, firm membership, owner-scoped access, deployment configuration and migrations. Compare those facts with the supplied report. Inventory CRM sessions, employees, clients, projects and retained billing records without changing them.

**Result:** An agreed integration contract, backup/restore procedure, anonymized or isolated staging data, and selected approach B or C from [the overview](01-Manager-Overview-and-Options.md).

**Gate:** No live credentials in source; staging cannot send production notifications or write to production databases. Portal team and CRM team agree who owns login, membership, directory and operational data.

## Phase 1: add CRM as a Tapreco tool

**Work:** Add the launcher tile, entitlement visibility, common branding, navigation and app switching. Prepare the CRM web build and independent API deployment. If code is moved into the Tapreco monorepo, retain independent build/deployment boundaries and do not commit desktop installers.

**Result:** CRM looks and opens like another Tapreco tool.

**Gate:** Direct links, refresh, app switching and missing-entitlement behaviour work. Clearly label this stage incomplete until shared sign-in is delivered; a launcher shortcut alone is not SSO.

## Phase 2: shared login and controlled employee mapping

**Work:** Implement portal handoff and the verified identity-to-CRM-session exchange. Map approved platform users to existing employees. Introduce external-auth account handling, entitlement checks, platform membership revalidation and explicit logout propagation.

**Result:** Pilot users use their Tapreco identity to open CRM without a second CRM password.

**Gate:** Tests cover expired tokens, replayed handoffs, disabled users, revoked CRM sessions, removed firm membership, unprovisioned users, multiple firm contexts and forbidden role escalation. Existing CRM sessions and timer behaviour have an explicit compatibility path.

Start with one explicitly bound firm. Before enabling unrelated firms, complete firm scoping across models, queries, indexes, caches, background jobs, exports, session controls and operational locks. Do not enable multi-firm access based only on a new `firmId` field.

## Phase 3: shared client directory and approved links

**Work:** Introduce shared client IDs and external links. Build a review screen for existing client matches. Integrate minimal directory updates using durable delivery, deduplication, version checks and retry/reconciliation.

**Result:** A client can be recognized across the four tools and CRM without duplicate manual creation for each integrated workflow.

**Gate:** Tests cover same-name clients, different firms, owner-private tool records, repeated create requests, delivery outages, out-of-order updates and client archives. No historical time/billing IDs are rewritten. Uncertain mappings stay pending.

## Phase 4: project/task links and time-based reports

**Work:** Add explicit tool-work-to-CRM linking. Connect authorized client/project/task selection and permitted summaries. Reuse employee/project rates and existing Production classifications. Add desktop handoff only with an explicit tracking action and a verified device-session design.

**Result:** Manager can connect a tax work item to CRM work, see who worked on it, and download the related CRM time/billing report.

**Gate:** Cross-team selection, employee scope and linked-document permissions remain enforced. Training and Break / Idle remain excluded according to CRM rules. Opening a workpaper does not fabricate work time, change rates or silently make a task billable.

## Phase 5: pilot and production rollout

**Work:** Pilot with a small set of employees, including a manager and a team lead. Compare reports with the existing CRM, record support issues and verify login/logout across tools. Measure API/database traffic, timer start responsiveness and integration queue failures.

**Result:** A tested release with operating instructions, support ownership and a rollback procedure.

**Gate:** Representative reports reconcile; no unauthorized cross-firm/owner access; existing attendance and timer flows pass regression tests; backups restore; integration failures are visible and recoverable. Roll out gradually after pilot acceptance.

Retain the existing desktop idle policy unless a separately authorized change is made. Do not use a browser-only replacement as proof of system-wide inactivity detection.

## Optional Phase 6: consolidate CRM onto PostgreSQL

This is required if management selects approach C. It is not a hidden prerequisite for approach B.

1. Design CRM SQL tables, memberships, constraints and immutable historical references.
2. Replace MongoDB/Mongoose persistence and aggregation logic behind tested service interfaces.
3. Implement SQL timer/session concurrency, lease expiry, activity linking and billing calculation equivalents.
4. Run repeatable trial migrations on isolated copies, with old-to-new ID maps.
5. Compare counts, references, pause/work seconds, attendance, rate applicability and billing totals, including historical corrections.
6. Agree a maintenance/cutover window, freeze writes or capture a controlled final delta, and avoid simultaneous uncoordinated writers.
7. Switch the pilot, reconcile, then widen access. Retain the old database as read-only for the agreed recovery period.

Rollback after new SQL writes needs reconciliation; it is not simply pointing the app back to an older MongoDB snapshot. Define the recovery point and how new records will be preserved before cutover.

## Minimum end-to-end acceptance scenarios

| Scenario | Expected outcome |
| --- | --- |
| Portal login then CRM launch | Correct mapped user/firm; no second password |
| User lacks CRM entitlement | Tile hidden where appropriate and API access denied |
| User changes an ID to target another firm | API and exports deny access |
| Shared client has another owner's workpaper | No automatic workpaper disclosure |
| Create/link request is retried | One logical mapping, not duplicate clients/tasks |
| Directory service is temporarily unavailable | Clear pending state; safe retry; existing permitted CRM work continues where policy allows |
| Platform access is revoked | CRM access ends within the agreed bound; desktop behaviour follows the tested revocation policy |
| Employee opens a tax tool | No automatic billable timer starts |
| Employee records permitted work | Correct client/project/task, idle handling and employee project rate |
| Client or work item is archived | Historical time and billing remain explainable |
| User downloads a report | Same permission scope and totals as the displayed report |
| Shared infrastructure fails | Recovery and rollback behaviour are documented and exercised |

## Operational ownership

| Area | Proposed accountable owner |
| --- | --- |
| Portal registration, identity and membership | Tapreco platform team |
| Shared client directory and tool adapters | Platform/integration team |
| CRM employee mapping and permissions | CRM administrator and CRM team |
| Timers, attendance, rates and Production | CRM team |
| Infrastructure, secrets, backups and release monitoring | Deployment owner |
| Pilot approval and final business acceptance | Manager/product owner |

## What is being proposed for approval

Proceed with approach B: shared launcher, shared authentication and controlled client/work linking, while retaining CRM operational storage initially. Treat full PostgreSQL consolidation as a separate, costed stage if required. This provides a usable integration without coupling a login change to a complete rewrite of time tracking and billing.

