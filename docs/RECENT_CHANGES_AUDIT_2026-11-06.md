# Recent CRM changes audit

Date: 2026-11-06. Scope: recent employee/client/project access grants, catalog caching, timer refresh changes, working-hours Overview and management-page UI. This is a source and regression audit with dependency-advisory checks, not a production penetration test.

## Findings and fixes

| Finding | Outcome |
|---|---|
| A null team reference could crash the new project-list team renderer | Fixed: `TeamList` ignores missing references and handles a missing/non-array list. The collection-page fixture includes an orphaned team reference and passes. |
| Missing, null or non-object client-access request bodies raised an internal error | Fixed: the controller rejects these with HTTP 400 before opening a database session. Regression coverage checks the validation status. |
| Backend development dependency `brace-expansion` had a high-severity advisory | Compatible patch installed: 5.0.9 to 5.0.12. Backend tests passed afterwards. |
| Desktop Electron 44.1.1 and several build dependencies had security advisories | Compatible fixes installed after the user confirmed CRM could close. Electron's package, executable file metadata and running CLI all report 44.10.2. CRM was closed through its normal timer-stop handshake. |
| Moderate development/build dependency advisories remain | Backend: 2; dashboard: 4; desktop lockfile: 6. These include `minimatch` and affected parent tools. No forced major-version changes or tool downgrades were applied. |

The dependency counts are npm's affected-package counts, including parent packages, not distinct vulnerabilities or confirmed exploit paths. The initial counts were backend 3, dashboard 4 and desktop 10. Updated dependency scans report no high or critical alerts. The installed desktop binary was independently verified as Electron 44.10.2; the earlier blocked update is now resolved.

Electron is listed under development dependencies because it packages the desktop app, but its binary is also the shipped desktop runtime. Its advisory must therefore not be dismissed as a development-only issue. One applicable advisory is [the Electron certificate mitigation](https://github.com/advisories/GHSA-jr5w-w6x2-84p9), which requires Electron 44.9.1 or later on this major line.

## Dependency changes

Backend and dashboard compatible updates were installed and tested. Dashboard ESLint remains on major version 10, updating from 10.8.0 to 10.14.0 with its compatible dependency tree.

The desktop now installs Electron 44.10.2, fixed `brace-expansion` versions 1.1.21/2.1.7/5.0.12, `fast-uri` 3.1.9 and fixed `undici` dependencies. Compatible build-tool updates include electron-builder 26.18.1 and semver 7.8.5. The application version is now 2.0.6, with the Electron minimum raised to `^44.10.2`. The older 2.0.5 installer does not contain these runtime fixes.

Raw advisory and test logs are local under `backend/.local-repairs/final-audit-2026-11-06/` and are excluded from Git. Dependency manifests and lockfiles contain the reviewable changes.

## Permission and timing checks

The reviewed paths retain the following boundaries:

- Additional work teams and specific-project grants do not move employees out of their primary team or grant management/report permissions.
- Specific-project grants do not grant sibling projects. Private tasks assigned exclusively to another employee remain inaccessible.
- Client limits and project/client/task mappings still apply to choices and submissions.
- Bulk policy writes and audit history are transactional, with optimistic versions; failed writes do not publish partial picker permissions.
- Catalog keys include the employee's effective additional work teams and projects, preventing reuse across different access scopes or after grant removal.
- Existing running timers and historical time survive access changes. The 20-second heartbeat and 90-second lease remain unchanged.
- Team logos and illustration blocks use local SVG/CSS and introduce no external image requests.

No additional confirmed permission bypass or time-calculation regression was found in the reviewed paths and exercised tests.

## Verification

| Check | Result |
|---|---|
| Backend unit tests after fixes | 319 passed |
| Isolated database integration tests after fixes | 57 passed |
| Dashboard tests | 98 passed |
| Dashboard lint, route audit and production build | Passed; route audit covers 47 static targets and 69 registered routes |
| Desktop unit tests on Electron 44.10.2 | 153 passed |
| Complete desktop npm test suite on Electron 44.10.2 | Passed: startup, idle/logout, lifecycle, linking, entries, Overview, project/task, working-hours, client-access, catalog and collection-page checks |
| NSIS shortcut fixture after the runtime update | Passed |
| Collection-page regression with a missing team reference | Passed against the rebuilt fixed dashboard, including mobile layout and Add dialogs |

The complete desktop command passed after the updated runtime was installed and the fixed dashboard was rebuilt. Tests use loopback fixtures and isolated profiles; no employee deployment is performed by the test suite.

Vite still reports large optional export chunks. The build succeeds; that warning is separate from repeated API/download traffic.

## Verified desktop release

Local release **CRM 2.0.6** uses **Electron 44.10.2** and supersedes the earlier 2.0.5 installer for these runtime security fixes.

- Installer: `desktop-app/dist/CRM-2.0.6-Windows-x64.exe` (120,653,814 bytes).
- Matching files: `CRM-2.0.6-Windows-x64.exe.blockmap` and `latest.yml` in the same folder.
- Installer SHA-256: `05969e89b5fa0fc87e376971b8e382ed9cd03dd4c6f338064b88795263ca5fe2`.
- Both SHA-512 entries, filename, size and version in `latest.yml` match the installer.
- All 12 packaged source files match the workspace, the packaged application is 2.0.6, and three core runtime resource files match the verified Electron 44.10.2 installation.
- Windows reports the installer as **NotSigned** because no publisher certificate is configured. Integrity verification does not provide publisher signing.

The build used `--publish never`. No release was uploaded and no employee installation was performed. Publish or distribute the matching 2.0.6 artifact set together; do not pair the current `latest.yml` with an older installer.

## Remaining actions

1. Review and distribute the new 2.0.6 release artifacts after their local build verification. Employee installation and publication remain separate actions.
2. Resolve remaining moderate build-tool advisories through reviewed upstream upgrades or targeted compatibility work. Do not use `npm audit fix --force` as an automatic remedy.
3. Deploy the backend and dashboard fixes through the normal release workflow. No push, production deployment, GitHub publication, employee installation or production data write was performed by this audit.
4. After rollout, collect comparable Render metrics to measure bandwidth savings. This audit does not establish production MB savings.
