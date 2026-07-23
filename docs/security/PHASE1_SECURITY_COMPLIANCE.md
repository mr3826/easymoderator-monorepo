# Phase 1 Security, Meta Compliance, and Production Preflight

Status: implemented on `codex/phase1-security-compliance`; review-only until the
founder merges the pull request. This branch must not be deployed directly.

## Meta identity and data deletion

EasyModerator now stores a legitimate identity bridge captured during Facebook
Login:

- Meta app-scoped user ID from `/me`
- Page-scoped user ID returned by Meta's `ids_for_pages` edge, when available
- the connected `meta_channels` row
- the EasyModerator shop and internal merchant user

The application never fabricates a Page-scoped ID. If Meta does not return a
Page identity, the mapping can still identify channels for deauthorization, but
it cannot identify a Messenger customer for deletion. Channels connected before
this migration must reconnect once to seed the mapping. An unmatched deletion
request completes with zero customer matches; it never guesses across shops or
Pages.

For a mapped Messenger customer, the deletion transaction:

1. records receipt, signed-request validation, and identity resolution;
2. records a strict consent/deletion event;
3. identifies the customer by exact shop, Page channel, and Page-scoped ID;
4. deletes conversations, messages, customer preferences, delivery-risk
   profile data, and the customer profile;
5. retains orders and financial facts while removing the customer foreign key
   and anonymizing name, phone, delivery address/location/zone, instructions,
   and free-text notes;
6. scrubs customer PII copied into owner notifications;
7. deletes only server-owned conversation attachment paths under
   `uploads/conversation-attachments`;
8. records completion or a sanitized failure code.

The durable `meta_data_deletion_requests` record contains hashes and counters,
not the raw signed request, Meta ID, confirmation code, or remote attachment
URLs. Repeated callbacks are idempotent. Database failures roll back the data
transaction and return an error instead of a false success. A committed data
phase is checkpointed so a stale worker resumes only outstanding attachment
cleanup and completion-audit work rather than deleting twice. Attachment
cleanup failures remain `failed` and retry only the outstanding server-owned
paths.

Status endpoint:

```text
POST /api/webhooks/meta/data-deletion
GET  /api/webhooks/meta/data-deletion/status/:confirmationCode
```

## Meta deauthorization and invalid-token recovery

A valid deauthorization callback resolves every channel associated with the
app-scoped identity and:

- records the deauthorization consent/audit event;
- attempts Page webhook unsubscribe;
- disables automatic AI processing;
- clears the stored Page access token;
- marks the channel `REVOKED`;
- removes queued outbound jobs for the channel;
- creates an owner-visible dashboard notification;
- emits an operational alert.

The identity mapping is intentionally retained after deauthorization so a later
data-deletion request can still resolve the affected customer records.

Meta send failures that indicate invalid or expired authorization mark the
channel `TOKEN_EXPIRED`, preserve the failed BullMQ job in failed-job retention,
stop futile automatic retries, and expose the existing reconnect action in
Channel Settings. Notification or unsubscribe failure does not leave the
channel marked `CONNECTED`.

## Route inventory

| Route | Exposure | Tenant/security contract |
|---|---|---|
| `/api/ai-chatbot/*` | Removed from root router | Legacy browser-callable process, context, and handoff endpoints are not mounted. The Messenger worker is authoritative. |
| `/api/payment/bangladesh/*` | Removed from root router | The obsolete duplicate router, including its unauthenticated callback and client-selected tenant operations, is no longer reachable. Canonical authenticated payment routes and `/api/webhooks/bkash/payment-status` remain. Existing callers of this legacy surface receive `404`; no frontend caller was found. |
| `GET /api/conversation/events` | Merchant-authenticated | Shop comes only from the access token. `x-shop-id` and `shop_id` query overrides are rejected. |
| `/api/conversation/*` | Merchant-authenticated | Reads and mutations use `req.user.shopId`; client shop selectors are not authoritative. |
| `POST /api/analytics/knowledge-gap` | Merchant-authenticated | Token shop binding, Messenger-only input, 1,000-character bound, 30/minute rate limit, and audit event. |
| `POST /api/notifications/mark-handoff` | Merchant-authenticated | Token shop binding; cross-shop body selectors are rejected. |
| `POST /api/notifications/push` | Merchant-authenticated | Token shop binding; cross-shop body selectors are rejected. |
| `/api/delivery/rag/*` | Merchant-authenticated | All reads and mutations bind to the token shop; client body/query/path shop overrides are rejected. Global collection initialization requires `SUPER_ADMIN`. |
| `POST /api/notifications/payment-confirmation/:notificationId/:action` | Authenticated owner only | Exact notification shop, active owner membership, pending/unexpired notification and payment states, row locks, replay rejection, 10/minute rate limit, and append-only audit event. |
| `/api/webhooks/owner/payment-confirmation/*` | Removed | No public link can approve or reject a payment. Email directs owners to the authenticated dashboard. |
| `POST /api/webhooks/bkash/payment-status` | Public provider callback | Required bKash HMAC, timing-safe comparison, atomic payment claim, state-transition validation, and duplicate fulfillment prevention. |
| `POST /api/webhooks/delivery/steadfast` and legacy `/webhooks/delivery/steadfast` | Public provider callback | Per-shop raw-body HMAC with the active integration secret; missing config fails closed. |
| `POST /api/webhooks/delivery/pathao` and legacy `/webhooks/delivery/pathao` | Public provider callback | Per-shop raw-body HMAC with the active integration secret; missing config fails closed. |
| `POST /api/webhooks/delivery/redx` and legacy `/webhooks/delivery/redx` | Public provider callback | Exact timing-safe bearer API-key verification bound through an existing tracking record. |
| `POST /api/webhooks/telegram` | Public Telegram callback | Required `X-Telegram-Bot-Api-Secret-Token`; disabled or unconfigured service fails closed. |
| `POST /api/webhooks/meta` | Public Meta callback | Raw-body `X-Hub-Signature-256` HMAC; unconfigured app secret fails closed. |
| Meta deletion/deauthorization callbacks | Public Meta callbacks | HMAC-SHA256 signed request, 24-hour maximum age, five-minute clock-skew allowance, and durable/auditable processing. |

