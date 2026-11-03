# Phase 2 — Windows installer build and local pilot

**Follow-up:** Version **2.0.3** adds the requested running-break exemption from inactivity logout. Its local installer is `desktop-app/dist/CRM-2.0.3-Windows-x64.exe`; the 2.0.2 build/pilot results and hash below remain historical evidence for Phase 2. See [current break behavior](desktop-app/STARTUP_AND_SIGN_IN.md#running-break-tasks-203). The update must be distributed to affect installed employees.

**Date:** 2 November 2026  
**Candidate:** CRM **2.0.2**, Windows x64, NSIS installer  
**Status:** Local build and isolated installed-app pilot passed. Trusted signing and an actual Windows logon/company-policy pilot remain before employee rollout.

## Deliverable

- Installer: [CRM-2.0.2-Windows-x64.exe](desktop-app/dist/CRM-2.0.2-Windows-x64.exe)
- Updater files: `desktop-app/dist/CRM-2.0.2-Windows-x64.exe.blockmap` and `desktop-app/dist/latest.yml`.
- Installer size: **111,460,795 bytes**.
- SHA-256: `f30f3d8d4832d527a53cb5014dad119e30861572b65967872e39b45811c9137f`.
- Authenticode status: **NotSigned**. This is a local test candidate, not a signed company release.

The package and lockfile version increased from 2.0.1 to 2.0.2. The build used `--publish never`; nothing was uploaded or published. Generated installers are Git-ignored local artifacts.

## Verification results

| Check | Result |
|---|---|
| Production installer build | Passed with Electron 44.1.1 / electron-builder 26.15.3. |
| Packaged source | `main.js`, `renderer.js`, `preload.js` and `login-startup.js` match source byte for byte. Packaged version is 2.0.2. Pilot harness/settings are absent from the production ASAR. |
| Update metadata | `latest.yml` SHA-512 matches the candidate installer. |
| Actual NSIS shortcut macro | Passed marker removal, target repair, unrelated-link preservation, repeated repair, locked links and missing link/executable cases. |
| First installation | A uniquely named, per-user pilot installed successfully, with correct Desktop and Start menu shortcuts. Its installed executable completed first sign-in using synthetic credentials. |
| Upgrade | The pilot upgraded from version 2.0.1 to 2.0.2. Local storage marker, remembered credential and persistent device ID survived. |
| Windows startup registration | Packaged startup code created a real HKCU Run entry for the pilot's installed executable. Installed launches were tested with `System32` as working directory. |
| Automatic sign-in | After upgrade, the installed app renewed the remembered account once, selected No Project and its sole linked client, and left task unselected. No start-timer request occurred. |
| Explicit logout | The next launch stayed on the login form and did not automatically sign in. |
| Network failure | The login form remained usable and the remembered credential was retained. |
| Expired credential | The installed app returned to manual sign-in and cleared the expired remembered token. |
| Cleanup | The pilot uninstalled; its executable and temporary startup entry were removed. The real CRM startup entries were unchanged. |
| Desktop regressions | **133 unit tests and five browser checks passed**. Dashboard production build also passed, with the existing large-bundle warning. |

## Isolation and limits

The production-identity installer was built and inspected, but was not installed over the operator's current CRM. Installation tests used separate pilot identities, shortcuts, registration keys and workspace-only install/profile folders under `backend/.local-repairs/phase2-installer/`.

Pilot builds package the current application source plus a test-only entry harness. The 2.0.1 baseline is a **versioned fixture built from current source**, not the previously released 2.0.1 binary. This verifies NSIS version upgrade and profile retention, but does not establish compatibility with every historical employee profile.

The harness runs the actual main process, preload and renderer with `app.isPackaged === true`. It gives the application a unique pilot name/profile, intercepts HTTPS with a synthetic API, disables external update checks, and suppresses screen locking so the operator's desktop is not locked. Those harness changes are excluded from the normal installer. Production authentication, backend data, employee installations and actual timers were untouched.

A real Windows sign-out/reboot was **not** performed. The test verifies registration and equivalent executable launches, not execution by Windows during logon. Trusted publisher checks, SmartScreen/company allowlists, a clean employee PC, real old-version/profile upgrades, screen lock behavior and live server connectivity remain an installed company pilot. The test cleanup explicitly removes its pilot startup entry; it does not establish automatic startup-entry cleanup by the normal CRM uninstaller.

Initial harness attempts exposed test-environment issues: the host sets `ELECTRON_RUN_AS_NODE=1`, and Electron's default registry value name is `electron.app.<app name>`. The runner now clears that host flag for launches and checks the actual pilot entry name. The successful run covered all five installed stages and cleanup.

## Reproduce and evidence

From the repository root, on Windows:

```powershell
npm --prefix desktop-app run build:win
npm --prefix desktop-app run test:installer
Push-Location desktop-app
node test/build-installer-pilot.cjs
Pop-Location
$pilotManifest = Get-Content artifacts/phase2-installer-manifest.txt -Raw
& ./desktop-app/test/installed-upgrade-smoke.ps1 -Manifest $pilotManifest
npm --prefix desktop-app test
```

The pilot script installs/uninstalls only the uniquely named test app and temporarily registers it for the current Windows user's startup. Its synthetic profile and results remain in the Git-ignored repair directory for review. The runner restores the inherited Electron-as-Node flag afterward.

- `artifacts/phase2-windows-build.log`
- `artifacts/phase2-artifact-check.json`
- `artifacts/phase2-shortcut-installer.log`
- `artifacts/phase2-pilot-build.log`
- `artifacts/phase2-installed-upgrade.log`
- `artifacts/phase2-desktop-regression.log`
- Private pilot manifest/results pointer: `artifacts/phase2-installer-manifest.txt`.

## Remaining rollout work

1. Produce a trusted signed build using the company's signing setup, then complete a real Windows logon and employee-PC policy/upgrade pilot.
2. Deploy backend/website and publish/distribute the approved desktop release through the established release process.
3. Finish intentional project/client/task links and enable linked selection after employees receive the update.

No automatic Idle Break/default timer startup was added in this phase.
