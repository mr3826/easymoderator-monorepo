# Launch Blocker Stabilization Report

Date: 2026-07-05
Branch: `release/launch-blocker-stabilization`
Production site checked: `https://easymod.tech`
Current production SHA: `bfb680811427e87ce7a2fd3494a0b62d6db05211`

## Final Recommendation

NO-GO for public launch.

Local stabilization work is materially improved and the main local engineering gates now pass, but the launch cannot move to GO because the stabilization branch is not deployed, no CI run exists for this branch yet, and several launch-critical business flows were not certified end to end with real production credentials.

## Blockers Fixed In This Branch

### Frontend TypeScript

Status: Fixed locally.

Changes:
- Added explicit frontend type packages for Node and React DOM.
- Updated `tsconfig.json` to include `vite/client`, `node`, and `react-dom` types.
- Fixed strict TypeScript errors across API response types, route wrappers, RBAC guards, inbox, orders, customers, delivery settings, subscription usage, and related tests.
- Preserved runtime behavior; no `any`-based blanket suppression was added for the production TypeScript fixes.

Evidence:
- `cd EasyMod-frontend && npx tsc --noEmit --pretty false --noErrorTruncation`
- Result: pass, exit code 0.

### Dependency Audits

Status: Acceptable with documented backend moderate residual risk.

Changes:
- Ran production-only audits for backend and frontend.
- Applied compatible `npm audit fix --omit=dev`.
- Upgraded backend `pm2` from `^5.3.0` to `^7.0.3`.
- Frontend production audit is clean.
- Backend high and critical production advisories were eliminated.

Evidence:
- `cd EasyMod-frontend && npm audit --omit=dev --json`
- Result: 0 total vulnerabilities.
- `cd EasyMod-backend && npm audit --omit=dev --json`
- Result: 9 moderate, 0 high, 0 critical.

Accepted backend residual advisories:
- `firebase-admin@13.10.0` transitive chain: `@google-cloud/firestore`, `@google-cloud/storage`, `google-gax`, `gaxios`, `retry-request`, `teeny-request`.
  - Severity: moderate.
  - npm suggested fix: downgrade `firebase-admin` to `10.3.0`.
  - Risk decision: accepted for launch candidate because the suggested fix is a major downgrade of the FCM integration and is not safe without compatibility testing. Current app usage is limited to mobile push send path in `push-notification.service.js`.
  - Mitigation: do not expose Firebase Admin inputs directly to users; keep FCM service account scoped; revisit when upstream publishes a non-downgrade patch.
- `sequelize@6.37.8` / transitive `uuid@8.3.2`.
  - Severity: moderate.
  - npm suggested fix: downgrade `sequelize` to `3.30.0`.
  - Risk decision: accepted for launch candidate because Sequelize is core ORM/migration infrastructure and the suggested downgrade is unsafe and incompatible with the current codebase.
  - Mitigation: continue parameterized ORM/query usage; do not introduce raw user-controlled JSON cast queries; revisit when a safe Sequelize patch is available.

### Payment Webhook Mounting

Status: Fixed in source, not live in production.

Changes:
- Mounted payment webhook routes in `EasyMod-backend/src/app.js` at `/api/webhooks`.
- Local route contract test verifies `POST /api/webhooks/bkash/payment-status` reaches the bKash payment handler.

Evidence:
- `cd EasyMod-backend && npm test -- --runInBand src/modules/webhooks/webhook.routes.contract.test.js`
- Included in full backend test run: pass.
- Production probe on current SHA: `POST https://easymod.tech/api/webhooks/bkash/payment-status` returned 404.
- Interpretation: branch fix is not deployed to production.

### Courier Booking Tenant Boundary

Status: Fixed in source, not live in production.

Changes:
- Removed client-controlled `x-shop-id` preference from authenticated courier booking.
- `bookCourier` now uses `req.user.shopId`.
- Added a focused test proving a spoofed `x-shop-id` header is ignored.
- Mounted canonical courier webhooks at `/api/webhooks/delivery`.
- Preserved raw webhook body for courier HMAC signature validation.

Evidence:
- `cd EasyMod-backend && npm test -- --runInBand src/modules/order/__tests__/order.controller.book-courier.test.js src/modules/webhooks/webhook.routes.contract.test.js`
- Result: 2 suites passed, 3 tests passed.
- Full backend suite also passed.
- Production probe on current SHA: `POST https://easymod.tech/api/webhooks/delivery/pathao` returned 404.
- Interpretation: branch fix is not deployed to production.

