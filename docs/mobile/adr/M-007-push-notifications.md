# ADR-M-007: Native Push via Existing FCM Sender, Not Expo Push Service

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

The backend already has a working FCM sender (firebase-admin) and a `push_subscriptions` table
with a `type: 'fcm'` row shape and a working registration route
(`push-subscription.routes.js:15-88`) that accepts exactly the token shape
`getDevicePushTokenAsync()` produces (`CURRENT_STATE.md` §8). FCM sending is currently disabled in
production only because `FIREBASE_SERVICE_ACCOUNT_JSON` is absent from the production env
allowlist — a human-gated provisioning step, not a code gap. Separately, `CURRENT_STATE.md` §8
documents a real pre-existing defect: `push-notification.service.js:128` sends to every
subscription row for a shop with no membership check, and `removeUserFromShop`
(`shop.service.js:254-288`) never cleans up `push_subscriptions` — this is Track D fix #4, fixed
on `main` independently of this ADR, before the mobile client and this fix rely on the same send path.

## Decision

Use `getDevicePushTokenAsync()` (native FCM token, not the Expo push token/service) and register it
against the existing `POST /api/notifications/subscriptions` endpoint with `type: 'fcm'` — no new
registration endpoint needed. All additions are additive: user-scoped rows (already the schema),
explicit unregistration on logout and on session revoke (native session logout calls
`DELETE /api/notifications/subscriptions/:id` for its own device token), per-conversation
AI-handoff dedupe (extending the existing per-shop dedup key to include conversation id so five
simultaneous handoffs don't produce five redundant push notifications on one device), a minimal
lock-screen payload (no message content beyond what's already policy-safe to show — never full
private message text, per the program's logging/data constraints), and `data.entity`/`data.id` in
the payload so the app can deep-link (`easymod://order/:id`, `easymod://conversation/:id`) directly
to the relevant screen from a notification tap, with a stale-entity check on open (the linked
order/conversation may have changed state or been reassigned since the push was sent).

## Assumptions

- Track D fix #4 (push membership targeting) lands on `main` and merges into `feature/mobile-app`
  before Phase 2 (Home/Attention + Push) begins real device testing, so mobile never builds against
  the known-broken send path.
- Firebase project provisioning and `FIREBASE_SERVICE_ACCOUNT_JSON` in the production allowlist are
  human gates (per the program plan) completed before Phase 2's human-gate checkpoint; until then,
  Phase 1/2 development and tests run against a disposable backend with a stubbed FCM sender.

## Alternatives Rejected

- **Expo push notification service (Expo's hosted push relay).** Rejected: it would require a
  second server-side sender (Expo push tokens are not FCM tokens) duplicating infrastructure the
  backend already has working and tested; the existing firebase-admin sender is the simpler, more
  auditable path and keeps exactly one push-sending code path in the whole system.
- **Build a new mobile-specific subscriptions table.** Rejected: `push_subscriptions` already has
  the right shape (`shop_id`, `user_id`, `type`, `device_token`) and the right route; a second
  table would only fragment the send-side query Track D fix #4 is already correcting.

## Consequences

- Positive: no new backend push infrastructure; the mobile client is simply a second, correctly
  registered consumer of an existing, now-corrected send path.
- Positive: deep links carry the merchant directly into the exact screen a notification is about,
  reducing the "open app, then hunt for what changed" friction the brief's priority list is
  designed to eliminate.
- Negative: native FCM (not Expo's managed push) means push testing requires a real or emulated
  Google Play Services environment, not Expo Go — consistent with ADR M-002's development-build choice.
- Required follow-up: the per-conversation dedupe key and the stale-entity deep-link check are both
  explicit Phase 2/3 test cases, not left to manual QA.
