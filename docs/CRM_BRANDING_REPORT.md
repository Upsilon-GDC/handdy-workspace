# CRM branding implementation report

Local changes only. No push, deployment, release upload, certificate changes or deletion of the old installer.

## Files changed and display references

- `backend/src/utils/mailer.js`: Password-reset email subject now says CRM; SMTP settings unchanged.
- `dashboard/index.html`: Browser title is CRM; existing favicon edit retained.
- `dashboard/public/desktop-release.json`: Update message and two release notes say CRM; actual hosted filename, URL, version and checksum preserved.
- `dashboard/src/components/admin/AdminSidebar.jsx`: Visible Upsilon sidebar name becomes CRM.
- `dashboard/src/components/dashboard/HanddyDownloadCard.jsx`: Card title and description use CRM; component and CSS identifiers retained.
- `dashboard/src/components/layout/DashboardLayout.jsx`: Shared admin/HR/manager header identifies CRM.
- `dashboard/src/context/themeContextInstance.js`: Visible theme name and description use CRM; theme ID unchanged.
- `dashboard/src/pages/admin/AdminPlaceholderPage.jsx`: Desktop timer explanatory text and heading use CRM.
- `dashboard/src/pages/auth/LoginPage.jsx`: Shared login heading says Welcome to CRM.
- `dashboard/src/pages/employee/EmployeeApps.jsx`: Page heading, introduction, Windows title, both download button states, installation steps, update instructions, fallback notes, closing note and footer use CRM. Existing-credentials instruction explicitly names CRM.
- `dashboard/src/pages/employee/EmployeeCountReport.jsx`: Footer changes from Handdy.com to CRM.
- `dashboard/src/pages/employee/EmployeeDashboard.jsx`: Footer changes from Handdy.com to CRM; shared download card retained.
- `dashboard/src/pages/employee/EmployeeDetailedTimesheet.jsx`: Footer changes from Handdy.com to CRM.
- `dashboard/src/pages/employee/EmployeeHelp.jsx`: All five branded FAQ entries, header and copyright use CRM.
- `dashboard/src/pages/employee/EmployeeMyTimesheet.jsx`: Footer changes from Handdy.com to CRM.
- `dashboard/src/pages/employee/EmployeeSidebar.jsx`: Visible Upsilon sidebar name becomes CRM.
- `dashboard/src/pages/teamLead/TeamLeadHelp.jsx`: All five branded FAQ entries and header use CRM.
- `dashboard/src/pages/teamLead/TeamLeadLogin.jsx`: Credential instructions use CRM.
- `dashboard/src/pages/teamLead/TeamLeadPermissions.jsx`: Footer changes from Handdy.com to CRM.
- `dashboard/src/pages/teamLead/TeamLeadSidebar.jsx`: Visible Upsilon sidebar name becomes CRM.
- `dashboard/src/pages/teamLead/TeamLeadTaskTracker.jsx`: Timer login status uses CRM.
- `desktop-app/dashboard.html`: Timer window title, brand text, brand initial and timer label use CRM; CSP and links unchanged.
- `desktop-app/index.html`: Login window title, heading and brand initial use CRM.
- `desktop-app/main.js`: Runtime app/window name, update log, update-dialog title/message/fallback and Exit button use CRM. Existing package-derived user-data folder explicitly preserved before changing the runtime name.
- `desktop-app/package.json`: productName and shortcutName CRM; artifactName CRM-Setup.${ext}; internal package name, appId and version unchanged.
- `desktop-app/preload.js`: API description comment uses CRM; configuration unchanged.
- `README_MERGED.md`: CRM product heading/API description and release, compatibility, certificate and icon instructions.

`CRM_BRANDING_REPORT.md` is newly created. Prior-turn changes in routing, RoleReportPage and CSS are retained; they were not changed for this branding pass. Dependency lockfiles were not manually edited.

## Validation

- Dashboard lint and production build passed (existing large-chunk warning).
- Dashboard tests: 2 passed. Route audit: 43 targets, 86 routes passed.
- Backend tests: 25 passed.
- Syntax checks passed for desktop main.js, preload.js, renderer.js and backend mailer.js.
- Sandbox child-process restrictions required builds/backend tests to run outside the sandbox.
- Installer build outcome is recorded below after packaging completes.
- Interactive login, upgrade installation, SMTP delivery and visual/browser checks were not performed.

## Release and deployment actions

Product name: CRM. Configured installer: desktop-app/dist/CRM-Setup.exe. Expected executable: desktop-app/dist/win-unpacked/CRM.exe. Version remains 1.2.0. No new Render variables; keep HANDDY_API_URL and VITE_API_URL unchanged.

The hosted asset is still Handdy-Setup.exe. After publishing a CRM asset to ORUGANTIVINODKUMAR/handdy-workspace, update the manifest filename, URL, version, hash, size and date together, plus the existing TeamLeadApps download link/filename. A newer version is needed to notify existing 1.2.0 installations. No fake new URL was introduced.

CRM icon still needs to be provided manually; the existing company image is not a CRM Windows icon. Certificate CN=Handdy Internal Code Signing remains untouched. Use a separate CN=CRM Internal Code Signing certificate if CRM publisher branding is wanted. Certificate auto-discovery was disabled for this local build.