## Validation Commands Run

### Frontend

- `cd EasyMod-frontend && npx tsc --noEmit --pretty false --noErrorTruncation`
  - Result: pass.
- `cd EasyMod-frontend && npm run build`
  - Result: pass.
- `cd EasyMod-frontend && npm run test:unit`
  - Result: 47 test files passed, 435 tests passed.
- `cd EasyMod-frontend && npm audit --omit=dev --json`
  - Result: 0 vulnerabilities.

### Backend

- `cd EasyMod-backend && npm test -- --runInBand src/modules/order/__tests__/order.controller.book-courier.test.js src/modules/webhooks/webhook.routes.contract.test.js`
  - Result: pass.
- `cd EasyMod-backend && npm test -- --runInBand`
  - Result: 82 test suites passed, 1073 tests passed.
  - Note: Jest still logs pre-existing coverage collection warnings for hoisted mocks in some test files, but the command exited 0.
- `cd EasyMod-backend && npm audit --omit=dev --json`
  - Result: 9 moderate, 0 high, 0 critical.
- `cd EasyMod-backend && npm ls firebase-admin @google-cloud/firestore @google-cloud/storage google-gax gaxios retry-request teeny-request sequelize uuid --omit=dev`
  - Result: residual moderate paths documented above.

## Production Checks

### Basic Reachability

Commands:
- `curl.exe -sS -o NUL -w '%{http_code}' https://easymod.tech/`
- `curl.exe -sS -o NUL -w '%{http_code}' https://easymod.tech/health/ready`
- `curl.exe -sS -o NUL -w '%{http_code}' https://easymod.tech/health`
- `curl.exe -sS -o NUL -w '%{http_code}' https://easymod.tech/api/version`
- `curl.exe -sS -o NUL -w '%{http_code}' https://easymod.tech/signin`
- `curl.exe -sS -o NUL -w '%{http_code}' https://easymod.tech/privacy-policy`

Results:
- `/`: 200
- `/health/ready`: 200
- `/health`: 200
- `/api/version`: 200
- `/signin`: 200
- `/privacy-policy`: 200

### External Network Reachability

Tool: check-host.net HTTP check
Report: `https://check-host.net/check-report/43ae2bc5kf07`

Nodes:
- Finland, Helsinki: OK 200
- Iran, Khonj: OK 200
- Moldova, Chisinau: OK 200
- Singapore: OK 200
- Ukraine, Kyiv: OK 200
- Vietnam, Ho Chi Minh City: OK 200

Status: production site opens from multiple external networks.

### Production Webhook Probes

Commands and results:
- `GET https://easymod.tech/api/webhooks/meta`: 403
- `GET https://easymod.tech/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=launch-cert`: 403
- `POST https://easymod.tech/api/webhooks/meta {}`: 403
- `POST https://easymod.tech/api/webhooks/telegram {}`: 401
- `POST https://easymod.tech/api/webhooks/bkash/payment-status {}`: 404
- `POST https://easymod.tech/api/webhooks/delivery/pathao {}`: 404

Interpretation:
- Meta and Telegram protected webhook behavior is reachable.
- bKash and canonical courier webhook paths are fixed in this branch but not deployed to production.

## Flow Certification

### Payment And Billing

Status: Partially certified only.

Evidence:
- Source route mount fixed for payment webhooks.
- Local route contract verifies bKash callback routing.
- Backend full test suite passed, including subscription, invoice payment, usage tracking, failed payment reconciler, and notification event coverage.

Not certified live:
- Real bKash callback.
- Real invoice payment.
- Real subscription renewal.
- Real top-up.
- Real failed-payment recovery.

Reason:
- No live merchant/payment credentials were available in this session.
- Current production still returns 404 for the bKash callback path.

### Courier Booking

Status: Partially certified only.

Evidence:
- Source fix removes authenticated courier booking dependence on client `x-shop-id`.
- Focused test proves spoofed `x-shop-id` is ignored.
- Local route contract verifies `/api/webhooks/delivery/pathao` routing.
- Backend tests cover order tracking, delivery schema, courier booking, order confirmation, and webhook handling.

Not certified live:
- Real courier booking.
- Real courier status update.
- Real courier webhook callback.

Reason:
- No live courier credentials were available in this session.
- Current production still returns 404 for canonical courier webhook path.

### Messenger And Meta

