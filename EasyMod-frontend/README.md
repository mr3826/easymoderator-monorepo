# EasyMod Frontend

React 18 / Vite / TypeScript SPA for Easy Moderator. Provides a merchant dashboard for managing AI-powered customer conversations, orders, product catalog, subscription billing, and channel connections.

---

## Architecture

```
src/
├── app/                    # Application shell
│   ├── App.tsx             # Root component (theme, i18n, query client, Sentry)
│   ├── routes.ts           # React Router v6 route definitions
│   ├── components/         # Page-level and feature components
│   ├── features/           # Self-contained feature modules (e.g. users/)
│   ├── lib/                # App-level utilities (auth, subscriptionPlans, etc.)
│   └── constants/          # Static enums and configuration
├── api/                    # HTTP client + domain API functions
│   ├── index.ts            # Re-exports + legacy apiClient singleton
│   ├── types/              # Shared TypeScript types for API responses
│   └── domains/            # Domain-namespaced API functions (auth, product, etc.)
├── shared/                 # Cross-cutting utilities
│   ├── components/         # Shared UI components (guards, error boundaries, etc.)
│   ├── context/            # React contexts (Auth)
│   ├── hooks/              # Shared hooks (useDebounce, useIntersection, etc.)
│   └── lib/
│       └── http/           # Axios client, request interceptors, error helpers
├── i18n/                   # Internationalization (en + bn locales)
├── styles/                 # Global CSS / Tailwind base
├── entry-client.tsx        # Client-side hydration entry
└── main.tsx                # Dev entry point
```

### Tech Stack

| Concern | Library |
|---|---|
| Framework | React 18 |
| Build | Vite |
| Language | TypeScript |
| Routing | React Router v6 |
| Server state | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| UI components | Radix UI primitives + Tailwind CSS |
| Drag-and-drop | react-dnd |
| i18n | i18next (en + bn) |
| Error tracking | Sentry |
| Unit tests | Vitest |
| E2E tests | Playwright |

---

## Routing

All authenticated routes are children of `/app` (protected by `protectedLoader` — redirects to `/` if not authenticated). Public routes have `publicLoader` (redirects to `/app` if already authenticated).

```
/                          Landing page
/signin                    Sign in
/signup                    Sign up
/forgot-password
/reset-password
/pricing                   Public pricing page
/privacy-policy
/terms

/app                       Dashboard (DashboardLayout shell)
/app/inbox                 Unified Inbox
/app/channels              Channel connections
/app/manage-shop           Shop settings (tabbed)
  /app/manage-shop                      Business info
  /app/manage-shop/chat-settings        AI + automation config
  /app/manage-shop/delivery-settings    Delivery zones
  /app/manage-shop/payment-settings     Payment method config
/app/products              Product list
/app/products/add
/app/products/:id
/app/products/:id/edit
/app/categories
/app/orders
/app/customers
/app/knowledge             Knowledge base / RAG documents
/app/reports
/app/audit-logs
/app/subscription          Subscription management + top-up
/app/admin/users           Admin only — user management
/app/channels/oauth-callback  Meta OAuth popup handler (standalone, no shell)

/bd-lite                   Simplified BD seller view (BDSellerShell)
/bd-lite/inbox
/bd-lite/orders
/bd-lite/settings
```

---

## API Layer

All HTTP calls go through a single Axios instance at `src/shared/lib/http/client.ts`. The interceptor:
- Attaches `Authorization: Bearer <token>` from auth state
- On 401 → calls `auth.refreshToken()` once, then retries
- On refresh failure → clears auth state + redirects to `/signin`

**Domain functions** live in `src/api/domains/`:

```
auth.ts         signup, signin, logout, refreshToken, getAuthContext
product.ts      getProducts, createProduct, updateProduct, deleteProduct
order.ts        getOrders, createOrder, updateOrderStatus, getOrderStats
customer.ts     getCustomers, getCustomerById
channel.ts      getChannels, connectMetaChannel, disconnectChannel
dashboard.ts    getDashboardStats
knowledge.ts    getDocuments, uploadDocument, deleteDocument
subscription.ts getSubscription, upgradeSubscription, purchaseTopup, getUsage
conversation.ts getConversations, resolveConversation, handoffConversation
shop.ts         getShopContext, updateShop, updatePlatformPriority
payment.ts      getPaymentMethods, updatePaymentMethods
audit.ts        getAuditLogs
```

