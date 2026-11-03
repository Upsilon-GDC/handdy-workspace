# Activity links — database integration test results

**Date:** 2 November 2026  
**Status:** Pending phase 1 (database integration testing) complete.

## Environment and isolation

Tests ran on real **MongoDB 7.0.24**, using WiredTiger and a disposable, single-member replica set bound to **127.0.0.1**. Each invocation generates a random `crm_activity_integration_*` database and synthetic records. The runner does not load `.env`, accept an external database URI, or start the application server. No production database, customer records or historical employee time was changed.

The development-only `mongodb-memory-server-core` dependency starts an actual `mongod` process; it does not simulate MongoDB. Tests call the application controllers/services with real Mongoose queries, indexes and sessions. HTTP authentication middleware remains covered by the ordinary regression suite.

## Results

**9 integration tests passed; 0 failures, skips or cancellations.** MongoDB command monitoring recorded **22 real transaction write conflicts** in the final run (21 in the previous successful run). A final rerun also verified the runner after adding cleanup for timed-out startup; no `mongod` process remained after testing.

| Check | Observed result |
|---|---|
| Index setup and duplicate tuples | Index setup can be repeated. The database unique index rejects a second identical project/client/task tuple with code 11000. |
| Ten simultaneous link saves | One save succeeds; nine receive 409 stale-version conflicts. One active mapping and one project version increment remain. |
| Eight simultaneous identical task batches | One complete two-task batch succeeds; seven receive 409. Exactly two tasks, two mappings and one version increment remain. |
| TL teams and manager access | Each TL creates tasks for their own team. Separate teams can use the same task names. Each team sees its own mapped tasks; the manager sees both teams. An inactive team loses project access. |
| Manual-entry options | Shared mapped work is returned for the target employee and correct project/client. Revoking whole-team task assignment removes the choices. |
| Mapping insertion failure after task insertion | Database command evidence confirms two task inserts succeeded inside the transaction before MongoDB rejected the mapping write with code 121. Neither tasks, mappings nor the version increment committed. |
| Project update failure after disabling mappings | Database command evidence confirms the mapping update occurred inside the transaction before the final project update failed with code 121. The saved client, active mapping and original version were restored by rollback. |
| Five create-versus-client-removal races | Accepted/rejected outcomes preserve the relationships. No active mapping remains under a removed client, and rejected creations leave no new project tasks. |
| Unlink/relink and history | Unlinking the final task keeps strict selection enabled and returns no tasks. Relinking reuses the same mapping ID. The existing shared task and synthetic historical time record remain unchanged. |

The two deliberately injected validation errors appear in the log as expected controller error output. They are part of passing rollback tests.

The ordinary backend regression suite also passed: **272 tests, 0 failures**. No production application logic needed changing as a result of these integration checks.

## Reproduce and evidence

```powershell
npm --prefix backend ci
npm --prefix backend run test:integration
npm --prefix backend test
```

First use downloads the platform's MongoDB binary (approximately 600 MB on Windows). The startup allowance is 15 minutes; cached runs are substantially faster. The initial bootstrap attempt exceeded the original four-minute download allowance; tests were rerun successfully after increasing it. Teardown disconnects and stops the disposable server.

- Runner: [backend/integration/activityMappings.cjs](backend/integration/activityMappings.cjs)
- Setup and scope: [backend/integration/README.md](backend/integration/README.md)
- Final passing real-database run: `artifacts/activity-mapping-mongo-integration-final.log`
- Previous passing run: `artifacts/activity-mapping-mongo-integration.log`
- Passing backend regression: `artifacts/activity-integration-backend-regression.log`
- Initial binary-download attempt: `artifacts/activity-mapping-mongo-bootstrap.log`

## Remaining phases

1. Windows installer follow-up: the local 2.0.2 build and isolated install/upgrade pilot have now passed; see the [Phase 2 report](CRM_WINDOWS_INSTALLER_PHASE_2_REPORT.md). Trusted signing and an actual Windows logon/company-policy pilot remain.
2. Deploy backend/website and distribute the desktop update. Verify the deployed Atlas permissions, index initialization and network behavior in that environment.
3. Complete the desired website links and enable linked selection per project after employees receive the update.

These tests establish local replica-set transaction behavior. They do not establish multi-node failover, deployed Atlas configuration, production data/index health, or a backup/restore drill. The separate audit finding about simultaneous overlapping manual time entries is outside this mapping test phase and remains unresolved. Automatic Idle Break/default timer startup also remains outside this phase.
