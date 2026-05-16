---
name: em-qa-skill
description: "EasyModerator QA skill. Use when writing tests for BullMQ jobs, Meta webhooks, BKash payment flows, Sequelize models, AI intent routing, delivery adapters, RAG pipelines, or any backend/frontend module. Enforces TDD."
---

# QA Automation Skill — EasyModerator Test Engineer

## ROLE
Senior QA Automation Engineer for EasyModerator — TDD-first, covering BullMQ workers, Meta webhooks, BKash payments, RAG pipelines, and multi-tenant Sequelize isolation.

## TEST PYRAMID

```
          E2E (Playwright)
         /   critical seller flows   \
        /    comment→order, BKash      \
       /--------------------------------\
      Integration Tests (Jest + real DB)
     /  routes → services → DB → Redis   \
    /----------------------------------------\
   Unit Tests (Jest + mocks)
   service methods, guards, adapters, utilities
```

**Coverage thresholds:**
- Service layer: 80% minimum
- Payment module: 100%
- Webhook middleware: 100%
- Meta integration: 100%
- AI guardrail chain: 100%

---

## TEST FILE LOCATIONS

```
EasyMod-backend/src/modules/{module}/__tests__/
├── {module}.service.test.js
├── {module}.controller.test.js
└── {module}.validator.test.js

EasyMod-backend/src/jobs/__tests__/
├── message-worker.test.js
├── invoice-generator.test.js
└── auto-index.test.js

EasyMod-frontend/src/features/{feature}/__tests__/
├── {Component}.test.tsx
└── use{Hook}.test.ts
```

---

## BULLMQ JOB TESTING

### Strategy: extract and test the processor function directly

```js
// src/jobs/__tests__/message-worker.test.js

// Extract the processor function (don't test the Worker class directly)
const { processMessage } = require('../message-worker')
const { cacheRedis } = require('../../shared/redis')
const metaSendService = require('../../modules/ai/meta-send.service')
const intentRouter = require('../../modules/ai/intent-router.service')

jest.mock('../../modules/ai/meta-send.service')
jest.mock('../../modules/ai/intent-router.service')
jest.mock('../../shared/redis')

describe('message-worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: no idempotency lock exists
    cacheRedis.set.mockResolvedValue('OK')
  })

  test('guard 1: drops duplicate message (idempotency)', async () => {
    cacheRedis.set.mockResolvedValue(null)  // NX set returns null if key exists
    await processMessage({ messageId: 'msg1', shopId: 'shop1' })
    expect(metaSendService.sendMessage).not.toHaveBeenCalled()
  })

  test('guard 2: skips AI when HITL is active', async () => {
    await processMessage({ messageId: 'msg2', shopId: 'shop1', hitlActive: true })
    expect(intentRouter.route).not.toHaveBeenCalled()
  })

  test('happy path: routes to AI and sends reply', async () => {
    intentRouter.route.mockResolvedValue({ reply: 'Hello! How can I help?' })
    metaSendService.sendMessage.mockResolvedValue({ messageId: 'sent1' })
    await processMessage({ messageId: 'msg3', shopId: 'shop1', text: 'Hi' })
    expect(metaSendService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: { text: 'Hello! How can I help?' } })
    )
  })
})
```

---

## META WEBHOOK TESTING

### HMAC signature helper:
```js
// test/helpers/webhook.helper.js
const crypto = require('crypto')

const signMetaWebhook = (payload, secret = process.env.META_APP_SECRET) => {
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex')
}

module.exports = { signMetaWebhook }
```

### Webhook route test:
```js
const request = require('supertest')
const app = require('../../app')
const { signMetaWebhook } = require('../helpers/webhook.helper')

describe('POST /api/webhooks/meta', () => {
  const payload = {
    object: 'page',
    entry: [{ id: 'PAGE_ID', messaging: [{ sender: { id: 'USER_PSID' }, message: { text: 'Hi' } }] }]
  }

  test('returns 200 and enqueues job with valid signature', async () => {
    const sig = signMetaWebhook(payload)
    const res = await request(app)
      .post('/api/webhooks/meta')
      .set('X-Hub-Signature-256', sig)
      .send(payload)
    expect(res.status).toBe(200)
    // verify job was enqueued
  })

  test('returns 401 with invalid signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=invalidsig')
      .send(payload)
    expect(res.status).toBe(401)
  })

  test('is idempotent — second identical event returns 200 without re-processing', async () => {
    const sig = signMetaWebhook(payload)
    await request(app).post('/api/webhooks/meta').set('X-Hub-Signature-256', sig).send(payload)
    const res2 = await request(app).post('/api/webhooks/meta').set('X-Hub-Signature-256', sig).send(payload)
    expect(res2.status).toBe(200)
    // verify job was NOT enqueued twice
  })
})
```

---

## BKASH PAYMENT TESTING

### Mock BkashMerchantService at service boundary:
```js
jest.mock('../bkash-merchant.service', () => ({
  getOAuthToken: jest.fn().mockResolvedValue('mock-token'),
  createPayment: jest.fn().mockResolvedValue({ bkashURL: 'https://sandbox.bkash.com/...' }),
  executePayment: jest.fn().mockResolvedValue({ transactionStatus: 'Completed' }),
}))
```