**Prefer domain imports** over the legacy `apiClient` singleton:
```typescript
// Good
import { subscription } from '@/api/domains';
const usage = await subscription.getUsage();

// Avoid (legacy, being phased out)
import { apiClient } from '@/api';
```

---

## Features

### Unified Inbox (`/app/inbox`)

Core feature. Displays all active conversations across all connected channels. Each conversation card shows customer name, channel icon, last message, and AI confidence.

- Real-time polling via TanStack Query
- Conversation detail panel (inline, not a modal)
- Send message / approve AI draft
- Handoff to human / resolve conversation
- Filter by: channel, status (new/active/handoff/resolved), date

### Channels (`/app/channels`)

Connect and manage communication channels. Supported: Facebook Page, WhatsApp Business (via permanent token), Instagram, Webchat, Telegram.

- Meta OAuth popup (`/app/channels/oauth-callback` handles postMessage)
- WhatsApp: enter WABA ID + Phone Number ID + permanent token directly (no OAuth)
- Channel status (connected / token expired / error)
- All channels available on all subscription plans — no channel limits

### Subscription (`/app/subscription`)

Subscription management page. Displays current plan, monthly conversation usage, and top-up options.

**Plans:**

| Code | Display name | Price | Conversation limit |
|---|---|---|---|
| `PACKAGE_1` | Package 1 | 750 BDT/month | 500/month |
| `PACKAGE_2` | Package 2 | 1,950 BDT/month | 1,500/month |
| `PARTNER` | Partner | 0 BDT upfront | Billed per delivered order |

**PARTNER billing** is per-order tiered: 15 BDT (1–500 orders), 12 BDT (501–1,000), 10 BDT (1,001+).

**Top-up packs** (BKash only): +100 (150 BDT), +250 (350 BDT), +500 (650 BDT), +1,000 (1,200 BDT).

Conversation usage bar shown with threshold warnings at 75% / 90% / 100%. The `ConversationAlertBanner` component renders a sticky banner when usage is at or above 75%.

### Manage Shop (`/app/manage-shop`)

Tabbed settings area:

- **Business Info** — name, address, logo, contact
- **Chat Settings** — AI automation mode (DRAFT / MANUAL / AUTO), confidence threshold, language (en/bn/mixed), tone/persona, handoff rules
- **Delivery Settings** — delivery zone configuration, courier mapping, `PlatformPrioritySettings` drag-to-reorder
- **Payment Settings** — accepted payment methods (BKash, COD, bank transfer), `PlatformPrioritySettings` drag-to-reorder

`PlatformPrioritySettings` uses react-dnd for drag-to-reorder. Order is saved to the shop's `payment_platform_priority` / `delivery_platform_priority` JSONB column.

### Products & Categories

Standard catalog management:
- Product list with search, filter by category, pagination
- Add/edit product: name, price, variants, images, stock level, SKU
- Category → subcategory hierarchy
- Manual "Sync to Knowledge Base" button per product

### Orders (`/app/orders`)

Order management table:
- Filter by status, date range, courier
- Click row → order detail (products, customer info, delivery address, payment status)
- Status transitions: pending → confirmed → processing → shipped → delivered
- RTO risk badge (high/medium/low) shown on risky orders

### Customers (`/app/customers`)

Customer list and detail view:
- Order history, total spend, last active date
- Customer journey timeline (sequence of conversation events)

### Knowledge Base (`/app/knowledge`)

Upload documents (PDF, DOCX, plain text) that the AI uses to answer product/policy questions.
- Upload → backend extracts text → embeds into Qdrant
- Delete removes vectors from Qdrant
- Documents auto-indexed nightly from product catalog

### Reports (`/app/reports`)

