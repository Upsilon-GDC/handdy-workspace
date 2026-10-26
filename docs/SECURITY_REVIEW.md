# Security review (26 October 2026)

Scope: backend API, dashboard and desktop app as in this repository (desktop 1.2.33). Method: code
review of every route's access rule, authentication, session handling, input handling, the desktop
app's Electron settings, and `npm audit` of production dependencies. No penetration test of the live
service was done.

## Fixed in this review

| Item | Before | Now |
|---|---|---|
| Vulnerable libraries | Server: 3 (incl. 1 critical: `proxy-addr`, plus `body-parser`, `nodemailer`). Dashboard: 4 (incl. 1 critical: `dompurify`, plus `axios`, `follow-redirects`, `brace-expansion`) | **0 and 0** (`npm audit --omit=dev`). `nodemailer` moved to 10.x; password-reset email tested end to end over SMTP. |
| Token signing method | Any HMAC method accepted when checking tokens | Issued and accepted only as HS256 |
| Desktop permission requests | Electron grants camera, microphone, location etc. by default | All refused (CRM needs none) |
| Timer stop race | A stop could overwrite the lease sweep's stop and count unconfirmed time | Single conditional update (Phase 3) |
| Reset-link logging | Full mail error object logged | Only code/status/command, reset token redacted |

## Checked and in order

- **Every protected route** runs `protect`: valid signature and expiry, active account, current
  `tokenVersion`, active and unexpired session. Writes to accounts or sessions clear the sign-in
  cache at once (`docs/CRM_OPTIMIZATION_PHASE_PLAN.md` 3.3).
- **Server-side access per area** (not only hidden buttons):
  - own data only: timer, personal history, own attendance;
  - team leads: only their team (team reports, team attendance; other employees → 403);
  - company reports need `view_all_reports`; billing needs `view_billing_amounts` (any role it is given to);
  - manual entries check who may act on which employee on every create/list/delete;
  - permissions page: admin, alpha and manager only (any duty can be given to HR, team leads and employees; team duties are limited to the person's own team, and non-leads see teammates without rates); per-person idle rules: alpha only; metrics: admin-level.
- **Delta sync and fingerprints** use the same filters as the full reports, and their scope includes
  the caller's identity and role, so one person's sync data cannot be reused for another.
- **Input**: 1 MB body limit, `$`/dot keys stripped (NoSQL injection), IDs validated, rate limits on
  sign-in (10/15 min), password reset (5/15 min) and registration (30/h).
- **Secrets at rest**: passwords bcrypt-hashed; password-reset and remembered-login tokens stored
  only as hashes; production refuses to start with a weak `JWT_SECRET`.
- **HTTP headers**: nosniff, frame DENY, no-referrer, permissions-policy; in production HSTS and a
  strict CSP (`script-src 'self'`). API responses `no-store` except catalog lists (`private`).
- **Desktop app**: context isolation, renderer sandbox, Node integration off, a narrow preload
  bridge, navigation limited to its own files, new windows only to the production site, IPC lock
  messages accepted only from the CRM window, CSP on every page, updates only from this GitHub
  repository.
- **CORS** allows the dashboard's own origin and `null` (Electron file pages). Authentication uses a
  Bearer header, not cookies, so a foreign page cannot use a signed-in user's session.

## Recommendations (not done)

| Priority | Recommendation | Why it waits |
|---|---|---|
| High | **Code-sign the Windows installer** (decision D4) | Needs a purchased certificate; until then Windows shows "unknown publisher" and the updater cannot check the publisher. Steps in `docs/DEPLOY_AND_ROLLBACK.md`. |
| Medium | Keep tokens out of `localStorage`: httpOnly cookie for the dashboard, OS keychain (`safeStorage`) for the desktop | Changes sign-in on both apps; the strict CSP already blocks injected scripts, which is what would read the token |
| Medium | Narrow the desktop CSP `connect-src https:` to the production site | `HANDDY_API_URL` staging builds would need their own value |
| Low | Run `npm audit --omit=dev` monthly in `backend` and `dashboard` | Process, not code |
| Low | Document a `JWT_SECRET` rotation (rotating signs everyone out once) | Only needed if the secret leaks |
