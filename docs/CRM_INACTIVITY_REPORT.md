# CRM desktop inactivity implementation

## Current policy update - 2 November 2026, desktop 2.0.3

Running tasks classified as taskType "break" now continue through hours of inactivity without automatic stop or logout. Employees explicitly end the break or sign out. Work tasks, sessions without a timer and legacy paused work records retain their inactivity policy. Application disconnection/heartbeat safeguards still apply. This supersedes older descriptions below that apply inactivity logout to every task type. See desktop-app/STARTUP_AND_SIGN_IN.md for current behavior.

Verification: multi-hour idle unit regression and the actual Electron page with eight simulated idle hours followed by manual Stop Break. Evidence: artifacts/break-inactivity-desktop-tests.log.

## Existing behavior reviewed

The desktop renderer polls `powerMonitor.getSystemIdleTime()` through the existing sandboxed preload IPC every five seconds. It already pauses through `/time-logs/pause` with reason `idle` and resumes an idle pause when system idle time falls to two seconds or less. The existing backend pause default is **5 minutes**, with a supported range of **1–240 minutes**; these conventions are preserved.

`/auth/logout` already increments the employee tokenVersion. Manual desktop logout already calls that endpoint and clears local token/user data. This API and its JWT/role checks are unchanged. Because tokenVersion is shared, logout can invalidate other existing sessions for the same employee, including web sessions; this is existing backend behavior.

The admin Idle and Logout section already existed, but only the pause threshold was saved to SystemSettings. Its logout field was previously browser-local and unused by the desktop monitor.

## Modified files for this task

- `backend/src/models/SystemSettings.js`: optional autoLogoutMinutes, integer/range and document cross-field validation. No new collection.
- `backend/src/controllers/settingsController.js`: read/write both thresholds through the existing protected endpoint; normalize legacy records; accept old callers that send only the pause threshold.
- `dashboard/src/api/settingsApi.js`: send both values.
- `dashboard/src/pages/admin/AdminSettings.jsx`: load/save both controls, shared defaults, clear labels/help and validation.
- `desktop-app/main.js`: expose shared defaults through IPC; single-instance lock prevents competing desktop instances.
- `desktop-app/preload.js`: expose only the safe defaults IPC accessor; sandbox remains enabled.
- `desktop-app/renderer.js`: extend the existing idle loop, serialize timer actions, pause-before-logout, prevent duplicate logout, clean up intervals, validate restored sessions, and require manual Resume for restored paused timers.
- `desktop-app/package.json`: include defaults JSON in packaging; add desktop test script.
- `CRM_BRANDING_REPORT.md`: prior task build outcome updated after artifact verification.

## Created files

- `desktop-app/idle-policy-defaults.json`: shared defaults and limits used by backend, dashboard and desktop (via main/preload IPC).
- `backend/src/utils/idlePolicy.js`: backward-compatible normalization and validation.
- `backend/test/idlePolicy.test.js`: defaults, bounds, relationship and model tests.
- `desktop-app/test/inactivity.test.js`: actual renderer evaluated with simulated DOM/API/idle inputs.
- `desktop-app/test/electron-inactivity-smoke.cjs`: real hidden Electron window, real renderer and sandboxed preload, isolated temporary profile, localhost mock API, simulated OS inactivity.
- `CRM_INACTIVITY_REPORT.md`: this report.

## Flow and guarantees

1. The existing OS idle duration is the only activity signal. No input content, mouse coordinates, screenshots or website data are collected by this change.
2. At the pause threshold, a running timer pauses using the existing API. Before logout, the original automatic resume rules remain active.
3. At the logout threshold, the single monitor sets a pending flag, prevents further timer actions and waits for an already-submitted timer action.
4. It fetches the current backend timer. If running, it calls the existing pause API with a manual pause reason, ensuring security logout also works for idle-exempt employees or when exemption settings could not be loaded. An already-paused timer is left unchanged.
5. Only after confirming pause/no active running timer does it call the existing logout endpoint, clear token/user data, cancel local intervals and return to the login page with “You were signed out due to inactivity.”
6. No stop or start endpoint is used by automatic logout. The existing backend timer record remains active and paused.
7. After authentication, the app validates the session and fetches the same active timer. A restored paused timer never automatically resumes; the employee must click Resume. This also applies after app restart.

