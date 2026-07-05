# Launch Blocker Stabilization Report

Date: 2026-07-06
Production site: `https://easymod.tech`
Final production backend SHA: `a9b310791e7969d085c9bf357f1a83a7f0f4e5d7`
Final recommendation: **NO-GO**

## Executive Summary

The engineering stabilization work was completed, merged, and deployed through GitHub Actions. TypeScript, production build, CI, and production smoke checks pass.

The launch still cannot move to GO because launch-critical live business flows are not fully certified:

- bKash top-up initiation still fails in production with provider/configuration 400 after app-side contact resolution was fixed.
- bKash webhook route is mounted, but production returns `503 {"error":"Webhook secret not configured"}`.
- Courier booking reaches the authenticated server endpoint, but live booking fails because no active courier integration is configured for the shop.
- Meta OAuth initiation works, but no real Page-owner login was available, so Messenger inbound, AI draft, manual reply, attachment send, and 24-hour policy behavior were not certified live.
- Telegram connect intent works, but no real Telegram group command was completed, so test/event alerts did not fire.
- A live order was created and confirmed through the product UI, but it was not a real Messenger-origin purchase and payment/courier completion did not pass.

## PRs Merged

- PR #56 `release/launch-blocker-stabilization`: launch blocker stabilization base.
- PR #57 `release/founder-acceptance-inbox-fix`: normalized production inbox conversation payload.
- PR #58 `release/ci-vitest-env-normalization`: removed invalid `VITE_ENV=test` CI noise.
- PR #59 `release/topup-payment-contact-fix`: resolved top-up payment contact from authenticated user/shop records.

## Code Blockers Fixed

### Frontend TypeScript

Status: **PASS**

Evidence:
- `cd EasyMod-frontend && npx tsc --noEmit`
- Result: exit code 0.

### Production Build

Status: **PASS**

Evidence:
- `cd EasyMod-frontend && npm run build`
- Result: Vite production build completed successfully.

### Tests

Status: **PASS**

Evidence:
- `cd EasyMod-frontend && npm run test:unit`
- Result: 47 files passed, 436 tests passed.
- `cd EasyMod-backend && npx jest src/modules/subscription/__tests__/topup.controller.test.js --runInBand`
- Result: 1 file passed, 3 tests passed.
- `cd EasyMod-backend && npm test -- --runInBand`
- Result: 83 suites passed, 1076 tests passed. Existing unrelated coverage-collection warnings remain, but command exited 0.

### Dependency Audits

Status: **ACCEPTABLE WITH DOCUMENTED MODERATE RESIDUAL RISK**

Evidence from stabilization:
- Frontend production audit: 0 vulnerabilities.
- Backend production audit: 9 moderate, 0 high, 0 critical.

Accepted residual risk:
- `firebase-admin@13.10.0` transitive advisories. npm suggested downgrade is not safe for launch without FCM compatibility testing.
- `sequelize@6.37.8` / transitive `uuid@8.3.2`. npm suggested downgrade is not safe because Sequelize is core ORM/migration infrastructure.

## CI/CD

Status: **PASS**

Final main workflow:
- Run: `28753496089`
- SHA: `a9b310791e7969d085c9bf357f1a83a7f0f4e5d7`
- Jobs: Detect changed services, Test & Build Gate, Build & Push Docker Images, Deploy to DO Droplet all passed.

Earlier merged workflow checks:
- PR #56: passed, merged, deployed.
- PR #57: passed, merged, deployed.
- PR #58: passed, merged, deployed.
- PR #59: passed, merged, deployed.

## Production Smoke

Commands:
- `curl.exe https://easymod.tech/api/version`
- `curl.exe -o NUL -w '%{http_code}' https://easymod.tech/`
- `curl.exe -o NUL -w '%{http_code}' https://easymod.tech/health/ready`
- `curl.exe -o NUL -w '%{http_code}' https://easymod.tech/signin`

Results:
- `/`: 200
- `/health/ready`: 200
- `/health`: 200
- `/api/version`: 200, SHA `a9b31079`
- `/signin`: 200
- `/privacy-policy`: 200

External check-host result:
- Request id: `43b429b4k7e8`
- Nodes: Germany, Hungary, India, Iran, Italy, Slovenia.
- Result: all returned OK 200.

## Webhook Reachability

Production probes:
- `GET /api/webhooks/meta`: 403
- `GET /api/webhooks/meta?...invalid token...`: 403
- `POST /api/webhooks/meta {}`: 403
- `POST /api/webhooks/telegram {}`: 401
- `POST /api/webhooks/bkash/payment-status {}`: 503, webhook secret not configured.
- `POST /api/webhooks/delivery/pathao {}`: 400, missing `consignment_id`.

Interpretation:
- Meta and Telegram routes are reachable and protected.
- Courier webhook route is mounted.
- bKash webhook route is mounted but production secret configuration is missing.

## Founder Acceptance Test

Performed against live production with browser interaction.

### Signup And Onboarding

Status: **PASS, EXCEPT META SETUP**

