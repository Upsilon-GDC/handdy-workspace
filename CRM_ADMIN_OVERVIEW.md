# Admin team Overview

Implemented locally on 2026-11-03. Open **Workspace → Overview** (`/admin/dashboard`). Deploy the updated dashboard to make this available on the hosted website.

## What the page shows

- A company summary: people working now, worked hours, break hours and idle hours.
- A card for each team with recorded hours, people working or on break, people with no active timer, and projects currently being worked on.
- Click a team to see members, their current timer status, project/task, and individual work/break/idle totals. Search members by name, employee ID, project or task, and filter by status.
- Today, this week, this month or a custom date range for recorded hours. Changing the period leaves current activity tied to today.
- Team search, manual refresh and automatic refresh every 30 seconds while the page is visible. Returning to the page or coming online also triggers refresh.
- Links to the detailed timesheet and, for Admin/Alpha/Managers, entry corrections. Detailed timeline editing remains in the entry/report pages.

The previous Overview permission guard is retained. Alpha accounts are excluded from the roster and totals, matching the entry employee picker.

## Meaning of the numbers

**Working now** means the latest report response contains a running work timer. A running Break task or intentional paused break is shown as **On break**. Idle and other paused timers are identified separately in the member list. No active timer does **not** mean the employee is absent or offline. This page does not infer computer presence or attendance.

Hours use the selected report period and are displayed to whole minutes. Work totals exclude Break tasks. Break totals include Break tasks and intentional breaks. Idle totals include recorded idle pauses and calculated same-day gaps between sessions, consistent with detailed reports; overnight gaps are excluded. All dates use the application's Asia/Kolkata timezone.

Team totals follow employees' **current team membership**. Moving an employee to another team moves their historical hours into the current team's overview total; this is not a historical team assignment ledger. Inactive or unavailable employees with report history remain identifiable so their hours are retained.

On refresh failure the previous successful snapshot stays visible with a warning and last-known status labels. An initial failure shows an error rather than fabricated zero totals.

## Data and deployment

The page reads existing employee, team and paginated admin time-log APIs. It does not write to MongoDB or change roles, assignments, entries, timers or database schemas. Reports are fetched across all pages before aggregation; large date ranges can take longer because this implementation uses existing report APIs rather than a new aggregate endpoint.

Deploy the dashboard build using the existing hosting process. No new backend migration or desktop installer is required for this feature. Local browser verification used a synthetic API fixture, not production employee data.

## Verification

- Dashboard unit suite: 79 passed, including 6 Overview calculation tests.
- ESLint and route audit passed (43 navigation targets, 65 routes).
- Production dashboard build passed; the existing bundle-size advisory remains.
- Overview browser smoke passed: totals, live status, team/member search, member selection, historical period vs current status, hidden Alpha accounts, refresh failure/recovery and mobile width.
- Existing dashboard browser regression passed, including permissions, navigation, reports, exports, device/session flows and Teams polling.

Key implementation: `AdminOverviewPage.jsx`, `utils/adminOverview.js`, `styles/adminOverview.css`. Browser check: `npm run test:overview` in `desktop-app` after building `dashboard`.
