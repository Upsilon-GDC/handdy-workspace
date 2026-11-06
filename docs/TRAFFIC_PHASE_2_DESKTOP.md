# Phase 2 — desktop profile and timesheet traffic

Desktop version: 2.0.4. Local build only until explicitly published and installed.

## Behavior

- Employee profile and visible timesheet background downloads are limited to one successful refresh per five minutes per session. Focus, online and visibility events do not bypass these limits.
- Manual timesheet Refresh, opening its tab and timer action updates remain immediate. Successful Start also requests a timesheet refresh without delaying the visible running clock.
- A new local day or new session cannot reuse the previous timesheet refresh budget. Failed requests do not consume a successful-refresh budget; they can retry on the existing background tick.
- The existing 30-second coordinator and catalog refresh behavior remain in place. This phase reduces the actual profile/history requests inside that coordinator; list caching is a later phase.
- The 20-second heartbeat, device-approval long-poll, idle policy, local running clock, timer lease and recorded time calculations are unchanged. Heartbeats and other protected API calls continue to validate sessions independently of profile download frequency.
- A displayed timesheet/profile may be up to five minutes old between explicit updates. Hidden windows continue skipping heavy timesheet/catalog loads.

## Incremental timesheets

The desktop requests the existing `checksum=true` report protocol so matching delta copies remain usable between five-minute polls. Verified copies receive a complete reload after an hour. Without checksum proof, a complete reload occurs after ten minutes. Manual and action-driven refreshes request complete snapshots, including waiting for an earlier in-flight report before fetching the new one.

The backend's previously prepared 15-minute sync-marker validity window supports five-minute polling plus network/scheduling delays; deploy that backend change too for effective delta downloads. Older backends remain compatible but may return full reports more frequently.

## Validation and rollout

Tests cover five-minute background budgets despite focus refreshes, failed-request retries, minimized behavior, midnight/session changes, immediate Start/Stop/manual updates, matching checksums, hourly reload and older-server fallback. Desktop unit tests and Electron startup/inactivity regressions validate existing timing and login behavior.

Install the newly built `desktop-app/dist/CRM-2.0.4-Windows-x64.exe` to apply Phase 2 on each PC, or explicitly publish a release for the existing updater. No GitHub publish, production deploy or employee installation is performed by this phase automatically.

Compare a representative post-install metrics window with the Phase 1 baseline, matched by employee-hours and deployed versions. Scheduled profile/history calls should reduce substantially; timer actions, retries and manual updates are additional requests. Do not claim a 90% reduction in total Render traffic or measured savings before that comparison.