The public `/api/analytics/funnel` endpoint remains intentionally public for the
first-party acquisition funnel. It accepts only a fixed event allowlist, does
not accept a tenant ID, and is not a tenant-data mutation path.

## Webhook limitations

- Steadfast and Pathao use the raw-body HMAC formats represented by their
  existing EasyModerator integration credentials. The current payload
  contracts do not expose a provider timestamp, so replay resistance comes from
  idempotent status handling rather than a timestamp window.
- RedX's represented contract is bearer API-key verification, not a
  cryptographic per-payload signature. The request must resolve through an
  existing RedX tracking record and active shop integration.
- Startup checks decrypt every active courier integration and fail if the
  provider-specific verification credential is absent.

## External media policy

All server-side LLM image retrieval goes through `safe-media-fetch.js`.

- HTTPS only
- no URL credentials, localhost, literal IP hosts, private/reserved networks,
  metadata endpoints, or unsafe IPv6 ranges
- DNS resolution validation plus a pinned connection lookup
- Meta CDN, EasyModerator-controlled base URLs, and explicitly configured media
  hosts only
- every redirect revalidated, maximum two redirects
- 10-second connection and total deadline, 8 MiB response limit, image MIME
  types only
- no caller authentication headers forwarded

OpenAI receives a validated data URL rather than the original arbitrary URL.

## Production configuration

The production renderer writes dotenv values with JSON-safe quoting, creates
the file with mode `0600`, prints variable names/counts only, and validates
before the workflow copies the file or replaces a container. The candidate
backend image repeats the configuration validation before container
replacement.

Always required in production/staging:

- database/Redis: `DATABASE_URL`, `REDIS_URL`
- auth/security: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`,
  `CSRF_SECRET`, `PAYMENT_ENCRYPTION_KEY`, `DELIVERY_ENCRYPTION_KEY`,
  `CHANNEL_ENCRYPTION_KEY`, `PAYMENT_CALLBACK_HMAC_SECRET`
- application URLs: `CORS_ORIGINS`, `FRONTEND_URL`, `BASE_URL`
- Meta: `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
  `META_OAUTH_REDIRECT_URI`
- bKash callback: `BKASH_WEBHOOK_SECRET`
- email: `RESEND_API_KEY`, `EMAIL_FROM`
- at least one LLM key: `OPENAI_API_KEY` or `GEMINI_API_KEY`
- at least one alert path: `SENTRY_DSN` or `SLACK_ALERT_WEBHOOK_URL`

When `BKASH_ENABLED=true`, all merchant credentials and
`BKASH_SANDBOX=false` are required. When Telegram is enabled or partly
configured, token, username, and webhook secret are all required. All three
encryption keys must be 64 hexadecimal characters and are exercised with
AES-256 during preflight. Long secrets must be at least 32 characters and may
not use known example placeholders.

See `.env.prod.example` for the complete name-only template. Never paste values
into source, logs, test output, pull-request bodies, or workflow summaries.

## Security verification

Merge-blocking focused suite:

```bash
cd EasyMod-backend
npm run test:security
```

Full local verification:

```bash
cd EasyMod-backend
npm test -- --runInBand

cd ../EasyMod-frontend
npm run test:unit
npm run build
```

Frontend unit tests are blocking in CI after the Phase 1 green baseline.

Security-relevant auth tests are re-enabled. The following Jest exclusions
remain because they require live infrastructure or cover unrelated incomplete
modules: subscription usage integration (database), smart-payment detection
(ESM Chai plus live database), voice processing (long-running external
infrastructure), customer intelligence (module absent), chatbot RAG (database,
Redis, and running server), legacy auth ordering suites, campaign tests for a
removed module, broad order/product/shop API integrations, and notification or
customer integration suites requiring the full application database. Focused
Phase 1 tests cover the changed auth, tenant, payment, webhook, Meta, and SSRF
paths without real sends, charges, courier bookings, or production secrets.

## Recovery and rollback

Invalid Meta authorization is recovered by reconnecting the Page from Channel
Settings. Reconnect writes fresh identity mappings and Page tokens; failed
message records remain available for controlled retry.

To roll back the code, redeploy the prior `main` image tags through the canonical
Docker Compose workflow. The migration down action drops only the two new
compliance tables and its enum. Do not run that down action while a deletion
request is pending; it removes status/audit correlation and identity mappings.
The customer/order anonymization performed by a completed deletion is
intentionally irreversible and must never be restored from application backups
except under an approved legal incident procedure.
