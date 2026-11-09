# Phase 6: recovery and release checks

Implemented locally on 9 November 2026. No application database, production backup, scheduler, publisher certificate, remote repository setting, release or employee installation was changed.

## Recovery

New logical backups use one snapshot session for every data cursor, with BSON type preservation, per-file SHA-256, counts, collection options/validators and indexes. Schema/catalog identity is checked before and after export. Only a successful export publishes its complete format-2 manifest. Incomplete exports cannot trigger retention; retention prunes only completed format-2 dated folders. Snapshot reads can expire or be unsupported; the script fails rather than falling back. Schema changes must be frozen, and unsupported collection types require native backup tooling.

Restore verifies all input paths, hashes, gzip/JSON readability and counts before database writes. It rejects source/system databases and any occupied recovery target. It does not drop collections. Failures during insertion may leave a partial recovery database; retries require a fresh empty target. Collection validators/indexes and counts are checked through actual database restoration. Legacy exports require `--allow-legacy` and remain explicitly `legacy-unverified`; a newly calculated hash cannot prove their original integrity or a common recovery point.

The CLI runs read-only checks for overlapping/invalid time intervals, duplicate active timers, missing time-log references, orphaned correction audits and attendance check-in/checkout mismatches. Findings stop promotion and need review. Snapshots can capture derived application state between separate writes, and historical anomalies may already exist. These checks do not prove every billing/history invariant. Re-run checks with `npm run verify:recovery -- --db <recovery_database>` and complete representative application/report checks before recovery cutover.

See [backup/restore procedure](BACKUP_AND_RESTORE.md). Local tests use disposable MongoDB and synthetic data, not Atlas credentials or `.env`.

## Automated checks

The prepared `.github/workflows/quality.yml` runs on pull requests, main pushes and manual dispatch. Linux checks include backend units, isolated MongoDB integration/recovery, and dashboard tests/lint/routes/build. Windows runs the desktop suite. It uses Node 24, read-only repository permissions, no persisted checkout credentials, and no signing/publishing secrets or deployment steps.

Workflow YAML was parsed locally. Its [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) versions follow their official v7 usage. A GitHub Actions run, dependency installation on hosted runners and branch-protection enforcement have not been verified/enabled remotely. Require successful hosted checks after an authorized push before treating CI as an enforced release gate.

## Signing preparation

`npm run build:signed` now requires `CRM_PUBLISHER_NAME`, `CSC_LINK` and `CSC_KEY_PASSWORD` before invoking the builder. It enforces signing, SHA-256 and update-publisher verification. `npm run publish` uses the same configuration and retains its draft-only/new-version checks. Neither command was run with publishing credentials.

`scripts/verify-installer.ps1` checks Windows Authenticode status, exact publisher and SHA-256. It correctly rejected the existing unsigned 2.0.6 installer. Signing configuration was validated against the installed electron-builder schema, and its preflight has regression coverage.

**Actual signing is pending a valid publisher certificate and its credentials.** No certificate was purchased, installed or guessed. No new signed artifact was produced. A successful positive signature check, matching installer/blockmap/latest.yml verification, and unsigned-to-signed staging upgrade remain release tasks. Local unsigned build commands remain available for development; they are not an approved distribution path.

## Verification scope

The backup recovery tests verify a shared snapshot while another session changes collections, BSON Long/date preservation, restored unique indexes/validators, interrupted exports, metadata drift, corrupted files, unsafe paths, source/occupied-target protection, legacy consent, and read-only inconsistency detection. Stream tests cover cursor, filesystem and gzip failures. Desktop release tests cover missing signing identity/credentials and configured verification without leaking test credentials into configuration output.

Phase 7 still owns the final broad application/GUI/build regression run. Production recovery drills, hosted CI, certificate provisioning and deployment/publication are external rollout tasks.

Local results: **338 backend tests, 73 disposable-MongoDB integration tests, and 154 desktop unit tests passed**. Workflow YAML parsing, installed builder signing-schema validation, expected rejection of the unsigned installer, and `git diff --check` passed. Logs: `artifacts/phase6-backend-tests.log`, `phase6-integration.log`, `phase6-desktop-tests.log`, and `phase6-signature-check.log`. Dashboard and complete Electron GUI checks were not rerun for this phase; the new workflow prepares those checks for hosted execution.
