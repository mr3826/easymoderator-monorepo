# RAW DISCOVERY NOTE — Docs/P0-audit/tooling/diff (general agent E, 2026-10-24)

Decision doc: `D:\easymod\EASYMODERATOR_DOMAIN_ENGINE_ARCHITECTURE_AND_IMPROVEMENT_DECISION.md` (409 ln, review 2026-10-25, baseline=2a8c1e2d, ARCHITECTURE_DECISION=MODULARIZE). Doc statuses: all four findings OPEN at baseline. F-01/F-02/F-03 = P0; F-04 (checkout interruption) = P1.

## P0 verdicts in THIS tree (f0f04e4e + docs commits)
1. P0-1 Retired Meta message tags — STILL_PRESENT.
   - policy/rules/templateRequired.rule.js:26-31 ALLOWED_TAGS incl HUMAN_AGENT etc; :36 DEFAULT POST_PURCHASE_UPDATE. Meta errors legacy tags since 2026-04-27 (doc).
   - policy/rules/twentyFourHourWindow.rule.js:23-26,46 outside window ALWAYS augments retired tag, never holds.
   - channel-providers/providers/MetaMessengerProvider.js:1065-67 puts MESSAGE_TAG+tag on wire.
   - Tests ASSERT retired default: policy/__tests__/rules.test.js:182-194,261-263; providers/__tests__/MetaMessengerProvider.test.js:968-972.
   - No 7-day ad-window/event-evidence logic in policy (searched click_to_messenger/seven/REFERRAL = 0).
2. P0-2 OCR-as-payment — STILL_PRESENT.
   - payment/self-mfs-handler.service.js:234 accepts status 'Successful'|'unknown'; :358-59 verified:true after LOCAL checks only.
   - order/order-session-standalone.service.js:892-99 tells customer "Payment confirmed ✅ (TrxID…)" (OCR, no gateway verify); :231-32+:1681 order payment_status stays 'pending' (conflict).
3. P0-3 Dual enabled-payment sources — STILL_PRESENT.
   - Checkout: order-session-standalone.service.js:1546-59 gates on PaymentConfig.is_enabled (fallback ['cod']).
   - AI: ai/shop-operating-context.service.js:76,82-94 hasSelfMfs(shop.settings.bd) only; shop/shop-bd-settings.js:88-91 no enabled-bit.
   - payment/payment.service.js:284-95 syncs self-mfs creds to settings.bd without is_enabled check; :328-46 deletePaymentConfig never clears settings.bd.
4. F-04 (P1) — STILL_PRESENT: conversation/order-flow.service.js:44-50 ACTIVE_SESSION_TERMINAL_INTENTS (STOP_OPT_OUT, HUMAN_HANDOFF_REQUEST, SENTIMENT_HANDOFF, ORDER_POST_PURCHASE_REQUEST, ORDER_STATUS_LOOKUP); :169-73 terminal -> cancelActiveSession() before release; :193-99 every other turn incl payment/delivery QUESTIONS -> processStep raw field answer. Negation guards :145-67,175-85; cancel-failure safe :135-43. No pause/resume/suspend found.

