---
title: ally-web — Web Applications
tags: [repo, frontend, nx, react, vite]
summary: An Nx monorepo containing Ally's two user-facing web applications — a Vite+React helpline dashboard for counselors (port 8080) and a Vite+React admin dashboard for super admins (port 8081) — plus a shared UI library.
last_reconciled: 2026-09-22
---

# ally-web — Web Applications

## Purpose

`ally-web` is the frontend layer of the Ally mental health counselor training platform. It is an Nx monorepo (`@ally-ui-mono/source`) that houses two applications and one shared library:

- A **Helpline Dashboard** (`ally-helpline-dashboard`) for mental health counselors — real-time chat, appointment scheduling, case management, analytics, and LiveKit voice sessions. Roleplays can also run as a **text chat** where the learner's org and the roleplay both allow it: a Voice call / Text chat picker on the scenario page and track player, and the same `SimulationPage` (ui-shared) with the call card swapped for a chat panel that talks over LiveKit text streams.
- An **Admin Dashboard** (`ally-admin-dashboard`) for super admins — simulation/scenario management, session-event configuration, user/tenant/permission management, LiveKit simulation preview, and simulation-credit monitoring.
- A **shared UI library** (`libs/ui-shared`) with reusable components, utilities, feature flags, a logger, and the PostHog analytics layer (`lib/analytics`: `initAnalytics`, `AnalyticsProvider`, `useAnalytics`, the event constants) that both dashboards share.

The applications integrate with the `ally-be` backend (REST + Socket.IO) and with LiveKit for real-time voice/video.

> [!NOTE]
> This page documents *how the frontend is built*. For *how it should behave* — required screen states, permission-aware UI, chart honesty rules, and the personas each dashboard serves — search Stacks before you plan ([Planning with the Stacks MCP](../contributing/planning-with-stacks.md)). The former in-wiki guidance ([UI & Interaction](../product/ui.md), [Data Visualisation](../product/data-visualisation.md)) is **deprecated** as of 2026-08-07 and no longer a gate, but still worth reading for the Ally-specific traps it records.
>
> The super-admin Analytics surface is where those chart rules are implemented rather than just stated. `apps/ally-admin-dashboard/src/pages/Analytics/` holds the shared kit every chart routes through: `chartKit.tsx` (the `ChartCard` wrapper that requires a provenance line and handles the loading / error / empty / thin-data states, the axis factories, and `MIN_N_FOR_SCORE`) and `chartScales.ts` (the approved palette, keyed on meaning). Adding a chart means using those factories — `colorScale` is a required argument specifically so a chart cannot fall back to a palette whose colours mean nothing.
>
> Two tabs on that page show model output rather than measurements — Analytics Agent and Suggestions (`pages/Analytics/tabs/suggestions/`) — and those follow [AI-Product Patterns](../product/ai-product-patterns.md): provenance pinned per card, a human review step before anything is filed onto the roadmap, a bounded progress narrative instead of an open-ended spinner, and rejections recorded with a reason so the generator does not re-propose them.

## Tech Stack

| Concern | Technology |
| --- | --- |
| Dashboard framework | Vite `^5.4.11` + React 18.3.1 |
| Language | TypeScript `~5.9.3` |
| Styling | Tailwind CSS `3.4.3` (+ MUI `@mui/material` v7, `@carbon/react`), `tailwind-merge`, `tailwindcss-animate` |
| State management | Redux Toolkit `^2.11.2` / RTK Query, `react-redux`, `redux-persist` |
| Routing | `react-router` / `react-router-dom` v7 |
| Real-time | `socket.io-client` `^4.8.3`, `livekit-client` `^2.17.0`, `@livekit/components-react` |
| Forms | `react-hook-form` |
| Animations | `framer-motion` |
| i18n | `i18next`, `react-i18next`, `i18next-browser-languagedetector` |
| Analytics | `posthog-js` |
| HTTP | `axios` |
| Monorepo tooling | Nx `22.3.3` (Nx Cloud enabled) |
| Testing | Vitest `^3.2.4` + Testing Library (Jest is used for the `ui-shared` lib) |
| Code quality | ESLint 9 + Prettier, Husky + lint-staged, pre-commit hooks |
| Node version | **v22** (`.nvmrc`) |

