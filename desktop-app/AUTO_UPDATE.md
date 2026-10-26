# CRM automatic updates: implementation and pilot release guide

## Version 1.2.32: automatic restart to install

Before 1.2.32 a downloaded update waited until the employee closed CRM.
From 1.2.32 CRM restarts by itself to install it, at a moment that cannot
interrupt work:

- no timer is running: CRM shows the login page, or the screen is locked
  because the timer is confirmed stopped (a break task counts as running);
- that has lasted one minute, and the PC has had no keyboard or mouse input
  for one minute (`RESTART_QUIET_MS` in `app-updater.js`).

CRM then shows "Updating CRM", runs the normal close handshake (the renderer
confirms with the server that no timer is running), installs silently and
opens again with the same sign-in. If the handshake is refused (for example
the server is unreachable) CRM stays open and tries again later, without the
"Timer stop not confirmed" warning. Closing CRM earlier still installs the
update on close, without reopening it.

Installed 1.2.31 and older copies still use their own updater, so they
install 1.2.32 the old way (on close) once; updates after 1.2.32 restart
automatically.

## Version 1.2.24: company shortcut repair

Version 1.2.24 adds Stop Break below the active break clock and an NSIS installer
hook in `build/installer.nsh`. After installing/updating CRM, the hook recreates
existing CRM desktop, Start menu and current-user taskbar shortcuts using the
newly installed executable and `com.handdy.timetracker` application identity.
The replacement is created locally, so it does not inherit the downloaded
shortcut's `Zone.Identifier` stream. Existing taskbar pins can point to the old
ZIP copy; the hook redirects the named CRM pin to the installed app. It does not
create a taskbar pin when there was none, change unrelated shortcuts, scan other
users' profiles, or change Windows security policy. It stages a new shortcut
and backs up the old one before replacement; a locked file is left intact.

This addresses the screenshot's blocked `CRM.lnk`. It cannot approve a blocked
installer or `CRM.exe`, or override company application-control policy.
Installer-generated shortcuts and trusted, signed executables are separate
requirements. The ordinary `npm run build` output remains an unsigned local
pilot when no signing credentials are configured.

For company releases, configure your trusted signing certificate/service in
the build environment, then run `npm run build:signed`. This command requires
code signing. `npm run publish` also now requires signing before uploading its
draft; credentials stay out of source and employee machines. Maintain the same
publisher identity for subsequent updates. A self-signed certificate is not a
substitute for a trusted public certificate unless company IT explicitly
deploys and allows it under its managed policy.

### Rollout to 20 employees

1. Test on one affected PC while Windows protection remains enabled. Confirm
   the installer and CRM executable are allowed; open the existing CRM taskbar
   pin and verify version 1.2.24 and Stop Break. Use the NSIS installer, not a ZIP
   containing downloaded shortcuts. Close CRM normally before deployment so
   an active timer is not interrupted by an installer.
2. If the company uses Intune/another management tool or domain deployment,
   have IT deploy `CRM-1.2.24-Windows-x64.exe /S` in each employee's user context.
   Configure retry/detection and use the real installation path from a pilot.
   The existing default is per user: running as LocalSystem repairs the system
   account's shortcuts, not the employee's. A machine-wide installation still
   repairs only the invoking user's taskbar pin. Other user profiles need a
   managed user-context install/repair.
3. If PCs are unmanaged, there is no central deployment channel in this
   project. Each employee needs the approved installer once, or IT needs to set
   up an authorized deployment channel. No individual Unblock steps are needed
   for shortcuts successfully recreated by the installer.
4. Later releases can use automatic updates only after employees have a working
   updater-enabled installation and public release hosting has been resolved.
   A blocked application cannot launch its own updater. Versions 1.2.22 and
   older require the initial installer deployment.

Run `npm run test:installer` on Windows after a build has populated the NSIS
cache. It compiles and runs the actual repair macro only inside isolated test
folders under `dist`, checking downloaded-file markers, target migration,
repeat installs, unrelated links, locked files and missing links/executables.
It never changes real desktop or taskbar shortcuts. A one-PC policy-enabled
pilot is still required; local tests cannot establish company policy approval.

