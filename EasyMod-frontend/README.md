# Easy Moderator — Frontend

The merchant dashboard and marketing site for Easy Moderator — an AI customer-service and order-automation platform for Bangladeshi f-commerce sellers. Sellers connect Facebook Pages, then manage a Messenger inbox, products, orders, couriers, and billing from this single-page app.

Built with **React 18 + Vite 6 + TypeScript**, installable as a **PWA**, and localised for English and Bengali/Banglish seller workflows.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Routes & Screens](#routes--screens)
- [API Layer](#api-layer)
- [State, Auth & Security](#state-auth--security)
- [Internationalisation](#internationalisation)
- [PWA & Push](#pwa--push)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Build & Deployment](#build--deployment)
- [Conventions](#conventions)

---

## Tech Stack

| Concern | Technology |
|---|---|
| Framework | React 18 |
| Build tool | Vite 6 (`@vitejs/plugin-react`) |
| Language | TypeScript |
| Routing | React Router 7 (`react-router-dom`) — lazy/code-split routes |
| Server state | TanStack Query 5 |
| HTTP | Axios (withCredentials, CSRF + refresh interceptors) |
| UI primitives | Radix UI + custom components |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) |
| Forms / validation | React Hook Form + Zod |
| Charts | Recharts |
| Animation | Framer Motion / Motion |
| i18n | i18next + react-i18next (English fallback, persisted language toggle) |
| Errors | Sentry (`@sentry/react`) |
| Tests | Vitest + Testing Library (unit, happy-dom), Playwright (e2e) |

---

## Architecture

A client-rendered SPA served as static assets by nginx, talking to the [Easy Moderator backend](../EasyMod-backend) over a JSON API. In production the SPA is **same-origin** with the API (empty `VITE_API_BASE_URL`), so cookies and CSRF work without cross-site complications.

```
Browser
  │
  ├─ React SPA (this app)  ── static assets via nginx
  │     │
  │     ├─ TanStack Query  ── cache + request dedupe
  │     └─ Axios client    ── credentials + CSRF + token refresh
  │            │
  └────────────┴─────────►  Backend API  (/api/*)
                                 │
                                 └─ SSE (/health/sse) ── live inbox updates
```

The app code lives almost entirely under `src/app/` (the product dashboard). `src/features/` holds a few self-contained feature slices (auth, users), and `src/shared/` + `src/lib/` hold cross-cutting utilities.

---

## Project Structure

```
src/
├── main.tsx                # CSR entry (createRoot)
├── entry-client.tsx        # hydration entry (hydrateRoot) for prerendered shell
├── sentry.ts               # Sentry init
├── api/
│   ├── index.ts            # axios instance + interceptors (CSRF, refresh, errors)
│   ├── domains/            # one typed client module per domain (see API Layer)
│   └── types/              # shared API response/DTO types
├── app/
│   ├── App.tsx             # app shell + providers
│   ├── routes.ts           # route table (lazy-loaded components)
│   ├── components/         # screen + widget components
│   │   ├── inbox/          # unified-inbox subcomponents
│   │   └── bd-lite/        # streamlined "today's queue" seller shell
│   ├── lib/                # meta (OAuth popup), motion, policy, push helpers
│   ├── features/
│   └── constants/
├── features/
│   ├── auth/               # sign-in/up, guards, auth context
│   └── users/              # admin user management
├── shared/                 # components, context, lib, types shared app-wide
├── i18n/
│   ├── index.ts            # i18next config (English fallback + localStorage language detection)
│   └── locales/{en,bn}.json
├── assets/ · data/ · styles/
└── test/ · __tests__/      # Vitest specs + setup
```

---

## Routes & Screens

Routes are defined in `src/app/routes.ts` and lazy-loaded for code-splitting. Authenticated app routes live under `/app/*` behind an auth guard; admin-only routes use `AdminRoute`.

**Public / marketing**

- `/` — Landing page
- `/pricing` — Pricing
- `/privacy-policy`, `/terms` — Legal (required for Meta App Review)
- `/signin`, `/signup`, `/forgot-password`, `/reset-password`, 2FA verify

**Dashboard (`/app/*`)**

- Dashboard (KPIs / cash position)
- Unified Inbox for Facebook Messenger DMs
- Products, Add/Edit Product, Categories & subcategories
- Orders
- Customers
- Reports & Analytics, Audit Logs
- Channels (Meta OAuth connect + per-channel health) + OAuth callback
- Settings hub: Chat/AI, Delivery, Payment, Notifications, Business Info, FAQs (`/app/manage-shop/faqs`; `/app/knowledge` redirects here)
- Subscription & billing
- Users (admin)
- `bd-lite` seller shell (`Today's Queue` simplified view)

---

## API Layer

`src/api/domains/` contains one typed client per backend domain, all sharing the configured Axios instance from `src/api/index.ts`:

```
auth · shop · conversation · customer · order · product · knowledge
dashboard · payment · subscription · meta-channels · audit · rto-shield · notification
```

The Axios instance sends credentials, attaches the CSRF token, transparently refreshes the access token on `401`, and normalises error shapes. Prefer adding new calls to the matching domain module rather than calling Axios directly from components.

Notification UI lives in `NotificationSettings` and `InAppNotificationCenter`. Browser push registration uses the same Axios client as the rest of the app so CSRF and cookie auth remain consistent.

---

## State, Auth & Security

- **Server state:** TanStack Query owns all server data (caching, dedupe, invalidation). Avoid duplicating it in local state.
- **Auth:** JWT access token + HttpOnly refresh cookie issued by the backend. `features/auth` provides the auth context, route guards, sign-in/up, password reset, and 2FA.
- **CSRF:** double-submit token wired through the Axios interceptor (`csrf-csrf` on the backend).
- **Errors:** Sentry captures runtime errors; an error boundary renders `RouteError`.

---

## Internationalisation

- `i18next` + `react-i18next`, with `i18next-browser-languagedetector`.
- **Default language: Bengali (`bn`).** English (`en`) is the secondary locale. The detector persists the choice in `localStorage` under `easymod_lang`; `fallbackLng` is `bn`, so a **missing key renders the raw key string** — keep both files in sync.
- Strings live in `src/i18n/locales/{en,bn}.json`. **Brand/product terms are intentionally kept in English** (e.g. "Easy Moderator", "RTO Shield").
- The global app-shell navigation (sidebar + mobile bottom-nav, in `DashboardLayout`) reads from the top-level **`nav.*`** namespace — never hardcode nav labels in a single language.
- Add a key to **both** locale files when introducing user-facing copy.
- **Known follow-up:** ~200 hardcoded-Bengali strings remain across onboarding/settings/pricing screens (tracked in the launch-readiness audit). They render correctly for the default Bengali audience but do not switch to English. Migrate them to i18n keys opportunistically when touching those screens.

---

## Responsive Design

The dashboard is **mobile-first** and used primarily on phones by BD sellers. Key patterns:

- **Shell swap (`DashboardLayout`):** a fixed left sidebar on desktop (`hidden md:flex`) is replaced by a 5-item fixed **bottom tab bar** on mobile (`md:hidden`), with `pb-20 md:pb-0` content padding and `env(safe-area-inset-bottom)` insets for notched devices.
- **Inbox single-pane (`UnifiedInbox`):** desktop shows the thread list and detail side-by-side; mobile shows one pane at a time via a `mobilePanelOpen` flag (`InboxThreadList` hides when a thread is open; `InboxThreadDetail` shows with a `md:hidden` back button).
- **Data tables:** wide tables (Products, Orders, Customers) are wrapped in `overflow-x-auto` with a `min-w-[...]` so they scroll horizontally instead of clipping under their rounded card on narrow screens.
- **Breakpoint convention:** Tailwind's `md` (768px) is the desktop/mobile divide throughout. Test new screens at ~360px width before merging.

---

## PWA & Push

- Installable PWA: `public/manifest.webmanifest` + icons + `public/sw.js` (offline-tolerant shell).
- Web Push notifications via `src/app/lib/pushNotification.ts` using a VAPID public key (`VITE_VAPID_PUBLIC_KEY`) — new conversations, order updates, and usage-threshold warnings.

---

## Getting Started

### Prerequisites

- Node.js 20+
- A running [backend](../EasyMod-backend) (or point `VITE_API_BASE_URL` at a deployed one)

### Setup

```sh
npm install

# create a local env file (see Environment Variables)
# point VITE_API_BASE_URL at your backend, e.g. http://localhost:3000

npm run dev      # Vite dev server (default http://localhost:5173)
```

---

## Environment Variables

Vite exposes only `VITE_`-prefixed variables to the client. Create `.env` / `.env.local`:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend API origin. **Leave empty in production** (SPA is same-origin with the API). |
| `VITE_API_URL` | Legacy alias for the API origin (kept for compatibility). |
| `VITE_ENV` | Environment label (`development` / `production`). |
| `VITE_SENTRY_DSN` | Sentry DSN (optional). |
| `VITE_VAPID_PUBLIC_KEY` | Web-push VAPID public key. |
| `VITE_BKASH_SANDBOX` | Toggle bKash sandbox UI behaviour. |

`VITE_META_APP_ID` is injected at build time in CI for the Meta OAuth flow.

---

## Testing

```sh
npm run test         # Vitest (watch)
npm run test:unit    # Vitest (run once)
npm run test:e2e     # Playwright
npm run test:all     # unit + e2e
```

Unit specs sit beside the code in `__tests__/` folders and under `src/test/`. The Vitest environment is `happy-dom` with globals enabled (`vitest.config.js`).

---

## Build & Deployment

```sh
npm run build        # vite build → dist/
```

CI/CD (GitHub Actions, repo root `.github/workflows/ci-cd.yml`) builds the SPA with the production `VITE_*` values, packages it into an nginx Docker image, pushes to GHCR, and deploys it alongside the backend on the Digital Ocean droplet. The SPA is served same-origin with the API behind Caddy/nginx (`www → apex` 301; canonical origin `https://easymod.tech`).

> The build can emit large-chunk warnings for vendor bundles such as `react-vendor`. Tighten `manualChunks` if bundle size becomes a concern.

---

## Conventions

- **API calls go through `src/api/domains/`** — never hand-roll Axios in a component.
- **Server data lives in TanStack Query** — don't mirror it into `useState`.
- **Every user-facing string is translated** and added to both `en.json` and `bn.json`; brand terms stay English.
- **Routes are lazy-loaded** in `routes.ts` to keep the initial bundle small.