## Remaining reference audit

A = display branding; B = internal configuration; C = environment variable; D = URL/domain/repository/real asset; E = certificate documentation. Actual old asset filenames are intentional visible exceptions until publication. All other remaining references below are compatibility identifiers or documentation, not accidental display branding.

- `dashboard/public/desktop-release.json:6` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `dashboard/public/desktop-release.json:9` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `dashboard/src/components/admin/AdminSidebar.jsx:48` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:51` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:91` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:99` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:100` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:105` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:112` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:132` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:138` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:173` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:208` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:242` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:277` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:319` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:446` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:473` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/admin/AdminSidebar.jsx:498` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/dashboard/HanddyDownloadCard.jsx:5` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/dashboard/HanddyDownloadCard.jsx:7` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/dashboard/HanddyDownloadCard.jsx:8` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/dashboard/HanddyDownloadCard.jsx:13` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/dashboard/HanddyDownloadCard.jsx:14` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/components/dashboard/HanddyDownloadCard.jsx:15` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/pages/admin/AdminPlaceholderPage.jsx:50` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/pages/admin/AdminSettings.jsx:134` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/pages/employee/EmployeeApps.jsx:13` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `dashboard/src/pages/employee/EmployeeDashboard.jsx:7` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/pages/employee/EmployeeDashboard.jsx:96` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/pages/shared/RoleReportPage.jsx:14` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/pages/shared/RoleReportPage.jsx:87` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/pages/teamLead/TeamLeadApps.jsx:27` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `dashboard/src/pages/teamLead/TeamLeadApps.jsx:28` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `dashboard/src/styles/adminLayout.css:4118` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4356` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4359` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4366` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4379` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4401` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4419` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4428` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4449` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4453` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4457` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4468` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4496` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4502` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4508` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4514` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4518` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4525` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4548` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4554` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4560` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4564` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4568` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4579` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4581` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4588` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4592` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4595` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4602` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4619` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4641` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4659` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4668` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4700` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4709` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4713` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4731` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4763` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4770` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4779` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4790` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4799` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4813` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4820` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4846` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4853` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4859` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4871` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4875` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4879` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4893` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4897` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4907` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4908` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4916` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4923` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4930` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4942` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4949` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4954` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4961` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4973` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4983` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4984` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4986` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4987` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4990` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4991` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4993` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:4994` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:5001` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:5002` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:5014` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/adminLayout.css:5018` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:294` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:302` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:308` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:313` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:319` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:326` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:339` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:340` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:341` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:346` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:347` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/employeeDashboard.css:348` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:29` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:30` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:37` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:38` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:42` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:50` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:59` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:66` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:77` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:82` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:86` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:90` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:99` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:111` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:118` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:123` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:130` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:136` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:137` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:149` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:150` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:160` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:161` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:163` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:164` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:180` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:181` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:189` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:197` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:206` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:207` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:212` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:216` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:220` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:228` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:232` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:522` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:531` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:537` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/professional.css:546` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1275` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1441` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1450` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1454` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1455` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1467` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1468` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1476` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1477` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1488` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1550` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1604` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1612` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1621` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `dashboard/src/styles/themes.css:1628` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `desktop-app/dashboard.html:6` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `desktop-app/dashboard.html:29` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `desktop-app/index.html:6` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `desktop-app/main.js:19` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `desktop-app/package-lock.json:2` ? B: stable npm package/app identity; preserves lockfile and installer identity.
- `desktop-app/package-lock.json:8` ? B: stable npm package/app identity; preserves lockfile and installer identity.
- `desktop-app/package.json:2` ? B: stable npm package/app identity; preserves lockfile and installer identity.
- `desktop-app/package.json:16` ? B: stable npm package/app identity; preserves lockfile and installer identity.
- `desktop-app/preload.js:4` ? C: existing public API environment-variable name; backward compatibility.
- `desktop-app/preload.js:6` ? C: existing public API environment-variable name; backward compatibility.
- `desktop-app/preload.js:7` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `desktop-app/style.css:61` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `desktop-app/style.css:79` ? B: internal CSS/component/storage identifier or historical code comment; retained to avoid compatibility-only renames.
- `README_MERGED.md:92` ? C: existing public API environment-variable name; backward compatibility.
- `README_MERGED.md:105` ? C: existing public API environment-variable name; backward compatibility.
- `README_MERGED.md:165` ? C: existing public API environment-variable name; backward compatibility.
- `README_MERGED.md:167` ? B: original desktop profile directory; preserves saved session data.
- `README_MERGED.md:174` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.
- `README_MERGED.md:187` ? E: documents the unchanged existing signing certificate.
- `render.yaml:3` ? D: existing production/repository/service or real hosted asset reference; no replacement was published.

The references inside this report itself are intentional audit/documentation examples. Existing binary installers are excluded from text search and preserved. Private environment files were not changed or printed.

## Final packaging outcome

The final CRM installer build passed, including the subsequent inactivity feature. CRM.exe is generated with Windows ProductName and FileDescription CRM. Installer: desktop-app/dist/CRM-Setup.exe. Signing status: NotSigned. The old Handdy-Setup.exe is preserved. See CRM_INACTIVITY_REPORT.md for the subsequent feature changes and final validation.

