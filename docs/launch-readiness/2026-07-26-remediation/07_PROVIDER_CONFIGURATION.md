# 07 — Provider Configuration (bKash posture + alerting)

## bKash — disabled for the controlled pilot

One or more bKash merchant credentials are missing and no real-money certification exists. Per policy, bKash is **off** for the pilot and no fake credential was created.

**Backend**
- `production-config.validator.js`: `BKASH_WEBHOOK_SECRET` moved out of `CORE_REQUIRED`; the full `BKASH_REQUIRED` set (incl. the webhook secret) applies **only** when `BKASH_ENABLED=true`.
- `render-production-env.js`: when disabled, renders `BKASH_ENABLED=false` and **no** bKash credential at all.
- `bangladesh-payment.service.js`: `isBkashEnabled()` requires `BKASH_ENABLED==="true"` **and** all five merchant creds. `assertEnabled()` throws `AppError(503)` at the top of `initializeBkashPayment`, `verifyBkashPayment`, `getBkashToken`, `refundBkashPayment` — so no code path reaches the bKash network while disabled or half-configured. `getSupportedPaymentMethods()`/`validatePaymentConfig()` report disabled.

**Workflow** (`ci-cd.yml`)
- `BKASH_ENABLED: ${{ vars.BKASH_ENABLED || 'false' }}` — flip the Actions **variable** to `"true"` only after every `BKASH_*` secret is set and a real-money test is signed off.

**Frontend**
- `app/lib/config.ts` → `isBkashEnabled()` (`VITE_BKASH_ENABLED === "true"`, opt-in only).
- `BKashCheckout.tsx` renders an honest unavailable card (no packs, no button) when disabled.
- `Subscription.tsx` hides the pay/activate CTA and the top-up purchase surface when disabled.
- `ci-cd.yml` builds the frontend with `VITE_BKASH_ENABLED=${{ vars.BKASH_ENABLED || 'false' }}`.

**Tests**
- `production-config.validator.test.js`: disabled + no `BKASH_WEBHOOK_SECRET` → valid; enabled + missing cred → invalid.
- `render-production-env.test.js`: disabled renders no merchant cred; enabled + missing cred → preflight throws.
- `bangladesh-payment.disabled.test.js`: every entry point throws 503 and makes **no** HTTP call when disabled or half-configured; `getSupportedPaymentMethods`/`validatePaymentConfig` report disabled.
- `BKashCheckout.test.tsx`: unavailable state + no button when disabled; purchase surface only when explicitly enabled.

Honesty: pricing/trial copy is unchanged and truthful; a disabled deployment shows no live-money claim.

## Backend alerting (F-06)

- `SENTRY_DSN` (backend) is a different name from `VITE_SENTRY_DSN` (frontend). The deploy workflow now sets `SENTRY_DSN: ${{ secrets.SENTRY_DSN || secrets.VITE_SENTRY_DSN }}`, so the backend gets a sink from the existing frontend DSN (shared project) until a dedicated backend DSN is provisioned. No value is read or duplicated.
- Admin-only self-test: `POST /api/admin/ops/test-alert` (SUPER_ADMIN only) fires a PII-free alert and returns which sinks are configured and whether each accepted the event, plus a note. `ops-alert.js` gains `describeAlertSinks()` (booleans only) and `sendTestAlert()` (throttle-bypassing, PII-free).
- **This does not by itself close launch gate 8.** A human must confirm receipt on a watched device — a founder action.

**Tests**: `ops-alert.test.js` — `describeAlertSinks` returns booleans only (never URL/DSN); no sink → nothing sent; Slack configured → posts + reports acceptance; test alert carries no customer data; bypasses throttle.