Note: the per-app READMEs list some slightly older dependency versions; the root `package.json` (above) is the authoritative source for the workspace.

## Apps & Structure

The workspace uses npm workspaces (`apps/*`, `libs/*`) with Nx orchestrating build/test/lint. Nx plugins are configured for `@nx/vite`, `@nx/react/router-plugin`, `@nx/js/typescript`, and `@nx/eslint`.

```
ally-web/
├── apps/
│   ├── ally-helpline-dashboard/   # Counselor dashboard — Vite+React, port 8080
│   └── ally-admin-dashboard/      # Admin dashboard — Vite+React, port 8081
├── libs/
│   └── ui-shared/                 # Shared components, feature flags, logger, analytics (@ally-ui-mono/ui-shared)
├── docs/                          # Guides (PostHog, Colima, prompt meta)
├── scripts/                       # docker-switch.sh, i18n-sync.mjs
├── compose.yaml / compose.test.yaml
├── Dockerfile.deps                # Shared base dependencies image
├── nx.json / tsconfig.base.json / package.json
```

### ally-helpline-dashboard — Counselor Dashboard (Vite+React, port 8080)
Dashboard for mental health counselors. Features: real-time chat, LiveKit voice sessions, appointment/calendar management, case management/documentation, analytics and reporting (with PDF export via `jspdf`), dark/light theme, and i18n. Source is organized into `api/`, `components/`, `containers/`, `hooks/`, `pages/`, `reducer/`, `routes/`, `store/`, and `types/`. Reads `VITE_API_BASE_URL`.

### ally-admin-dashboard — Admin Dashboard (Vite+React, port 8081)
Administrative console for super admins built on RTK Query. Features: Simulation Studio (create/edit/publish voice simulation scenarios, cover-image upload to S3, event mapping, voice config, LiveKit live preview), session-event management, user/tenant management, permission-based access control (`PrivateLayout` guards routes), and simulation-credit monitoring. Uses OTP-based login with automatic token refresh (`baseApi.ts`). Reads `VITE_API_BASE_URL` and `VITE_LIVEKIT_URL`. Permissions are enumerated in `src/constants/permissions.ts` (e.g. `edit:scenario`, `edit:user`, `edit:livekit`, `edit:session-events`, `view:admin:scenario`).

The **Analytics** page carries a tab registry (`src/pages/Analytics/`); its **Analytics Agent** tab is a chat surface for asking analytics questions in English, and is the one tab with a gate of its own — hidden for a plain super-admin, matching the backend's elevated-tier check. See [Analytics Agent](../platform/analytics-agent.md).

## Integration Points

- **REST → ally-be**: All apps call the `ally-be` backend over REST (`axios` in the landing app; RTK Query in the dashboards). The admin dashboard documents concrete endpoints, including:
  - Auth: `POST /v1/auth/login`, `POST /v2/auth/generate-otp`, `POST /v2/auth/verify-otp`, `POST /v1/auth/refresh`, `GET /v1/users/me`, `GET /v1/authorization/permissions`.
  - Simulations/roleplays: `GET/POST/PUT/DELETE /v1/learn/*` (e.g. `/v1/learn/admin-scenarios`, `/v1/learn/scenarios`, `/v1/learn/scenarios/preview`).
  - Session events, users, tenants, roles, and `/v1/simulation-credits`.
- **Socket.IO → ally-be**: Namespaces are defined per app in `src/constants/socket.ts`:
  - Helpline (`SocketConnectionPaths`): `webrtc-audio-chat`, `microphone-chat`, `cloud-telephony-chat`.
  - Admin (`SocketConnectionPaths`): `scenarios/reports`, `scenarios/translations` (the scenario-report stream; e.g. `REPORTS_UPDATED` payloads, with a `REPORTS_LOOKBACK_MINUTES` window).
- **LiveKit**: Real-time voice/video for helpline sessions and admin simulation previews via `livekit-client` / `@livekit/components-react` (`VITE_LIVEKIT_URL`; tokens issued by the backend).
- **Auth flow**: JWT-based (access + refresh) issued by `ally-be`. The admin dashboard logs in via OTP (phone/email) and refreshes access tokens automatically; routes are gated by backend-provided permissions.
- Sibling repos in the platform include **ally-be** (backend) and **ally-mobile** (React Native app).