Analytics charts:
- Conversation volume by day/week/month
- AI resolution rate, handoff rate
- Order GMV, fulfillment rate, RTO rate
- Top products by order count

### Audit Logs (`/app/audit-logs`)

Admin view of all system events (user actions, AI decisions, payment events).

### BD-Lite (`/bd-lite`)

Simplified shell (`BDSellerShell`) for mobile-first Bangladesh merchants. Subset of features: today's queue dashboard, inbox, orders, basic settings. Shares the same components as the main app.

---

## State Management

- **Server state** — TanStack Query. Query keys follow the pattern `[domain, operation, ...params]`.
- **Auth state** — `AuthContext` (`src/shared/context/AuthContext.tsx`). Initialized once via `authService.ensureInitialized()` in route loaders. Do not read auth from localStorage directly.
- **UI state** — local `useState` within components. No global client-side store.

---

## Internationalization

Two locales: `en` (English) and `bn` (Bengali). Language auto-detected from browser, switchable in UI.

Locale files: `src/i18n/locales/en.json`, `src/i18n/locales/bn.json`.

Usage:
```typescript
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();
// t('key.path')
```

---

## Feature Gating

`FeatureGate` component (`src/app/components/FeatureGate.tsx`) shows an upgrade prompt when a feature requires a higher plan. Pass `requiredPlan="PACKAGE_2"` or `requiredPlan="PARTNER"`.

`useSubscriptionFeatures` hook (`src/app/lib/useSubscriptionFeatures.ts`) returns the current plan's feature flags from the shop context.

---

## Environment Variables

Vite env vars (prefix `VITE_` — available in browser bundle):

```env
VITE_API_BASE_URL=http://localhost:3000/api   # Backend API base URL
VITE_META_APP_ID=                             # Meta App ID for OAuth popup
VITE_SENTRY_DSN=                              # Optional Sentry DSN
VITE_ENV=development                          # development | production
```

Set at build time in CI (injected as `--build-arg` into Docker). **Do not put secrets here** — all values are visible in the built JS bundle.

---

## Local Development

```sh
npm install
npm run dev          # Vite dev server on :5173
```

The dev server proxies `/api` requests to `VITE_API_BASE_URL` (set in `.env.local`).

---

## Testing

```sh
npm run test:unit    # Vitest unit tests
npm run test:e2e     # Playwright end-to-end
npm run test:all     # both
```

Unit tests in `src/**/__tests__/`. E2E tests in `tests/`.

---

## Build & Docker

```sh
npm run build        # Vite production build → dist/
```

`Dockerfile` is multi-stage:
1. Node 20 alpine — `npm ci && npm run build`
2. nginx alpine — serves `dist/` with `nginx.conf`

`nginx.conf` routes all paths to `index.html` (SPA fallback) and proxies `/api` to the backend container.

---

## Deployment

Same GitHub Actions workflow as the backend (`.github/workflows/deploy.yml`). On push to `main`:

1. `dorny/paths-filter` detects `EasyMod-frontend/**` changes
2. Docker image built with `VITE_*` build args injected from GitHub Secrets
3. Image pushed to `ghcr.io/.../easymod-frontend:latest`
4. Deploy job SSHs into droplet and runs `docker compose up -d`

No database migrations for frontend. No health check step (nginx serves static files).

---

## Key Design Decisions

- **No global state store** — TanStack Query handles all server state; component-local state for UI
- **Domain API functions over apiClient** — the `apiClient` singleton is legacy; prefer `import { auth } from '@/api/domains'`
- **Lazy loading everywhere** — every page component is `React.lazy()` via `createBrowserRouter`; initial bundle is small
- **BKash-only payment UI** — Nagad and Rocket removed from all UI; do not re-add
- **No channel limits in UI** — do not show or enforce channel count; all channels are available on all plans
- **Plan codes in logic, display names in i18n** — use `PACKAGE_1`/`PACKAGE_2`/`PARTNER` in code; translate to user-facing strings via i18n keys
- **One shop per user** — no shop-switch UI; `DashboardLayout` does not render a shop selector
