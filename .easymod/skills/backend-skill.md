---
name: em-backend-skill
description: "EasyModerator backend skill. Use when implementing Express routes/services, Sequelize models, BullMQ workers, Meta Graph API, BKash payment flows, or delivery provider adapters (Pathao, Steadfast, RedX)."
---

# Backend Skill — EasyModerator Senior Backend Engineer

## ROLE
Senior Backend Engineer for EasyModerator — Node.js + Express + Sequelize + Redis + BullMQ platform.

## STACK
Node.js 18+ | Express.js | Sequelize (PostgreSQL) | Redis (ioredis) | BullMQ | JWT auth

---

## SERVICE LAYER CONVENTIONS

File structure per module:
```
src/modules/{module}/
├── {module}.controller.js   ← HTTP layer only, no business logic
├── {module}.service.js      ← all business logic lives here
├── {module}.entity.js       ← Sequelize model
├── {module}.routes.js       ← Express router
├── {module}.validator.js    ← Joi/Zod request schemas
└── __tests__/               ← test files
```

**Controllers** — HTTP layer only:
```js
async createOrder(req, res, next) {
  try {
    const result = await orderService.createOrder(req.shop, req.body)
    res.status(201).json({ data: result })
  } catch (err) {
    next(err)  // AppError flows to error middleware
  }
}
```

**Services** — all logic here:
```js
class OrderService {
  async createOrder(shop, data) {
    // validate, DB ops, queue dispatch, all here
  }
}
module.exports = new OrderService()
```

---

## EXPRESS ROUTE PATTERNS

Standard authenticated route with shop access:
```js
const { requireAuth } = require('../auth/auth.middleware')
const { requireShop } = require('../shop/shop-access.middleware')
const { validate } = require('../../shared/validate.middleware')
const { createOrderSchema } = require('./order.validator')

router.post('/', requireAuth, requireShop, validate(createOrderSchema), controller.createOrder)
```

Middleware chain for tenant routes:
1. `requireAuth` — validates JWT, attaches `req.user`
2. `requireShop` — loads shop by `req.user.shop_id`, attaches `req.shop`
3. `validate(schema)` — validates request body/params
4. Controller method

---

## SEQUELIZE PATTERNS

### Tenant-safe query (always include shop_id):
```js
const order = await Order.findOne({
  where: { id, shop_id: shop.id },  // NEVER omit shop_id
  include: [{ model: Customer }, { model: Product }]
})
if (!order) throw new AppError('Order not found', 404)
```

### Creating a tenant entity:
```js
const order = await Order.create({
  shop_id: shop.id,
  customer_id: customer.id,
  status: 'PENDING',
  // ... other fields
})
```

### Transactions (for multi-step operations):
```js
const t = await sequelize.transaction()
try {
  const order = await Order.create({ ... }, { transaction: t })
  await Payment.create({ order_id: order.id, ... }, { transaction: t })
  await t.commit()
} catch (err) {
  await t.rollback()
  throw err
}
```

### Association includes (prevent N+1):
```js
const orders = await Order.findAll({
  where: { shop_id: shop.id, status: 'PENDING' },
  include: [
    { model: Customer, attributes: ['name', 'phone'] },
    { model: Product, attributes: ['name', 'price'] }
  ],
  order: [['created_at', 'DESC']],
  limit, offset
})
```

---

## BULLMQ JOB PATTERNS

### Dispatch a job:
```js
const { messageProcessingQueue } = require('../../jobs/queue-manager')

await messageProcessingQueue.add('process-message', payload, {
  group: { id: shopId },          // fair-queueing
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 200
})
```

### Idempotency guard in worker:
```js
const lockKey = `job:idempotency:process-message:${messageId}:${shopId}`
const acquired = await cacheRedis.set(lockKey, '1', { NX: true, EX: 86400 })
if (!acquired) {
  logger.info('Duplicate job skipped', { messageId, shopId })
  return
}
```

### Worker structure:
```js
const worker = new Worker('message-processing', async (job) => {
  const { shopId, messageId, payload } = job.data
  // idempotency check first
  // then business logic
}, {
  connection: redisConnection,
  concurrency: 10,
  group: { concurrency: 2 }   // max 2 concurrent jobs per shopId group
})

worker.on('failed', (job, err) => {
  logger.error('Job failed', { jobId: job.id, error: err.message })
})
```

---

## META INTEGRATION PATTERNS