## Local Setup

Requires Node.js v22, npm, and Docker (Docker Desktop or Colima).

**Without Docker:**
```bash
npm install
npm run start:helpline   # helpline dashboard     → http://localhost:8080
npm run start:admin      # admin dashboard        → http://localhost:8081

# Or use Nx directly:
npx nx dev   ally-web
npx nx serve ally-helpline-dashboard
npx nx serve ally-admin-dashboard
```

**With Docker (from repo root):**
```bash
docker build -f Dockerfile.deps -t ally-web/deps:dev .   # build shared deps image once
docker compose up                                         # start all three services
docker compose up web|helpline|admin                      # or a single service
```

Switch Docker backends with `./scripts/docker-switch.sh desktop|colima`. Environment variables are per-app `.env` files (see `compose.yaml`): `VITE_API_BASE_URL` (dashboards), `VITE_LIVEKIT_URL` (admin).

At the workspace level, the wider Ally dev environment can be bootstrapped from the `infra` repo (`infra/dev_env.sh`).

**Production builds:**
```bash
npm run build:web        # nx build ally-web
npm run build:helpline   # nx build ally-helpline-dashboard
npm run build:admin      # nx build ally-admin-dashboard
npm run build:prod       # nx build ally-helpline-dashboard --configuration=production
```

## Testing & Code Quality

Testing uses **Vitest** (+ Testing Library) for the apps and **Jest** for `ui-shared`, orchestrated through Nx.

```bash
npm test                 # nx run-many --target=test --all
npm run test:watch
npm run test:coverage
npm run test:web         # per-app: also :helpline, :admin, :ui-shared
```

**Dockerized tests** (isolated, reproducible; defined in `compose.test.yaml`, driven by `test-docker.sh`):
```bash
npm run test:docker            # ./test-docker.sh all
npm run test:docker:web        # also :admin, :helpline, :ui-shared
npm run test:docker:watch      # watch mode against dev containers
npm run test:docker:coverage   # coverage → ./coverage
npm run test:docker:clean
```

**Lint & format:**
```bash
npm run lint         # eslint . --ext .js,.jsx,.ts,.tsx
npm run lint:fix
npm run format       # prettier --write .
npm run format:check
```

Git hooks (Husky + lint-staged) auto-run ESLint and Prettier on staged files, plus a `.pre-commit-config.yaml`. i18n strings can be synchronized with `npm run i18n:sync` (`scripts/i18n-sync.mjs`).

## Key Documentation

- `README.md` — Root overview: architecture, tech stack, directory layout, Docker/local setup, features, and troubleshooting.
- `CONTRIBUTING.md` — Git conventions: branch naming, conventional commits, PR format, review process.
- `TESTING.md` — Dockerized testing strategy (ephemeral vs. dev-container), commands, and CI integration.
- `apps/ally-helpline-dashboard/README.md` — Helpline dashboard features, structure, and scripts.
- `apps/ally-admin-dashboard/README.md` — Admin dashboard features, full API endpoint list, permissions, path aliases.
- `libs/ui-shared/README.md` — Shared UI library (Nx-generated).
- `libs/ui-shared/src/lib/*/*.md` — Component guides: `INFINITE_SCROLL.md`, `GENERIC_TABLE.md`, `RESOURCE_SEARCH.md`.
- `docs/colima.md` — Colima (Docker Desktop alternative) setup.
- `docs/prompts-meta.md` — Prompt display names via `.meta.json`.
- `docs/posthog-implementation-guide.md`, `docs/new-posthog-event-adding-guide.md`, `docs/current-posthog-events-traking-list.md` — PostHog analytics implementation and event tracking.
- `scripts/README.md` — Helper scripts (`docker-switch.sh`, `i18n-sync.mjs`).
- `.github/WORKFLOWS.md`, `.github/RELEASE_GUIDE.md` — CI workflows and release process.

---

*Part of the [Ally Platform](../platform/overview.md). See also: [Architecture](../platform/architecture.md), [Scribe Summary Writes](../platform/scribe-summary-writes.md), [ally-be](ally-be.md), [ally-mobile](ally-mobile.md).*