Evidence:
- Live signup created a new account.
- API responses included `201 POST /api/auth/signup`, `200 GET /api/subscription`, `200 GET /api/setup/status`.
- Trial was created: Growth Plan Trial, 14 days remaining.
- Business info saved through UI: `200 PUT /api/shop/business-info`.
- Product created through UI: `201 POST /api/product`.
- Dashboard setup progress persisted after refresh and fresh login: 75%, 3 of 4 complete.

Remaining:
- Facebook Page connection is still incomplete, so Business Setup cannot reach 100%.

### Inbox

Status: **PASS AFTER HOTFIX**

Initial live result:
- `/app/inbox` crashed with `Cannot read properties of undefined (reading 'filter')`.

Fix:
- PR #57 normalized production conversation list payloads.

Final evidence:
- `/app/inbox` renders "No conversations yet".
- `GET /api/conversation?limit=50`: 200.

### Meta And Messenger

Status: **PARTIAL**

Evidence:
- Chat Settings loaded.
- `POST /api/channels/meta/oauth/initiate`: 200.
- Facebook login popup opened for app id `2040799330176198`.
- Requested scopes: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`.

Not certified:
- Real Meta OAuth completion.
- Real inbound Messenger message.
- AI draft creation from live customer message.
- Manual reply send.
- Attachment send.
- 24-hour policy behavior against Meta Graph.

Reason:
- No real Page-owner Meta credentials/customer conversation were available in this session.

### Order And Purchase

Status: **PARTIAL**

Evidence:
- Live manual order created through Orders UI.
- Product: `Founder Test Cotton Panjabi`.
- Customer: `Founder Test Customer`.
- Total: BDT 1,250.
- `201 POST /api/order`.
- Order confirmed through UI.
- `200 POST /api/order/{id}/confirm`.

Not certified:
- Messenger-origin customer purchase.
- Payment completion.
- Courier completion.

### Payment And Billing

Status: **FAIL**

Evidence:
- Subscription page loads.
- Selecting `+100 conversations` enables `Pay with bKash`.
- Initial failure was `phone is required for BKash payment`; fixed by PR #59.
- After deploy, top-up initiation still fails:
  - `400 POST /api/subscription/topup/initiate`
  - Response message: `Request failed with status code 400`.
- bKash webhook probe:
  - `503 {"error":"Webhook secret not configured"}`.

Not certified:
- Invoice payment.
- Subscription renewal.
- Top-up payment.
- Failed-payment recovery.
- Real bKash callback completion.

### Courier Booking

Status: **FAIL FOR AUTOMATED COURIER; MANUAL COURIER REQUIRED IF LAUNCHING**

Evidence:
- Courier booking modal opens from the confirmed order.
- Recipient, phone, address, COD amount, and item description are prefilled.
- Authenticated server endpoint is reached.
- Booking fails:
  - `500 POST /api/order/{id}/courier`
  - `COURIER_BOOKING_FAILED`
  - `No active steadfast integration found for this shop`.
- In-app notification center received the courier failure event.

Not certified:
- Real courier booking.
- Status update.
- Provider callback.

### Telegram

Status: **PARTIAL**

Evidence:
- Notification page loaded.
- `GET /api/notifications/telegram`: 200.
- `POST /api/notifications/telegram/connect-intent`: 201.
- Connect command generated for `EasyModNotifyBot`.

Not certified:
- Real group connection.
- Test alert.
- Order/customer-waiting/payment/courier Telegram alert delivery.

Reason:
- The command was not sent from a real Telegram group in this session.

## Final Certification Answers

- Does TypeScript pass? **Yes.**
- Does production build pass? **Yes.**
- Does CI pass? **Yes.**
- Are dependency audits acceptable? **Yes, with documented moderate residual risk.**
- Does payment work? **No.**
- Does courier booking work? **No, not with automated courier; manual courier required unless provider credentials are configured.**
- Does Messenger work? **Not fully certified. OAuth starts, but live Messenger flow was not completed.**
- Does onboarding work? **Yes for signup/trial/persistence; setup remains incomplete without Meta connection.**
- Does Business Setup work? **Partially; 3 of 4 tasks completed and persisted, Facebook Page connection incomplete.**
- Does one customer complete a real purchase? **No. A manual order was created and confirmed, but payment/courier/Messenger-origin purchase did not complete.**
- Does Telegram alert fire? **No. Connect intent works, but no real group/test alert was completed.**
- Does Meta webhook work? **Protected route is reachable; real verification/inbound webhook not certified.**
- Does billing work? **No. Subscription loads, but bKash top-up and webhook configuration fail.**
- Does the production site open from multiple external networks? **Yes.**

## Remaining P0 Launch Blockers

1. Configure production bKash webhook secret and validate bKash credentials/callback allowlist.
2. Complete a real bKash top-up, invoice payment, renewal, callback settlement, and failed-payment retry.
3. Configure a live courier integration or explicitly launch with manual courier only.
4. Complete real Meta Page OAuth and live Messenger message/reply/attachment/24-hour policy testing.
5. Complete Telegram group connection and test alert/event alert delivery.
6. Complete one true Messenger-origin purchase from customer message through order confirmation, payment, and courier/manual fulfillment.

Final recommendation: **NO-GO for public launch.**
