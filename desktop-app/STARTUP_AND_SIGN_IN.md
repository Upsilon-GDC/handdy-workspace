# Windows startup, automatic sign-in and initial selection

Implemented 2 November 2026. This changes desktop startup; website login is unchanged.

## Employee flow

1. Install the updated Windows desktop application and open it once. Packaged CRM registers its installed executable to open when that Windows user signs in. Development Electron runs do not register themselves.
2. On the first successful sign-in, enter email/password. Existing remembered-session behavior saves a revocable credential; this feature never stores a password.
3. On subsequent launches, a valid existing session opens the timer screen. If an access session needs renewal, CRM automatically uses the remembered credential through the existing quick-login API.
4. If the server confirms there is no active timer, CRM selects the unique active, accessible **No Project** record, its unique available **Upsilon** client, and the unique available **Break** task whose actual type is `break`. Names are matched exactly, ignoring case and surrounding spaces. Mapped projects require Break to be linked to that project/client and permitted for the employee.
5. No timer starts automatically. The employee presses Start (or changes the activity first). Blank overlays cover the desktop on every monitor, while CRM stays visible for selecting and starting the timer. The overlay remains during the Start request and is removed only after the backend confirms a running timer. A refused start leaves it locked. Existing connectivity, crash and shutdown recovery behavior remains in place.

An existing running or paused timer is restored with its actual project, client and task. Startup defaults do not interrupt it. Background refresh/reconnection does not repeatedly reset the employee's selection.

## Running break tasks (2.0.3)

A running task whose actual `taskType` is `break` (for example Lunch or Break) is exempt from desktop inactivity stopping and automatic logout, even after hours without keyboard/mouse activity. The employee must explicitly stop/end it or sign out. Merely naming a work task "Break" does not change its type. Normal work/no-timer inactivity rules remain in effect; legacy paused work records are not granted this exemption.

The application must remain running and connected: existing server heartbeat/disconnection safeguards, session revocation and explicit app-close behavior still apply. This change does not keep a timer alive after a shutdown or loss of its desktop lease. Source and installer updates are local until distributed.

## Account and network handling

- First use without saved credentials shows the normal login form.
- Expired/invalid remembered credentials or inactive accounts return to email/password entry. Normal device-approval requirements are still enforced.
- Manual sign-out pauses automatic sign-in until the employee explicitly uses Continue or successfully signs in again. The remembered account remains available for Continue. Choosing another account clears that remembered credential.
- Inactivity sign-out continues to revoke/remove the remembered credential. Revoked-session messages also suppress automatic reauthentication.
- A failed network/server request retains a valid saved credential and shows a retry message; it does not loop through login requests or call the credential expired merely because the server is unavailable. Continue retries the existing quick-login flow.
- A damaged/missing local user profile can recover through the remembered credential instead of becoming stuck behind an unusable access token.

## Default project/client rules

The startup default is resolved from the authenticated active project catalog by the exact normalized name `No Project`. Only a unique match is selected; missing/duplicate records are not created, merged, renamed or guessed. The database is not modified by startup.

For No Project, client choices come from its actual `clients`/legacy `client` references intersected with the active client catalog, or the project's authenticated activity options. Inactive/missing references do not become choices. Upsilon is selected by its unique normalized name among those permitted choices; IDs are never hardcoded. Missing or duplicate Upsilon clients leave the client/task unselected with a configuration message. Missing, duplicate or work-typed Break tasks leave the task unselected. Configure records and activity links through the website; startup does not create database records.

The desktop now loads project-specific activity choices. Projects with explicit client references show their active linked clients. Enabled mapped projects show only active tasks linked to the selected project/client pair and permitted for the employee; client changes clear the task choice. An administrator enables this policy per project after completing links and updating installed desktops. Legacy projects retain task selection compatibility until enabled. See [activity-link implementation and rollout](../CRM_ACTIVITY_LINKS_IMPLEMENTATION.md).

The default is applied only after an authoritative no-active-timer response. An unavailable server is not treated as proof that no work is running. No Lunch, Break, Idle Break or Debugging activity is automatically started, and no attendance or billing record is created just by opening the screen.

## Packaging and rollout

`login-startup.js` is included in the Electron package. Registration is attempted after readiness and only in the instance owning the single-instance lock. Startup-registration failure is nonfatal. Existing second-instance behavior brings the existing CRM window forward.

A new Windows desktop release is required to deliver this feature to installed employees. Editing source or deploying the backend/website does not update their installed application. Registration takes effect after the updated installed application has launched once. Windows sign-in is the trigger, not powering on before Windows login or every screen unlock.

A local 2.0.2 installer has been built, and an isolated installed-app pilot passed upgrade/profile retention, real pilot startup registration, automatic sign-in, logout, offline and expired-credential checks. Temporary pilot registration was removed and the real CRM startup entries were unchanged. Nothing was published. The candidate is unsigned; trusted signing and a real Windows sign-out/sign-in or reboot on an employee pilot PC remain before rollout. See the [Phase 2 report](../CRM_WINDOWS_INSTALLER_PHASE_2_REPORT.md).

## Verification

- Desktop Node tests cover packaged-only registration, registration failure, automatic quick-login/credential rotation, first-use fallback, expired/disabled accounts, network/server errors, explicit logout, approval denial, default project/client selection and active/unknown-state preservation.
- The new real-page Electron smoke uses the actual preload and HTML with the existing CSP enabled. HTTPS is intercepted only within an isolated mock session, so it cannot reach production. It verifies automatic sign-in, No Project's linked client, no automatic timer start, active-session restoration and sign-out pause.
- `npm run test:startup` runs that smoke, including mapped task changes between clients. `npm test` includes it alongside unit, inactivity, dashboard, activity-link and manual-entry smoke suites.
- Review image (private/Git-ignored): `backend/.local-repairs/startup-review/timer-default.png`.
- Current full-run evidence: `artifacts/phase2-desktop-regression.log`. Installed pilot evidence: `artifacts/phase2-installed-upgrade.log`. Real Windows logon and company-policy behavior remain pilot checks.