## Diff surface 2a8c1e2d...HEAD
985 files, +2.89M (docs/evidence ~all). Non-doc source ~123 paths; runtime source ~40: intent-router.service, message-worker, grounding/*, product-search, MetaMessengerProvider, meta-oauth.service, shop-operating-context (strict/hash helpers), ai-chatbot.controller, webhook durability integration test, auth/security tests, CI workflows, playwright lab config, frontend types/domains.
Orders/Payment/Delivery/Inbox/Knowledge/migrations = 0 changed -> P0 paths byte-identical to production; any plan assuming P0 fixed here is WRONG.

## Tooling (verified paths)
- Node 20.x required (root package.json:38); portable node at D:\easymod\_local-runtimes\node-v20.20.2.
- Workspaces: backend/frontend/growth only (mobile/extension separate).
- Unit: npm run test:backend (jest --coverage; BullMQ stubbed via jest.config.js:40-46); test:security; test:discovery enforces suite membership; test:quarantine debt register; frontend vitest (test:frontend); growth tsc.
- INTEGRATION (real PG+Redis): jest.integration.config.js single worker, DB name must contain test/e2e. One-command: root `npm run test:backend:integration:docker` -> scripts/run-backend-integration.js spins docker-compose.test.yml (postgres:16-alpine loopback :55432, redis:7 :56379, tmpfs, healthchecks, free ports, teardown). Meta-shaped E2E: `npm run test:backend:meta:e2e:docker` (run-backend-meta-e2e.js, ports 55433/56380, Redis DBs 20-22). V1.3 verifier defaults Docker; BLOCKED on preflight failure rather than touching listeners.
- Playwright FE: cd EasyMod-frontend && npm run test:e2e -> vite :4273 (PLAYWRIGHT_PORT override), mock-API specs; lab: node EasyMod-backend/scripts/product-experience/run-lab-playwright.js (3 engines, artifacts docs/ai/product-experience-v1-2/artifacts/playwright).
- Dev ports: backend 3000, PG 5432, Redis 6379, Qdrant 6333, vite 5173, growth 5175, PW 4273. Flow cp .env -> npm run docker:up -> npm run migrate -> seed:admin -> dev (+start:worker / START_EMBEDDED_WORKERS).
- Seeds: npm run seed (founder dev account + "EasyMod Dev Shop", idempotent, src/database/seed.js); seed:conversations ([TEST] synthetic conversations/customers, sqlite fallback); node scripts/seed-mobile-dev.js (synthetic demo shop: draft orders, HITL convs, courier failures, RTO customer, low stock); seed:meta-bootstrap/seed:meta-review-merchant (guarded). No richer synthetic multi-shop seed -> founder lab extends these.

## Docs
- docs/ai/product-experience-v1-3/: README (verification guide); PRODUCT_ENGINE_V1_3_INTEGRATION_CUSTOMER_TRUTH_PROOF.md = AUTHORITATIVE: **Automated QA=FAIL, Integration ready=NO**, deterministic source truth PASS (18/18 slots, 15/15 turns), photo gate fails (0-2/3), costs estimated; INDEPENDENT_VERIFICATION.md(+json) PASS for candidate binding/paid comparison/cost recon, keeps QA FAIL; MULTI_AGENT_DECISION_RECORD.md; checkpoints/ PARTIALLY_PAUSED 2026-10-24, code HEAD 2aedd348, no release authority.
- docs/pilot-intelligence/ 00-08 (2026-09-27, Implemented-pilot); ADRs 0005,0006,0008,0009,0010.
- NO MomentumUX/design-system doc exists (term appears only in pilot-plus 01 doc); no brand docs; closest external: D:\easymod\EasyModerator_V5_Founder_UX_Audit_2026-10-15.md.
- .easymod/memory/meta-policy-risks.md (2026-05-16) HIGH: "Opt-Out Check Missing in Send Pipeline — order/payment/delivery confirms bypass opt-out guard"; MEDIUM: unknown-gateway webhook passes without signature validation. NO entry re retired tags (predates retirement). failures.md ALL EMPTY. .easymod/skills/meta-policy-skill.md:49-58 + standards/meta-safe-rules.md:19-23 STALE (still recommend retired tags) — superseded by decision doc §A.5.

## ANOMALIES (from agent)
1. Branch tip now c6721377 (my provenance doc) atop f0f04e4e — expected.
2. 985 vs 984 changed paths = my doc commit.
3. V1_3_PAUSE_CHECKPOINT.patch is worktree-local in V1.3 tree, not in this copy — fine, docs-only anyway.
4. Doc cite path drift: order-flow is modules/conversation/; shop-operating-context under modules/ai/.
5. All 3 P0 paths byte-identical to production (git log 2a8c1e2d..HEAD empty for policy/payment/order).
6. .easymod guidance contradicts Meta reality (stale tag advice); failures.md empty despite docs/incidents 2026-09-22 outage.
7. Diff size overstates code risk (evidence bulk).
8. V1.3 proof QA FAIL; browser PIDs dead at checkpoint -> no runtime integration claim verifiable in tree.
9. npm ci does NOT install mobile/extension workspaces (excluded).
