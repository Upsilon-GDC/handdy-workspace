# Phase 5: login protection

Implemented locally on 9 November 2026. No deployment, production login attempts, or production data changes were performed.

## Policy

All limits use a fixed 15-minute window. Each request consumes the budgets it reaches, including successful sign-ins and malformed or rejected requests. Blocked requests do not extend their existing window. A 429 response retains the existing JSON message and includes `Retry-After` in whole seconds.

| Scope | Maximum attempts | Applies to |
| --- | --- | --- |
| IP address | 100 | Shared between password login and quick login |
| Normalized email | 20 | Password login across all IPs; whitespace trimmed and case folded |
| IP plus normalized email | 10 | Password login; preserves the original pair threshold |
| Remembered credential | 20 | Quick login across all IPs |
| IP plus remembered credential | 10 | Quick login |

The IP budget runs first, limiting rotating emails or remembered tokens before they can allocate downstream buckets. Login budgets ignore endpoint-path differences, including trailing slashes. Quick-login identity comes from the submitted remembered credential, not an arbitrary supplied email. Its budget is per credential, not a database employee-wide budget combining every remembered device and password login. Remembered credentials rotate after successful use, as before; this does not reset the shared IP budget.

The thresholds permit a synthetic office scenario of 15 employees each making three password attempts from one IP. This is functional coverage, not a guarantee for every office size or a production traffic measurement. Monitor actual 429/support behavior when rolling out and review thresholds before materially increasing the user population.

## Bounded storage

Each limiter owns at most **10,000 buckets**. Five stores implement login limits; registration and password reset each use their own store. Keys are fixed-size SHA-256 hashes of structured identities, so stored keys do not retain plaintext email addresses, remembered secrets, or arbitrary-length input. No credentials are logged by these limiters.

Expired entries are removed as subsequent requests arrive. Fixed-window ordering permits cleanup from the oldest entry without scanning live budgets. Clock rollback is clamped within the limiter to preserve expiry order. Counters saturate after the limit rather than growing indefinitely.

If a store is full, new identities receive 429 until space expires. Live buckets are never evicted to make room, so rotating identities cannot erase an exhausted budget. Existing identities can use their remaining allowance. This intentionally favors enforcement over accepting new identities during capacity saturation.

Registration remains 30 attempts/hour per IP. Password reset remains five attempts/15 minutes per IP and route. Their stores and route-specific keys remain independent of login. No authentication controller, password policy, session lifetime, or client request format changed.

## Deployment scope

Rate limits are local to one API process. Server restart clears them; multiple processes or overlapping deployments do not share them. Keep the existing single-process restriction. Use shared atomic enforcement before horizontal scaling. The app's existing trusted-proxy setting determines `req.ip`; this phase does not change proxy trust or prove the production ingress configuration.

Deploy through the normal backend release process and verify normal login/quick-login, a 429 with `Retry-After`, recovery after expiry, and office behavior in staging. No employee installation or schema migration is required by this server change. Frontends already display the response message; automatic retry is not added.

## Verification

Nine focused local tests exercise the actual mounted middleware across rotating emails/tokens/routes, normalized-account and credential budgets across IPs, retained pair limits, the office scenario, exact expiry/retry behavior, capacity saturation without eviction, independent generic stores/routes, and malformed identity fields. Tests use synthetic requests without sending real passwords or login traffic.

Results: **337 backend tests passed**, including all nine new rate-limit tests; `git diff --check` passed. Log: `artifacts/phase5-backend-tests.log`. No frontend or database-writing code changed, so frontend builds, Electron GUI tests, and the database integration suite were not rerun for this phase. Production traffic, ingress configuration, and load capacity were not measured.