`idleCheckInProgress` serializes idle polls; `logoutInProgress` prevents overlapping logout operations; `logoutPending` blocks further timer changes/automatic resume; the timer-action promise waits for an already-submitted action. Interval cleanup runs on logout and unload. Single-instance locking prevents a second desktop process from running another monitor against the same profile.

Logout also applies with no active timer and to idle-exempt employees. Activity before the logout threshold resets the OS idle duration naturally; no countdown based on an earlier timestamp is retained.

## Defaults and validation

Defaults are 5 minutes for pause (existing default) and 30 minutes total inactivity for logout. To use the requested example, set 10 and 30 in Admin Settings. No temporary 1/2-minute settings were saved to production.

Pause: integer 1–240 minutes (existing bounds retained). Logout: integer 2–480 minutes and strictly greater than pause. Legacy settings without logout use max(30, idle threshold + 1), so an existing 240-minute pause configuration remains valid. A failed settings refresh retains the last valid policy; initial settings failure uses shared defaults. The existing Render root checkout must continue including desktop-app/idle-policy-defaults.json, which backend and dashboard now share.

## Verification

- Dashboard lint: passed.
- Dashboard production build: passed; existing large-chunk warning remains.
- Dashboard tests: 2 passed.
- Route audit: passed, 43 targets and 86 routes.
- Backend tests: 28 passed, including 3 new idle-policy tests.
- Desktop renderer tests: 6 passed, covering the requested ten behavior cases through combined scenarios.
- Syntax checks: desktop main/preload/renderer passed.
- Real Electron integration smoke test: passed. With a local simulated backend and accelerated idle samples of 60/120 seconds, login -> pause -> logout/message -> login -> same paused timer -> manual Resume succeeded. This tests real navigation and preload sandbox compatibility, not merely source patterns.
- No production credentials, MongoDB writes, real SMTP messages, release uploads or deployment were used in testing.
- Installer result and hash are appended after the final build finishes.

## Remaining manual checks and limitations

- Perform a staging test with actual OS inactivity at 1/2 minutes, then restore your intended 10/30 or existing pause policy. Verify Windows lock/sleep/wake, minimize behavior, network loss/recovery and an upgrade over the installed version. The automated Electron test simulates idle duration; it does not prove real elapsed Windows idle/sleep behavior.
- If the server cannot confirm a running timer is paused, the app locks timer actions, retains the credentials required to pause, shows a connection message and retries through the existing loop. **Full logout is delayed during this outage**. It deliberately does not falsely claim a backend pause or leave a known running timer by discarding credentials. Force-quitting/offline operation cannot guarantee a server-side pause.
- An expired/revoked session cannot pause a server timer. The app clears local authentication after a 401/403; any still-running backend timer requires reconciliation after valid login. Once pause is confirmed, failure of the logout request still allows local sign-out, but server-side token revocation cannot be guaranteed during that failure.
- The existing backend logout revokes other sessions through tokenVersion, as noted above.
- Publish/deploy only when ready. No new environment variable is required; HANDDY_API_URL and VITE_API_URL are preserved. Version remains 1.2.0; choose a newer version and rebuild before publishing if existing installations should receive an update prompt.
- Existing login, manual logout API behavior, attendance, task/project loading, timer calculations, stop semantics, billing, reports, backend API URL and MongoDB account models remain unchanged. Settings schema and desktop session behavior changed only as described above.

## Final installer verification

Electron build passed (exit 0). Generated desktop-app/dist/CRM-Setup.exe (111100256 bytes) and desktop-app/dist/win-unpacked/CRM.exe. Signature status: NotSigned. SHA-256: 0606DB67EBC8210DFAF7DAA1CC74913BE698137323092683D994372921786601. Old Handdy-Setup.exe is still present. No signing certificate or release URL was changed.

