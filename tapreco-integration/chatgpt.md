# Tapreco - Technical Architecture, Hosting, Databases, APIs and GitHub

**Prepared:** 13 November 2026  
**Scope:** Architecture described in previous project discussions  
**Verification:** This is not a live audit of GitHub, Cloudflare, Render, Neon or Supabase. Unknown counts and URLs are marked for confirmation.

## 1. Executive overview

Tapreco is a suite of US tax-related tools. Four custom React applications use a shared Node.js/Express API. A separate vendor Tax Planner is integrated into the suite. Roth Strategy Analyzer is planned. The intended user experience is a common login and consistent navigation.

## 2. Tools inventory

| Tool | Function | Known status |
|---|---|---|
| Tax Planner | Tax planning and scenarios | Vendor application / integrated |
| Mutual Fund | Federal and state mutual fund tax calculations | Custom frontend hosted |
| Estimated Tax | Estimated tax payment calculations | Custom frontend hosted |
| Audit Risk Analyzer | Form 1040 risk findings and PDF reports | Custom frontend hosted |
| Entity Comparison | Compare Schedule C and S-Corp outcomes | Custom frontend hosted |
| Roth Strategy Analyzer | Roth conversion strategy analysis | Planned; deployment unverified |

**Count:** Six named tools in the roadmap: four hosted custom frontends, one vendor application, one planned tool. This does **not** mean all six are live.

## 3. Hosting by layer

| Layer | Hosting/service | Purpose |
|---|---|---|
| Domain / DNS | GoDaddy | Maps domain names and subdomains to services |
| Website / portal | Cloudflare Pages | Serves the portal frontend |
| Four custom frontends | Cloudflare Pages | Serves compiled React/TypeScript/Vite files |
| Shared tools backend | Render Web Service | Runs Node.js and Express APIs |
| Custom tools database | Supabase PostgreSQL | Application data used by backend |
| Vendor Tax Planner database | Neon PostgreSQL | Vendor-controlled database; do not modify vendor tables |
| Source control | GitHub | Code, branches, commits and deployment source |

## 4. System architecture and request path

```text
User's browser
     |
     v
Cloudflare Pages (React + TypeScript + Vite)
     | HTTPS request / JSON
     v
Render Web Service (Node.js + Express / tools-api)
     | PostgreSQL connection over TLS
     v
Supabase PostgreSQL
     |
     +-- Query results --> Render API --> JSON response --> React UI

Separate vendor Tax Planner --> Vendor application --> Neon PostgreSQL
```

Typical request:

1. User opens the Tapreco portal or tool URL.
2. Cloudflare Pages serves HTML, JavaScript and CSS.
3. React renders the screen, validates inputs and sends an HTTPS request.
4. Render's Express API authenticates and authorizes the request, validates input and runs calculations.
5. The API reads or writes PostgreSQL if required.
6. The API returns JSON, errors or a report payload.
7. React displays results and may provide PDF or Excel downloads.

**Important:** Do not connect React directly to PostgreSQL with privileged credentials. Keep database credentials and sensitive queries on the backend.

## 5. Example: React linked to Express API

A Vite frontend can use a configured API base URL such as `VITE_API_BASE_URL`.

**Illustrative frontend request (not a verified production endpoint):**

```http
POST /api/estimated-tax/calculate
Content-Type: application/json

{"income":120000,"filingStatus":"single"}
```

The Express route receives the request, validates input, checks permissions, runs the calculation, optionally queries PostgreSQL using a server-side connection pool, and returns structured JSON to React.

If frontend and API have different origins, configure CORS to allow only approved frontend origins. For cookie-based authentication, review `SameSite`, `Secure`, domain and credentials settings.

## 6. Databases and connections

### Supabase PostgreSQL - custom tools

- Used by the shared `tools-api` for application data.
- Prior discussions referenced Supabase's pooler on port `6543` with SSL/TLS.
- Render previously encountered TLS certificate validation errors and a missing `DATABASE_TLS_CA` setting.
- Keep connection strings and CA configuration in backend environment variables, not in frontend code or public GitHub commits.

### Neon PostgreSQL - vendor Tax Planner

- Used by the separate Tax Planner application.
- Do not modify vendor-controlled tables or schemas without vendor approval.
- Exact production instance names, ownership and schemas need verification.

## 7. GitHub repositories and source layout

Previously referenced repository: `Upsilon-GDC/tapreco`. Later discussions also mentioned the `UpsilonInc` organization and an additional remote; these do not establish how many independent repositories currently exist.