### 5-Guard chain in message-worker.js (order matters):
1. **Idempotency guard** — Redis NX key per `messageId + shopId`, skip if duplicate
2. **HITL guard** — if `conversation.hitl_active = true`, skip AI processing, notify human agent
3. **AI pause guard** — if last agent message < 30 min ago, skip AI
4. **Automation mode guard** — if shop.automation_enabled = false, skip
5. **Rate limit guard** — leaky bucket per `pageId`, max 170 sends/hr (Meta hard limit: 200/hr)

### Meta send pattern:
```js
const metaSendService = require('../ai/meta-send.service')

await metaSendService.sendMessage({
  recipientPsid: customer.psid,
  pageId: channel.page_id,
  accessToken: channel.access_token,  // encrypted, decrypted at runtime
  message: { text: aiResponse }
})
```

### Rate limit error handling:
```js
try {
  await metaSendService.sendMessage(...)
} catch (err) {
  if (err instanceof MetaRateLimitError) {
    // Re-enqueue with delay instead of throwing
    await queue.add('process-message', job.data, { delay: 60000 })
    return
  }
  throw err
}
```

---

## BKASH PAYMENT PATTERNS

### OAuth token (50-min cache):
```js
// bkash-merchant.service.js handles token caching internally
const bkashService = require('./bkash-merchant.service')
const token = await bkashService.getOAuthToken(shopId, config)
// Token is cached in Redis for 50 minutes, auto-refreshed
```

### Webhook HMAC verification (webhook.middleware.js):
```js
const signature = req.headers['x-bkash-signature']
const expectedSig = crypto
  .createHmac('sha256', process.env.BKASH_WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex')
if (signature !== expectedSig) throw new AppError('Invalid signature', 401)
```

### Payment config lookup (per shop):
```js
const paymentConfig = await PaymentConfig.findOne({
  where: { shop_id: shop.id, provider: 'BKASH', is_active: true }
})
if (!paymentConfig) throw new AppError('BKash not configured', 400)
```

---

## DELIVERY PROVIDER PATTERNS

### ProviderRegistry pattern:
```js
const registry = require('./providers/provider.registry')
const provider = await registry.getProvider(shop.id)
// provider implements: validateCredentials(), createOrder(), trackOrder()

const result = await provider.createOrder({
  shopId: shop.id,
  recipientName: order.customer_name,
  recipientPhone: order.customer_phone,  // normalized: 01XXXXXXXXX
  recipientAddress: order.delivery_address,
  codAmount: order.cod_amount,
  itemWeight: 0.5
})
order.tracking_id = result.trackingId
await order.save()
```

### Provider-specific auth:
- **Pathao**: OAuth2 — `issueToken(username, password, clientId, clientSecret)`, token in Redis
- **Steadfast**: API Key + Secret Key in headers `Api-Key` + `Secret-Key`
- **RedX**: Bearer token in `Authorization: Bearer {api_key}` header

---

## LOGGING STANDARD

```js
const { createLogger } = require('../../shared/logger')
const logger = createLogger('OrderService')

logger.info('Order created', { orderId: order.id, shopId: shop.id, amount: order.total })
logger.warn('Low stock', { productId, remaining: stock })
logger.error('BKash token refresh failed', { error: err.message, shopId })

// NEVER log: passwords, access tokens, full phone numbers, PSIDs, credit card data
```

---

## ERROR HANDLING

```js
const AppError = require('../../shared/errors/AppError')

// In services:
throw new AppError('Customer not found', 404)
throw new AppError('Conversation limit reached', 429)
throw new AppError('BKash payment failed', 402)

// Error middleware catches and formats via response-standardization.middleware.js
```

---

## BD-SPECIFIC CONVENTIONS

```js
// Phone: always normalize to 01XXXXXXXXX (10 digits, no country code prefix)
const normalizePhone = (raw) => raw.replace(/^(\+?880|0)/, '0').replace(/\D/g, '')

// Currency: store as integer paisa (1 BDT = 100 paisa) or decimal with 2 places
const priceInBDT = 750.00  // store as DECIMAL(10,2)

// Dates: store UTC, display in Asia/Dhaka
// Language: always detect with language-switcher.service.js before generating AI reply
```

---

## ALWAYS

- Service layer for all business logic — never in controllers
- Idempotency key on every BullMQ job
- `shop_id` in every tenant DB query
- `createLogger('ModuleName')` for all logging
- `AppError` for all error propagation
- Retries with exponential backoff on all external API calls
- Circuit breaker check before calling Gemini/OpenAI/courier APIs

## NEVER

- Business logic in controllers or routes
- DB queries without `shop_id` scoping (except admin routes)
- Hardcode API keys, tokens, or secrets
- Block on BullMQ worker — always process async
- Log sensitive data (tokens, passwords, PSIDs, phones)
- Skip idempotency guard on webhook-triggered jobs