References: [Microsoft Smart App Control guidance](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview),
[Windows signing configuration](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/),
[Intune Win32 deployment](https://learn.microsoft.com/en-us/intune/app-management/deployment/win32).

## Earlier baseline audit (1.2.23)

Prepared on 7 October 2026. Implementation is ready for a one-PC pilot;
no release has been uploaded or published, and no employee PC has been modified.
Public release hosting and Windows signing still need attention before rollout.

## Audit and resulting configuration

| Item | Audit finding / implementation |
| --- | --- |
| Main process | `desktop-app/main.js`, CommonJS |
| Package / version | `desktop-app/package.json`: previously `1.2.22`, now `1.2.23` |
| Builder | Existing electron-builder configuration in that package; installed `26.15.3` |
| Electron | Existing `44.1.1`; unchanged |
| Identity | `com.handdy.timetracker`, package `handdy-desktop-app`; unchanged |
| Display name | `CRM`; unchanged |
| Previously built | NSIS installer EXE plus ZIP; existing artifacts confirm both |
| New build | Windows x64 NSIS installer, EXE blockmap, generated `latest.yml` |
| Installer scope | Assisted installer, per-user default, elevation permitted, selectable directory; unchanged |
| Startup | Existing single-instance lock, window creation, session/device data, API resolution preserved |
| Previous updater | Custom Render/dashboard JSON check plus manual download-page prompt; no electron-updater or automatic installation |
| New updater | Packaged Windows applications only; GitHub Releases, automatic download, install on normal quit |
| Signing | No certificate/publisher/signing configuration or signing environment variables found; existing and new EXEs are `NotSigned` |
| Backend | Existing Render API configuration and operations unchanged |

The README previously mentioned `CN=Handdy Internal Code Signing`, but this
is not evidence of an active signing setup. Authenticode checks on local
installers `1.2.17` through `1.2.23` show they are unsigned.

## Files and dependencies

- `main.js`: replaces the Render manifest/manual-download updater with one updater startup call; preserves the timer-close handshake.
- `app-updater.js`: update lifecycle, retry scheduling, persistent logging and a nonblocking Windows notification.
- `package.json`, `package-lock.json`: version, dependencies, NSIS target, GitHub provider and scripts.
- `scripts/publish-release.cjs`: public-repository/version checks and draft publishing.
- `test/app-updater.test.js`, `test/release-config.test.js`, `test/updater-close.test.js`: updater failures, release validation, and the real NSIS quit hook with the main-process close guard.
- `AUTO_UPDATE.md`, root `README_MERGED.md`: release and pilot instructions.
- Root `.gitignore`: ignores local npm cache and signing-key files.

New runtime dependencies: `electron-updater` **6.8.9** and `electron-log`
**5.4.4**. `semver` is declared as a development dependency for release
version validation. Existing Electron/builder versions remain in place.

## Release repository: unresolved public-access requirement

You selected **ORUGANTIVINODKUMAR/handdy-workspace**. It is configured in
`package.json` under `build.publish`, with `provider: github`, `private: false`
and `releaseType: draft`. Builder embeds the feed in `resources/app-update.yml`.
No publishing credential is embedded in the feed or application.

The anonymous GitHub API request for this repository returned **HTTP 404**
during verification. It may be private or unavailable. It cannot currently
serve unauthenticated employee updates. The publisher refuses to upload until
anonymous repository access succeeds.

If it is private, provide the owner/name of a separate **public release-only
repository** and update those two `build.publish` fields before rebuilding
the baseline installer. Do not expose private source just to enable updating.
Verify the repository and its release assets in a browser signed out of GitHub.
Employees need neither a GitHub account nor a token. Publishing needs a token
with access to that repository and Contents read/write permissions.

Changing the destination after distributing the baseline requires keeping
the old feed alive long enough to deliver a migration update from it. Choose
the correct destination before the one-time employee installation.

## Runtime behavior

1. Start the installed CRM application. An update check runs after 15 seconds,
   allowing the window to open first. `npm start` does not check releases.
2. Check again every six hours while running. A failed check/download retries
   in 15 minutes; restart also schedules a fresh startup check.
3. Automatically download a newer stable version. Checks/downloads do not
   overlap. Prereleases and downgrades are disabled.
4. Show one optional Windows notification when ready. Notifications do not
   block work; errors showing them are logged.
5. Employee closes CRM normally. The existing renderer confirms the backend
   timer has stopped before the window closes. If this fails, CRM stays open,
   and the updater does not install.
6. electron-updater's supported quit hook silently starts the installer.
   It does not force the app to quit or automatically reopen it. Reopen CRM
   after installation completes to use the new version.

Installation relies on a normal, successful exit. A crash, forced termination,
or Windows shutdown can prevent/interfere with installation. Relaunch CRM and
close it normally after download; do not use Task Manager to apply updates.
Per-machine installations can require Windows elevation even though the
default remains per-user.

Logs are in `<existing userData folder>/logs/updater.log`, normally
`%APPDATA%/handdy-desktop-app/logs/updater.log`; the pinned existing profile
remains unchanged. Files rotate at approximately 1 MB. Logs include current
version, checks, available/no-update events, progress, download completion and
errors. Network failures do not stop login or other application operations.

## Build and publish commands (PowerShell)

From the project root:

```powershell
cd desktop-app
npm ci
npm test
npm run build
```

`npm run build` and `npm run build:win` explicitly use `--publish never`.
They produce:

```text
desktop-app/dist/CRM-1.2.23-Windows-x64.exe
desktop-app/dist/CRM-1.2.23-Windows-x64.exe.blockmap
desktop-app/dist/latest.yml
```

`resources/app-update.yml` is internal to the installed application. Builder
generates update metadata; do not write `latest.yml` by hand. Old artifacts
remain in `dist`, so use only the current version's files.

For the next release, after testing the actual fix:

```powershell
npm version patch --no-git-tag-version
npm test
npm run build
$releaseToken = Read-Host 'GitHub publishing token' -AsSecureString
$env:GH_TOKEN = [System.Net.NetworkCredential]::new('', $releaseToken).Password
try {
  npm run publish
} finally {
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  Remove-Variable releaseToken -ErrorAction SilentlyContinue
}
```

`npm run publish` builds and uploads the current version as a **draft** release.
It verifies anonymous repository access, rejects an existing `v<version>` release,
requires a stable version newer than the latest public stable release, and
forces draft mode even if publishing-related environment overrides are set.
It does not make the release visible to employee updaters. Review and publish
the draft on GitHub when ready. Do not run the raw builder publishing command
to bypass these checks.

Never reuse a published version or overwrite its installer/metadata.
If an upload leaves an incomplete draft, inspect it before retrying; this
script refuses any existing release for the tag. Remove only an unpublished
failed draft after review, or bump the version again. Recover from a bad public
release by publishing a corrected higher version, not by downgrading.

Only the build/publishing PC needs `GH_TOKEN`. Do not put it in JavaScript,
package configuration, committed `.env` files, or employee environments.
`HANDDY_API_URL` remains the existing optional backend override; it is unrelated
to the update provider. No Render environment changes or installer hosting
are required.

## Verify the GitHub release before making it live

Open the selected public repository's Releases page and review the draft:

- Tag and version agree, for example `v1.2.24` and `1.2.24`.
- It contains `CRM-1.2.24-Windows-x64.exe`, its `.exe.blockmap`, and `latest.yml`.
- `latest.yml` references that EXE and version, and its size/SHA-512 match the uploaded installer.
- It is a stable release, not a prerelease. Publish the draft when the pilot is ready; drafts are invisible to the updater.
- After publication, download the assets while signed out of GitHub to confirm anonymous access.

Keep previous installers/blockmaps available for differential downloads.
Never upload installer, blockmap or update metadata to Render.

## Test on one Windows PC first

1. Resolve the public repository requirement and rebuild **1.2.23** with its
   final destination. Configure signing before broader distribution if using
   signed production builds. Use a test Windows PC or VM with the current
   installer and the same installation scope/directory as employees.
2. Close existing CRM normally; back up its user-data directory while closed.
   Install `CRM-1.2.23-Windows-x64.exe` over the existing installation, without
   uninstalling. If the old copy was run from a ZIP, install the NSIS version
   and use its shortcuts instead of the old extracted EXE.
3. Launch the installed copy. Check `updater.log` for `Current version: 1.2.23`.
   Verify login/session preservation, attendance, timer, task selection,
   timesheets, and the dashboards used by the pilot employee.
4. Increase the development version to **1.2.24**, build and upload a draft with
   `npm run publish`. Verify the assets, then publish that stable release.
   Only the pilot PC should have the updater-enabled baseline at this stage.
5. Restart the installed **1.2.23** normally and wait at least 15 seconds.
   Logs should show **1.2.24 available**, progress and downloaded. Keep working
   during the download; the app must stay open.
6. While an update is ready, simulate a failed backend timer-stop request on
   the test PC. Confirm the existing close protection keeps CRM open. Restore
   the backend connection and close normally; timer-stop confirmation must
   happen before the update installation starts.
7. Wait for the installer to finish, reopen the same shortcut and confirm
   `Current version: 1.2.24` in a new log entry. Verify one CRM installation,
   preserved account/device data, correct timers and normal application work.
8. Reopen when **1.2.24** is the latest stable release and confirm no-new-version.
   Test with internet disconnected: CRM must remain usable and log a nonfatal
   check failure. Reconnect and restart or wait for the 15-minute retry.
9. For a download-failure test, use a fresh pilot snapshot/version pair and
   interrupt the network after an update becomes available but before the
   download completes. Confirm no installation occurs until download succeeds.
   Resume the connection and retry. Do not delete production release assets.
10. Only after this test succeeds, distribute the updater-enabled NSIS
    baseline to the other employees once. Future normal releases use the same
    GitHub feed and higher versions.

The currently installed older version cannot automatically acquire this
updater functionality. Its existing mechanism only directs users to download
manually. **One final manual installation of the new updater-enabled version
is required on employee PCs.** Actual older employee binaries were not provided
for inspection; this conclusion is based on the current source and build artifacts.

## Code signing and remaining risks

The generated pilot installer is unsigned. Windows SmartScreen/security
warnings remain possible; they cannot be eliminated by updater code. Obtain a
trusted Windows code-signing certificate or configure an approved signing
service. Supply signing credentials only in the build environment, for example
`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` (or `CSC_LINK`/`CSC_KEY_PASSWORD`). Keep the
same publisher identity across versions and verify Authenticode status on both
baseline and subsequent installers. Builder's default signature-verification
behavior remains enabled; no bypass was added.

The dependency audit reported **12 issues (8 moderate, 4 high)** in the existing
development/build dependency tree. The online production-only audit reported
**0 vulnerabilities**. Build-tool remediation is separate work; no broad
dependency upgrade or `npm audit fix` was applied here. Offline audit output
is not treated as security verification.

GitHub public-release hosting exposes the compiled installer publicly. Keep
private source and credentials in the source repository/build environment.
The selected repository currently fails anonymous access; this must be fixed
or replaced before any rollout. Existing README download-manifest instructions
were stale, and the referenced `dashboard/public/desktop-release.json` is absent;
the new updater does not rely on it.

## Verification completed

- All 64 Node tests passed, including the real NSIS close-hook test.
- 13 focused updater/release/close-hook tests passed, including offline,
  GitHub outage, no-new-version, failed download, restart, cancellation,
  duplicate release refusal and notification failure.
- Existing Electron inactivity smoke test passed.
- Existing React/dashboard lifecycle smoke test and dashboard build passed.
- Windows x64 NSIS build succeeded without publishing.
- Packaged ASAR includes updater module and runtime dependencies; feed contains
  the selected GitHub owner/repository and no credential; metadata SHA-512/size
  match the generated installer.
- Authenticode verification confirms the generated installer is unsigned.

A real GitHub download/install/version-transition test was **not** performed:
public hosting is unresolved and no releases were authorized for publication
in this implementation session. The one-PC pilot above remains required.

Official references: [electron-builder v26 automatic updates](https://www.electron.build/v26/docs/features/auto-update/),
[GitHub publishing configuration](https://www.electron.build/v26/docs/publish/),
[Windows code signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).
