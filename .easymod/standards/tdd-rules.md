# EasyModerator TDD Rules

## Non-Negotiable Rule
Never write production code first. Test plan comes BEFORE any service method is written.

---

## Execution Order (Enforced)

1. Analyze requirement → identify affected modules
2. Write failing tests (unit + integration + API contract)
3. Implement minimum passing solution
4. Refactor
5. Validate integration with dependent modules
6. Validate regression across related `__tests__/` directories
7. Update `.easymod/memory/execution-history.md`

---

## Test File Location Convention

```
Backend:
  src/modules/{module}/__tests__/{module}.service.test.js
  src/modules/{module}/__tests__/{module}.controller.test.js
  src/modules/{module}/__tests__/{module}.validator.test.js
  src/jobs/__tests__/{job-name}.test.js

Frontend:
  src/features/{feature}/__tests__/{Component}.test.tsx
  src/features/{feature}/__tests__/use{Hook}.test.ts
  src/__tests__/ (E2E / integration)
```

---

## Required Test Types Per Feature

### Standard Feature (CRUD module)
- **Unit:** service methods (happy path, edge cases, error propagation via AppError)
- **Integration:** route handler → service → DB (using real test DB with rollback teardown)
- **API Contract:** request/response shape matches expected envelope format

### BullMQ Job Feature
- **Unit:** extract processor function, test directly with mocked deps (ioredis-mock, jest.mock services)
- **Integration:** enqueue → consume cycle with real Redis (test instance)
- **Guard chain:** test all 5 message-worker guards independently — idempotency, HITL, AI pause, automation mode, rate limit
- **Idempotency:** assert same `messageId + shopId` twice → processed only once
- **Fair-queueing:** assert job has `group.id = shopId` when dispatched

### Meta Webhook Feature
- **Signature helper:** `signMetaWebhook(payload)` in `test/helpers/webhook.helper.js`
- Valid signature → 200, invalid signature → 401, missing signature → 401
- Same `messageId` twice (webhook replay) → idempotent (second enqueue skipped)
- Test all subscribed Meta webhook event types: `messages`, `feed`, and Instagram `comments`

### Payment / BKash Feature
- Mock `BkashMerchantService` at service boundary: `jest.mock('../bkash-merchant.service')`
- Test token cache hit path: `cacheRedis.get` returns valid token → no API call
- Test token cache miss path: `cacheRedis.get` returns null → OAuth call + cache set
- HMAC webhook: valid sig → 200, invalid sig → 401, missing sig → 401
- Payment state machine: `PENDING → PAID`, `PENDING → FAILED`, `PENDING → CANCELLED`
- Idempotency: same `trxId` twice → second webhook is no-op (TrxIdLog check)

### RAG / AI Feature
- Mock vector DB at service boundary (`ragService.retrieve`, `embeddingService.generateEmbedding`)
- Test 3-tier routing independently: (1) cache hit, (2) FAQ above threshold, (3) LLM fallback
- Test guardrail chain: mock each guard, assert `requiresEscalation` on HIGH severity
- Test language detection: Bengali input → `'bn'`, Banglish input → `'banglish'`, English → `'en'`
- Test circuit breaker: 3 consecutive LLM failures → circuit opens, subsequent calls rejected
- Test fallback chain: Gemini Lite fails → Gemini Pro called; both fail → GPT-4.1-mini called

### Delivery Provider Feature
- Unit test each provider adapter independently: Pathao, Steadfast, RedX
- Test `validateCredentials()`: success path and failure path per provider
- Pathao: test OAuth token issue, token cache, token refresh
- Steadfast: test `Api-Key + Secret-Key` header pattern
- RedX: test `Authorization: Bearer {api_key}` header pattern
- Test `createOrder()`: success, network failure (retry), invalid credentials (don't retry)

---

## Coverage Thresholds

| Module Type | Line + Branch Coverage |
|-------------|----------------------|
| Service layer | 80% minimum |
| Payment module (`src/modules/payment/`) | 100% |
| Webhook middleware (`webhook.middleware.js`) | 100% |
| Meta integration (`meta-send.service.js`) | 100% |
| AI guardrail chain (`guardrail.service.js`) | 100% |
| All 5 message-worker guards | 100% |

---

## What to Mock

| External Dependency | Unit Tests | Integration Tests |
|--------------------|-----------|------------------|
| HTTP calls (axios, fetch) | Always mock | Always mock |
| Redis (ioredis) | ioredis-mock | Real Redis (test instance) |
| BullMQ | Mock Queue.add() | Real BullMQ + test Redis |
| Sequelize / PostgreSQL | sequelize-mock | Real test DB (rollback in teardown) |
| Meta Graph API | Always mock — NEVER hit real | Always mock |
| Gemini / OpenAI | Always mock — costs money | Always mock |
| BKash API | Always mock — use sandbox data | Always mock |
| Courier APIs (Pathao, Steadfast, RedX) | Always mock | Always mock |

---

## TDD Anti-Patterns — Never Do These

- Writing production service code, then adding tests to match it
- Mocking the module under test (test the behavior, not the implementation)
- Testing return values from mocks you yourself set up (circular test)
- Skipping the 5-guard message-worker tests because "they seem obvious"
- Using real BKash / Meta credentials in any test
- Marking a feature done without reaching coverage thresholds
- Writing tests after a bug is found without first writing a failing reproduction test
