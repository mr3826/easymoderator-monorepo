# Pilot Intelligence — Phase 2 Completion & Real-Stack Verification Plan

Date: 2026-10-04
Branch: `feat/pilot-customer-rto-completion` (from `origin/main` @ `59bcb4dc`)

## 1. Context & Scope

PR #196 established the baseline for Customer 360 Lite, Sales Opportunities, and RTO Shield v2 on `main`.
This completion phase hardens and completes the remaining technical debt and verification requirements:

1. **Order Tenant Integrity Fix (Tech Debt #7)**: Validate in `_createOrderCore` that any provided `customer_id` belongs to the requesting shop, preventing cross-shop customer assignment.
2. **Legacy Customers Page Cleanup (Tech Debt #3)**: Remove broken "Blacklist Customer" toggle in `Customers.tsx` which targeted non-existent `/api/customer/:id/blacklist` endpoints.
3. **Real-Stack Playwright E2E**: Provide a dedicated live test harness (`scripts/run-pilot-e2e.js` and `tests/e2e/customer-intelligence-live.spec.ts`) that executes all 10 critical user journeys against real PostgreSQL and Redis containers.
4. **Local Docker Validation**: Build and verify local Docker images for backend and frontend.
5. **Quality Gates & Production Deployment**: Pass all local gates, open PR, confirm all GitHub Actions green, merge to main, and run the automated deployment to production.

## 2. Architecture & Components

- `EasyMod-backend/src/modules/order/order.service.js`: Added tenant validation on `orderData.customer_id`.
- `EasyMod-backend/src/modules/order/__tests__/order-customer-integrity.test.js`: Regression test for tenant boundary.
- `EasyMod-frontend/src/app/components/Customers.tsx`: Removed broken blacklist button & handlers.
- `EasyMod-backend/src/scripts/seed-pilot-e2e.js`: Deterministic fixture seeder for live browser journeys.
- `scripts/run-pilot-e2e.js`: Automated runner orchestrating disposable Docker PG/Redis, migration, seed, backend boot, and Playwright execution.
- `EasyMod-frontend/tests/e2e/customer-intelligence-live.spec.ts`: 10 real-stack Playwright scenarios.
- `docs/pilot-intelligence/09-completion-evidence.md`: Verification runbook and results.

## 3. Rollback & Safety

All pilot features remain controlled by per-shop feature flags (`customer_intelligence: false`, `order_confidence_mode: 'off'`). Non-pilot shops experience zero behavioral disruption.
