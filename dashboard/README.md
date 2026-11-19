# CRM Dashboard (Frontend)

The web frontend for the CRM: employee time tracking, attendance, timesheets,
projects and tasks, production, and billing. It is a single-page React app built
with Vite. Every screen has a different layout depending on the signed-in user's role.

> **This repository holds the frontend only.** The app needs the CRM backend API
> (Node.js + Express + MongoDB) to sign in and load data. Set `VITE_API_URL`
> to point at a running backend (see [Configuration](#configuration)).

---

## Tech stack

| Area | Library |
| --- | --- |
| UI | React 19 |
| Build / dev server | Vite 8 (`@vitejs/plugin-react`) |
| Routing | React Router 7 (`BrowserRouter`) |
| HTTP | Axios (shared instance with auth interceptors) |
| Icons | lucide-react |
| Exports | ExcelJS (Excel), jsPDF + jspdf-autotable (PDF) |
| Linting | ESLint 10 with react-hooks and react-refresh plugins |
| Tests | Node's built-in test runner (`node --test`) |

The app is written in JavaScript (`.js` / `.jsx`), not TypeScript.

---

## Prerequisites

- **Node.js 20.19 or newer** (required by Vite 8)
- npm
- A reachable CRM backend API

---

## Getting started

```bash
cd dashboard
npm ci
cp .env.example .env      # then edit the values
npm run dev
```

The dev server prints its local URL (normally `http://localhost:5173`).
Open `/login` to sign in.

---

## Configuration

Settings are read at **build time** from `VITE_*` environment variables
(`.env`, `.env.local`, or the hosting provider's build settings).

| Variable | Example | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:5000/api` | Base URL of the backend API. If it is not set, the app uses `http://localhost:5000/api` in development and `/api` (same origin) in production builds. |
| `VITE_APP_TIMEZONE` | `Asia/Kolkata` | Time zone that defines "today" for date defaults. **It must match the backend's `APP_TIMEZONE`.** |

Trailing slashes in `VITE_API_URL` are removed automatically.
Because the values are compiled into the bundle, rebuild after changing them.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server with hot reload |
| `npm run build` | Builds the production bundle into `dist/` |
| `npm run preview` | Serves the built `dist/` locally |
| `npm run lint` | Runs ESLint |
| `npm test` | Runs the unit tests in `test/*.test.js` |
| `npm run test:routes` | Checks that every in-app link and sidebar path points to a defined route |

---

## Project structure

```text
dashboard/
├── index.html
├── vite.config.js
├── .env.example
├── public/                  # favicon and static icons
├── scripts/
│   ├── audit-routes.mjs     # route/link consistency check
│   └── review-ui.cjs        # UI screenshot review helper
├── test/                    # unit tests for utils (node --test)
└── src/
    ├── main.jsx             # entry: BrowserRouter + AuthProvider
    ├── App.jsx              # ErrorBoundary + AppShell + routes
    ├── api/                 # one module per backend area (axios)
    ├── components/
    │   ├── layout/          # AppShell, sidebar navigation, page header, modals
    │   ├── dashboard/       # overview widgets
    │   ├── employees/       # employee form
    │   ├── production/      # production and billing components
    │   ├── reports/         # timesheets, add/edit entry modals
    │   ├── tasks/           # task form, project/client/task linking
    │   └── teams/
    ├── context/             # AuthProvider, useAuth
    ├── hooks/               # data refresh, working-hours overview
    ├── pages/
    │   ├── auth/            # login, forgot/reset password
    │   ├── admin/           # admin, manager and HR screens
    │   ├── teamLead/
    │   ├── employee/
    │   ├── production/
    │   ├── profile/
    │   └── shared/          # pages used by several roles
    ├── routes/              # AppRoutes, ProtectedRoute
    ├── styles/              # plain CSS, one file per feature
    └── utils/               # formatting, exports, permissions, date helpers
```

---

## Roles and access

The app supports the roles `admin`, `alpha`, `manager`, `hr`, `team_lead` and `employee`.

- **admin / alpha / manager** have every permission and see the full admin workspace under `/admin/*`.
- **hr** sees the business and operational admin pages, but not account or security settings.
- **team_lead** works with their own team under `/team-lead/*`.
- **employee** sees their own overview and timesheets under `/employee/*`.

Access is enforced in two layers:

1. `ProtectedRoute` checks the user's role and, where a page needs it, specific
   permissions (for example `view_all_reports`, `manage_clients`, `create_tasks`).
   A role without the right permission can still open a page if the user has
   been granted that permission personally.
2. `components/layout/workspaceNavigation.js` defines the sidebar for each role
   and hides items whose permissions the user lacks.

The backend makes the final decision. Hiding something in the frontend is only for convenience.

---

## Main areas

| Area | Example routes |
| --- | --- |
| Sign in | `/login`, `/admin/login`, `/team-lead/login`, `/forgot-password`, `/reset-password` |
| Overview | `/admin/dashboard`, `/team-lead/dashboard`, `/employee/dashboard` |
| Clients, projects, tasks, teams | `/admin/clients`, `/admin/projects`, `/admin/tasks`, `/admin/team` |
| Employees | `/admin/employees`, `/employees/:employeeId` |
| Work setup (linking) | `/admin/project-client-links`, `/admin/task-links`, `/admin/client-access`, `/admin/employee-work-access` |
| Time entries | `/admin/time-entry-add`, `/admin/time-entry-edits` |
| Timesheets and attendance | `/admin/timesheets/*`, `/team-lead/timesheets/*`, `/employee/timesheet` |
| Production and billing | `/admin/production/*`, `/admin/billing` |
| Scheduling | `/admin/schedule`, `/admin/scheduler/*` |
| Settings | `/admin/settings`, `/admin/working-hours`, `/admin/permissions` |
| Profile and help | `/profile`, `/admin/help`, `/team-lead/help`, `/employee/help` |

[`src/routes/AppRoutes.jsx`](src/routes/AppRoutes.jsx) holds the full list of routes.

---

## Authentication and sessions

- On login, the backend returns a JWT. The app stores it in `localStorage`
  (`token`, `user`). `axiosInstance` sends it as `Authorization: Bearer <token>`
  on every request.
- Each browser gets a stable device ID (`crmDeviceId` in `localStorage`), which
  is sent at login so the backend can track sessions per device.
- When the API returns **401**, or the account is inactive, the app clears the
  stored session and redirects to `/login`. If the session ended because
  the account signed in on another device, a message is shown on the login page.
- Responses carry a permission version header. When permissions change on the
  server, the app refreshes them.

---

## Building and deploying

```bash
npm ci
npm run build      # output: dist/
```

`dist/` is a static site and can be hosted on any static host (Cloudflare Pages,
Netlify, S3 + CDN, Nginx, or served by the backend itself).

Checklist for deployment:

1. **Set `VITE_API_URL`** in the build environment. Use the full backend URL
   (for example `https://api.example.com/api`) when the frontend and API
   are on different domains, or `/api` when they share an origin.
2. **Set `VITE_APP_TIMEZONE`** to the backend's `APP_TIMEZONE`.
3. **Enable SPA fallback** so every unknown path serves `index.html`, which lets
   deep links like `/admin/tasks` load. On Cloudflare Pages or Netlify, add
   `public/_redirects` containing:
   ```text
   /*  /index.html  200
   ```
4. **Allow the frontend origin on the backend.** Add the deployed frontend URL to
   the backend's `CORS_ORIGINS`, and set `FRONTEND_URL` so password-reset links point
   to the right place.
5. Serve the app at the **root of its domain or subdomain** (for example
   `crm.example.com`). The routes and the 401 redirect use absolute paths such as
   `/login`. To host it under a sub-path such as `/crm/`, you would first need to set
   `base` in `vite.config.js`, set `basename` on `BrowserRouter`, and update the
   redirect in `src/api/axiosInstance.js`.

---

## Testing

```bash
npm test             # unit tests for utils (reports, billing, permissions, dates, …)
npm run test:routes  # verifies links and sidebar entries match defined routes
npm run lint
```

The tests run on Node's built-in runner and need no browser or backend.