### HMAC webhook verification test:
```js
const crypto = require('crypto')

const validSig = crypto
  .createHmac('sha256', process.env.BKASH_WEBHOOK_SECRET)
  .update(JSON.stringify(webhookPayload))
  .digest('hex')

test('accepts valid BKash signature', async () => {
  const res = await request(app)
    .post('/api/payment-webhook/bkash')
    .set('X-BKash-Signature', validSig)
    .send(webhookPayload)
  expect(res.status).toBe(200)
})

test('rejects missing signature with 401', async () => {
  const res = await request(app)
    .post('/api/payment-webhook/bkash')
    .send(webhookPayload)
  expect(res.status).toBe(401)
})
```

### Payment state machine test:
```js
test('order moves PENDING → PAID on successful webhook', async () => {
  const order = await Order.create({ status: 'PENDING', shop_id: testShop.id })
  await paymentWebhookService.handleBkashWebhook({
    trxId: 'TRX123', orderId: order.id, status: 'Completed'
  })
  await order.reload()
  expect(order.payment_status).toBe('PAID')
})
```

---

## RAG / AI PIPELINE TESTING

### Test intent router 3-tier routing in isolation:
```js
jest.mock('../embedding.service')
jest.mock('../rag.service')
jest.mock('../llm.service')
jest.mock('../../shared/redis')

test('tier 1: returns cached intent without calling FAQ or LLM', async () => {
  cacheRedis.get.mockResolvedValue('{"reply":"Cached response"}')
  const result = await intentRouter.route({ text: 'price?', shopId: 'shop1' })
  expect(result.reply).toBe('Cached response')
  expect(ragService.retrieve).not.toHaveBeenCalled()
  expect(llmService.complete).not.toHaveBeenCalled()
})

test('tier 2: FAQ match above threshold skips LLM', async () => {
  cacheRedis.get.mockResolvedValue(null)
  ragService.retrieve.mockResolvedValue([{ content: 'FAQ answer', score: 0.90 }])
  const result = await intentRouter.route({ text: 'what is price?', shopId: 'shop1' })
  expect(llmService.complete).not.toHaveBeenCalled()
  expect(result.reply).toBe('FAQ answer')
})

test('tier 3: LLM called when cache miss and FAQ below threshold', async () => {
  cacheRedis.get.mockResolvedValue(null)
  ragService.retrieve.mockResolvedValue([{ content: 'weak match', score: 0.60 }])
  llmService.complete.mockResolvedValue('LLM generated response')
  const result = await intentRouter.route({ text: 'complex question', shopId: 'shop1' })
  expect(llmService.complete).toHaveBeenCalled()
  expect(result.reply).toBe('LLM generated response')
})
```

### Test guardrail chain (all 5 guards):
```js
test('blocks message with HIGH severity RTO fraud', async () => {
  const result = await guardrailService.validate({
    message: 'fake phone fraud pattern',
    shopId: 'shop1'
  })
  expect(result.requiresEscalation).toBe(true)
  expect(result.maxSeverity).toBe('HIGH')
})
```

---

## SEQUELIZE INTEGRATION TESTING

### Tenant isolation test pattern (CRITICAL):
```js
test('orders query never returns cross-tenant data', async () => {
  const shop1 = await Shop.create({ name: 'Shop 1' })
  const shop2 = await Shop.create({ name: 'Shop 2' })
  await Order.create({ shop_id: shop1.id, status: 'PENDING' })
  await Order.create({ shop_id: shop2.id, status: 'PENDING' })

  const shop1Orders = await orderService.getOrders(shop1)
  expect(shop1Orders.every(o => o.shop_id === shop1.id)).toBe(true)
  expect(shop1Orders.some(o => o.shop_id === shop2.id)).toBe(false)
})
```

### Test teardown (always rollback):
```js
afterEach(async () => {
  await sequelize.truncate({ cascade: true })
})
afterAll(async () => {
  await sequelize.close()
})
```

---

## FRONTEND TESTING

### Component test with TanStack Query:
```tsx
import { renderWithProviders } from '../../test/renderWithProviders'
import { server } from '../../test/mswServer'
import { rest } from 'msw'

test('displays order list', async () => {
  server.use(
    rest.get('/api/orders', (req, res, ctx) =>
      res(ctx.json({ data: [{ id: '1', status: 'PENDING', total: 750 }] }))
    )
  )
  const { getByText } = renderWithProviders(<OrdersPage />)
  await waitFor(() => expect(getByText('PENDING')).toBeInTheDocument())
})
```

---

## WHAT TO MOCK

| Layer | Unit tests | Integration tests |
|-------|-----------|------------------|
| HTTP (axios/fetch) | Always mock | Always mock |
| Redis | ioredis-mock | Real Redis (test instance) |
| BullMQ | Mock Queue.add() | Real BullMQ + test Redis |
| Sequelize | sequelize-mock | Real test DB |
| Meta Graph API | Always mock (never hit real) | Always mock |
| Gemini / OpenAI | Always mock (costs money) | Always mock |
| Courier APIs | Always mock | Always mock |

## ALWAYS

- Write failing tests BEFORE implementation (TDD)
- Test all 5 message-worker guards independently
- Test idempotency: same event twice → only processed once
- Test tenant isolation: shop A never sees shop B's data
- Use HMAC helper for webhook signature tests

## NEVER

- Use real Meta, BKash, Gemini, or OpenAI credentials in tests
- Skip tenant isolation tests
- Mock the module under test
- Mark a feature done without passing coverage thresholds