```text
tapreco/
  apps/
    mutual-fund-web/
    estimated-tax-web/
    audit-risk-web/
    entity-comparison-web/
  services/
    tools-api/
  shared-ui/
  docs/
  scripts/
```

**Repository count:** At least **one named Tapreco repository** is known. Four frontend folders and one backend folder are applications/services within a codebase, **not automatically five GitHub repositories**. Check the GitHub organization and each deployment's connected repository to confirm the exact count.

Previously discussed branches: `main`, `develop`, `feature/tools-integration` and `tools_integration_relesaes`. Confirm which branch each production service currently deploys.

## 8. How deployments work

**Frontend:** Developer pushes to GitHub; Cloudflare Pages builds the configured branch (for example with `npm run build`) and publishes Vite `dist` assets. Each frontend may have a separate Pages project while sharing one repository.

**Backend:** Render pulls its configured GitHub branch, installs dependencies, starts the Node.js service, and exposes HTTPS endpoints. It reads database connection settings from secrets/environment variables.

**Database:** PostgreSQL is hosted separately. Deploying frontend or backend code does not automatically change schemas unless migrations are explicitly executed. Prior discussions referenced `npm run db:migrate` under `services/tools-api`.

**DNS:** GoDaddy records map domains and subdomains to Cloudflare or Render. Exact production Tapreco hostnames and DNS targets have not been verified.

## 9. Authentication and shared navigation

The target experience is one login across Tapreco tools, with a consistent header, role checks, session refresh and sign-out. Previously discussed roles include Admin, Firm Admin, CPA/Reviewer and Employee.

The vendor Tax Planner may require a secure SSO or token-exchange integration to avoid a second login. Do not assume that full SSO is already working without inspecting and testing it.

Cross-application sign-out should invalidate sessions consistently. Test token expiry, cookie scope across subdomains, refresh behavior and redirect destinations.

## 10. Reports and exports

Known requirements include PDF and Excel report output and one-click PDF review. Audit Risk Analyzer produces findings and a PDF report; report layouts have also been discussed for other tools.

**Exact report template count and API endpoint count are not verified.** These are different from the GitHub repository count and require inspection of the codebase.

## 11. Security and operations

- Enforce HTTPS between browser and API and TLS to PostgreSQL.
- Keep credentials and private keys on the backend.
- Validate API inputs and enforce role-based authorization.
- Use PostgreSQL connection pooling and safe parameterized queries.
- Restrict CORS to approved origins.
- Use structured logs, request IDs, error monitoring and performance monitoring.
- Rotate secrets, maintain database backups and test cross-app sessions.

## 12. Inventory needing live confirmation

| Item | Current understanding | How to verify |
|---|---|---|
| GitHub repositories | At least one named; exact total unknown | GitHub organization repository list and remotes |
| Cloudflare Pages projects | Portal and four custom frontends discussed | Cloudflare Pages dashboard |
| Render services | One shared tools API discussed | Render dashboard |
| Databases | Supabase for custom tools; Neon for vendor | Backend configuration and provider dashboards |
| Production domains | Exact Tapreco URLs unverified | GoDaddy DNS and deployment custom domains |
| API endpoints | Shared Express API; count unknown | Inspect `services/tools-api` routes |
| Live tool status | Four custom hosted, vendor separate | Test production URLs |
| Reports and templates | Exact count unknown | Inspect PDF/Excel generation code |

## 13. Worked example: Estimated Tax

1. User opens the Estimated Tax frontend on Cloudflare Pages.
2. React renders the form.
3. User enters income, filing status and other inputs.
4. React sends the data to the Render API via HTTPS.
5. Express validates it, runs calculations and may query Supabase if stored data is needed.
6. API returns a JSON result.
7. React displays the tax estimate and supported export options.

## 14. Verification checklist

For a fully audited architecture document, collect:

- GitHub organization repository list and relevant branches.
- Cloudflare Pages projects, build commands and production domains.
- Render service names, linked repositories, branches and API base URLs.
- Supabase project identifier (not secrets) and Neon vendor ownership details.
- API route inventory and report generation modules.
- Authentication and SSO integration behavior.

**Never include passwords, tokens or private connection strings in a shared report.**

## Conclusion

The documented architecture is a multi-app React/TypeScript suite on Cloudflare Pages, a shared Node.js/Express API on Render, Supabase PostgreSQL for custom tools and a separate vendor Tax Planner using Neon. One named Tapreco repository is known; the exact repository and report counts remain to be confirmed.