Status: Partially certified only.

Evidence:
- Backend full test suite passed with coverage for Meta OAuth service/controller, provider registry, Meta Messenger provider, Meta webhook routes, inbound webhook handling, token refresh, human handoff, message worker, AI routing, and policy behavior.
- Frontend inbox tests passed for 24-hour warning/expiry behavior, manual send blocking after expiry, AI draft visibility, quick replies, attachment send metadata, and retry behavior.
- Production invalid-token Meta webhook probes returned protected 403 responses.

Not certified live:
- Real Meta OAuth login.
- Real inbound Messenger message.
- Real AI draft creation from a live message.
- Real manual reply send.
- Real attachment send through Meta.
- Real 24-hour policy behavior against Meta Graph API.

Reason:
- No live Meta app/page/customer credentials were available in this session.

### Onboarding And Business Setup

Status: Partially certified only.

Evidence:
- Backend full suite passed with auth, shop, setup-status, trial expiry, subscription-access, and setup API coverage.
- Frontend tests passed, including signup-facing auth tests and setup API domain tests.

Not certified live:
- Real signup.
- Real trial creation.
- Real Business Setup progress.
- Real task completion.
- Real setup completion screen.
- Real dashboard transition.
- Persistence after refresh/logout/login.

Reason:
- No disposable live user/account credentials were available in this session.

### Telegram

Status: Partially certified only.

Evidence:
- Backend full suite passed with Telegram provider, Telegram notification routes/service, alert formatter, merchant notification service/jobs, notification events, and push-subscription coverage.
- Production unauthenticated Telegram webhook probe returned 401, which confirms the route is reachable and secret-protected.

Not certified live:
- Real group connect.
- Real test alert.
- Real order/customer-waiting/payment/courier alert event delivery to Telegram.

Reason:
- No live Telegram group/admin flow was available in this session.

### One Real Purchase

Status: Not certified.

Required path:
- Customer sends Messenger message.
- Merchant or AI creates order.
- Order is confirmed.
- Payment/billing path is verified.
- Courier booking is verified or manual-courier launch decision is documented.
- Telegram alert fires where applicable.

Result:
- Not performed in production.

Reason:
- No live Meta customer/page, merchant account, payment credentials, or courier credentials were available in this session.
- The branch containing payment/courier route fixes is not deployed.

## CI Status

Status: Not certified for this branch.

Evidence:
- Latest `main` CI/CD run passed:
  - Run: `28732887350`
  - Branch: `main`
  - SHA: `bfb680811427e87ce7a2fd3494a0b62d6db05211`
  - URL: `https://github.com/mr3826/easymod-backend/actions/runs/28732887350`
- This stabilization branch has not been pushed/opened as a PR in this session, so there is no GitHub Actions run for the branch fixes.

## Remaining Launch Risks

P0:
- Stabilization branch is not deployed; production still returns 404 for bKash callback and canonical courier webhook paths.
- CI has not run against `release/launch-blocker-stabilization`.
- No real end-to-end purchase was completed.
- Payment, billing, courier, Messenger, onboarding, Business Setup, and Telegram were not live-certified with real production credentials.

P1:
- Backend production audit still has 9 accepted moderate advisories because npm's proposed fixes are unsafe major downgrades for `firebase-admin` and `sequelize`.
- Backend Jest exits 0, but coverage collection still emits hoisted-mock warnings that should be cleaned up after launch stabilization.
- Frontend Vitest exits 0, but the suite emits pre-existing act/socket/localstorage warnings that should be cleaned up after launch stabilization.

## Launch Certification Summary

- Does TypeScript pass? Yes, locally.
- Does production build pass? Yes, locally.
- Does CI pass? No branch CI run exists yet; latest `main` CI passes only for production SHA `bfb68081`.
- Are dependency audits acceptable? Yes with documented backend moderate residual risk; no high or critical production advisories remain.
- Does payment work? Not fully certified live.
- Does courier booking work? Source/test fixed; not certified live.
- Does Messenger work? Source/test covered; not certified live.
- Does onboarding work? Source/test covered; not certified live.
- Does Business Setup work? Source/test covered; not certified live.
- Does one customer complete a real purchase? No, not certified.
- Does Telegram alert fire? Source/test covered; not certified live.
- Does Meta webhook work? Protected production route reachable; real webhook verification/inbound message not certified live.
- Does billing work? Source/test covered; not certified live.
- Does the production site open from multiple external networks? Yes.
