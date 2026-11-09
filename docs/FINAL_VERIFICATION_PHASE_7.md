# Phase 7: final verification

Date: 9 November 2026. **All seven local implementation/verification phases are complete. The workspace is ready for staging validation; production rollout still requires the release checks below.** No push, production data write, deployment, release publication or employee installation was performed.

## Results

| Check | Result |
| --- | --- |
| Backend unit/regression suite | 339 passed |
| Disposable MongoDB integration/recovery suite | 73 passed |
| Dashboard unit suite | 98 passed |
| Desktop unit suite | 154 passed |
| Full desktop `npm test` including Electron GUI fixtures | Passed |
| Dashboard ESLint | Passed |
| Dashboard route audit | Passed: 47 static targets, 69 routes |
| Dashboard production build | Passed; existing large-chunk warning |
| Isolated NSIS shortcut fixture | Passed |
| Separate Windows x64 validation package | Built successfully |
| Packaged source comparison | All 12 source assets match the workspace |
| Update metadata | Version, filename, size and both SHA-512 entries match installer |
| Blockmap | Present and valid gzip/JSON |
| Workflow YAML and installed builder signing schema | Validated locally |
| Diff whitespace | Passed |

**664 passing unit/integration tests**, plus the full Electron GUI and isolated NSIS fixtures. GUI coverage includes idle/logout, startup/sign-in, dashboard lifecycle and permissions, activity links, manual-entry lost-response retries/deletion, corrections, overview, project/multiple-project tasks, batch links, working hours, client access, catalog caching and management collections. These fixtures use synthetic records/loopback services; they are not a production end-to-end test.

## Final review correction

The combined review found an additional team-edit permission race. Older clients can submit an unchanged lead while renaming a team. Previously the guard allowed that field through, permitting the handler to reapply an old assignment if an authorized concurrent change occurred between reads. For users without assignment authority, the accepted unchanged field is now removed before the write handler. Renaming remains allowed; lead reassignment cannot occur through that redundant field. A regression simulates the concurrent change and asserts the new lead survives without employee-assignment calls. The complete backend suite was rerun after this correction.

No generated tracked screenshots or PDF/Excel exports were retained as source changes; test outputs were restored to their pre-run repository versions.

## Validation package

Output: `desktop-app/dist/phase7-validation-cb36badf/`.

- Installer: `CRM-2.0.6-Windows-x64.exe`.
- Size: 120,653,849 bytes.
- SHA-256: `9293ceaf1729e948707a4acc9ff41e88b93503944ea90246d2d35c0eb8995298`.
- Matching blockmap and `latest.yml` were generated and checked.
- Windows signature: **NotSigned**, intentionally built without signing credentials.

This is a local validation artifact, **not a release to distribute**. The existing installer/output files outside this separate folder were preserved. Version 2.0.6 was retained for testing; choose a new version greater than the public stable release before an authorized publication. No installer was executed to install CRM. The NSIS test executes only its isolated shortcut-repair fixture.

## Fresh dependency scans

| Project | Moderate affected-package alerts | High | Critical |
| --- | --- | --- | --- |
| Backend | 2 | 0 | 0 |
| Dashboard | 4 | 0 | 0 |
| Desktop | 6 | 0 | 0 |

All affected nodes in these scans are marked as development dependencies in their lockfiles. Backend findings involve `minimatch`/`nodemon`; dashboard findings involve ESLint/config tooling and `minimatch`; desktop findings involve electron-builder and related build tooling. These are affected-package counts, including parents, not distinct vulnerability totals. The scans are not a penetration test.

The remaining advisories need a reviewed maintenance update. Several suggested remedies are major-version changes/downgrades; no forced dependency changes were applied during final verification. No high/critical advisory was reported in the scanned installed dependency trees. Electron remains a shipped runtime even though its package is a development dependency; it must continue to be assessed as such.

## Requirements before production distribution

1. Provision a valid publisher certificate, configure the explicit publisher/signing credentials, build a new signed version, and obtain a positive installer signature/publisher check. Test the upgrade from the actual installed unsigned client. Signing was prepared, not completed.
2. Run the prepared GitHub Actions workflow after an authorized push and configure required branch checks. Hosted installation/execution and branch protection were not verified locally.
3. Test the oldest supported installed client in staging: successful 20-second heartbeats, expiry/reconciliation, and handling/migration of retired attendance endpoints.
4. Review/reconcile existing null-heartbeat timers and historical open legacy attendance using the phase-specific procedures. Do not invent historical contact/checkout timestamps.
5. Perform and record a production-representative backup/restore drill, review recovery findings and representative permissions/reports/billing samples, and confirm actual managed backup settings. Local recovery tests do not establish Atlas recovery capability.
6. Keep a single API writer process, including deployment handoff; pause writes during the controlled cutover. Current queues, caches and rate limits do not coordinate multiple instances or direct database writers.
7. Review the moderate development/build-tool advisories and remaining bundle-size/default-icon warnings as maintenance work. Confirm release artifact hashes and monitoring after the authorized rollout.

These requirements are recorded limits, not actions executed during this phase. The source changes remain uncommitted in the workspace for review.

## Evidence

Logs under `artifacts/`: `phase7-backend-tests.log`, `phase7-integration.log`, `phase7-dashboard-tests.log`, `phase7-dashboard-lint.log`, `phase7-routes.log`, `phase7-desktop-full.log`, `phase7-installer-smoke.log`, `phase7-package-build.log`, `phase7-package-verification.log`, and the three `phase7-*-audit.log` files. The build-folder record is `phase7-build-folder.log`.
