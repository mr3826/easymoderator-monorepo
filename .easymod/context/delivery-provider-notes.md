# EasyModerator Delivery Provider Notes

## Provider Registry Pattern

**File:** `src/modules/delivery/providers/provider.registry.js`

The ProviderRegistry resolves the correct delivery provider adapter for a shop based on `DeliveryConfig` settings. Each provider implements the same interface:

```js
// delivery-provider.interface.js — required methods
class DeliveryProvider {
  async validateCredentials(config)   // test credentials, return { valid: boolean, error? }
  async createOrder(orderData)        // create delivery, return { trackingId, consignmentId }
  async trackOrder(trackingId, config) // fetch tracking status
  async issueToken(credentials)       // OAuth token refresh (where applicable)
}
```

### Registry Usage
```js
const registry = require('./providers/provider.registry')
const provider = await registry.getProvider(shopId)

// Validate first
const { valid, error } = await provider.validateCredentials(config)
if (!valid) throw new AppError(`Delivery config invalid: ${error}`, 400)

// Create order
const result = await provider.createOrder({
  shopId,
  recipientName: order.customer_name,
  recipientPhone: order.customer_phone,  // normalized: 01XXXXXXXXX
  recipientAddress: order.delivery_address,
  recipientCity: order.delivery_city,
  codAmount: order.cod_amount,
  itemWeight: 0.5,  // kg, default
  itemDescription: order.product_summary
})

order.tracking_id = result.trackingId
order.status = 'DISPATCHED'
await order.save()
```

---

## Pathao

**API Base:** `https://courier-api.pathao.com` (production)
**Sandbox:** `https://courier-api-sandbox.pathao.com`

### Authentication: OAuth 2.0
```
Token endpoint: POST /aladdin/api/v1/issue-token
Body:
  client_id, client_secret, username, password,
  grant_type: 'password'

Response:
  { access_token, refresh_token, token_type: 'Bearer', expires_in: 3600 }
```

### Stored Credentials (per shop, in `DeliveryConfig.credentials` JSON)
```json
{
  "client_id": "...",
  "client_secret": "...",
  "username": "...",
  "password": "...",
  "access_token": "...",
  "refresh_token": "...",
  "token_expires_at": "ISO timestamp",
  "isSandbox": false
}
```

### Token Management
- Token expires in 1 hour
- Refresh before expiry using `refresh_token`
- `isSandbox: true` → use sandbox base URL
- All credentials stored encrypted in `DeliveryConfig.credentials` (CHANNEL_ENCRYPTION_KEY)

### Key Endpoints
```
POST /aladdin/api/v1/issue-token       authenticate
POST /aladdin/api/v1/parcel/create     create delivery order
GET  /aladdin/api/v1/parcel/{id}       track by consignment ID
GET  /aladdin/api/v1/merchant/zone     list available zones
```

### validateCredentials
```js
// Attempt a GET /aladdin/api/v1/merchant/store using the token
// Success → { valid: true }
// 401 → try refresh; if refresh fails → { valid: false, error: 'Token expired' }
```

### Known Notes
- Sandbox and production use different credentials (not the same account)
- `isSandbox` flag in credentials controls base URL selection
- Zone list is used for delivery area validation in the AI (delivery-rag)
- Access token should be cached per shop, refresh on 401 response

---

## Steadfast

**API Base:** `https://portal.packzy.com/api/v1`
**No sandbox available** — use production for all testing (be careful with real orders)

### Authentication: API Key + Secret Key
```
Headers on every request:
  Api-Key: {steadfast_api_key}
  Secret-Key: {steadfast_secret_key}
  Content-Type: application/json
```

### Stored Credentials
```json
{
  "api_key": "...",
  "secret_key": "..."
}
```

### Key Endpoints
```
POST /create_order        create delivery order
GET  /status_by_cid/{id} track by consignment ID
GET  /get_balance         validate credentials (check balance)
```

### validateCredentials
```js
// GET /get_balance with Api-Key + Secret-Key headers
// 200 → { valid: true }
// 401/403 → { valid: false, error: 'Invalid API credentials' }
```

### Known Notes
- Simplest integration — stateless per-request auth
- No token expiry or refresh required
- `packzy.com` domain is Steadfast's portal
- Rate limits not documented — monitor for 429 responses

---

## RedX

**API Base:** `https://openapi.redx.com.bd/v1.0.0-beta`
**Note:** API is in beta — endpoints and response shapes may change without notice

### Authentication: Bearer Token
```
Header on every request:
  Authorization: Bearer {api_key}
  Content-Type: application/json
```

### Stored Credentials
```json
{
  "api_key": "..."
}
```

### Key Endpoints
```
POST /parcel             create delivery order
GET  /parcel/{trackingId} track parcel
GET  /account/balance    validate credentials
```

### validateCredentials
```js
// GET /account/balance with Authorization: Bearer {api_key}
// 200 → { valid: true }
// 401 → { valid: false, error: 'Invalid API key' }
```

### Known Notes
- Beta API — check for breaking changes before updates
- BD-specific courier focused on Dhaka metro + select districts
- Bearer auth is the simplest of the three providers

---

## Paperfly (Planned — Not Yet Implemented)

Status: Planned integration, no code exists yet

When implementing:
- Follow the same `DeliveryProvider` interface pattern
- Add adapter: `src/modules/delivery/providers/paperfly.provider.js`
- Register in `provider.registry.js`
- Add credentials schema to `DeliveryConfig.credentials`
- Add test: `__tests__/paperfly.provider.test.js`
- Add env vars for default credentials (if applicable)

Reference: Paperfly API documentation (research before implementing)

---

## Delivery RAG

**Files:** `delivery-rag.service.js`, `delivery-rag.controller.js`
**Routes:** `/api/delivery/rag/*`

Purpose: AI can answer delivery-related questions using knowledge retrieval:
- "Do you deliver to Sylhet?"
- "How long does delivery take to Chittagong?"
- "What is the delivery charge for 2 kg?"

Knowledge indexed: delivery zones per provider, estimated timelines, pricing per weight/zone.

Tenant isolation: each shop has its own delivery knowledge namespace (same shopId namespace pattern as product RAG).

---

## Order Dispatch Technical Flow

```
/app/orders → seller clicks "Dispatch" button
  → PATCH /api/orders/:id { action: 'dispatch', provider: 'pathao' }
  → order.service.dispatchOrder(orderId, shop, provider)
  → delivery.service.bookDelivery(order, shop)
  → registry.getProvider(shopId) → resolve Pathao/Steadfast/RedX adapter
  → provider.validateCredentials(config) → throw if invalid
  → provider.createOrder(orderPayload)
  → Order.tracking_id = trackingId
  → Order.status = 'DISPATCHED'
  → Order.dispatched_at = now
  → SSE push: order status update to dashboard
  → Customer DM notification (if enabled): "আপনার পণ্য পাঠানো হয়েছে। ট্র্যাকিং: {trackingId}"
```

## Order Tracking

**File:** `src/modules/delivery/order-tracking.service.js`

Tracking updates sourced from:
- Courier webhooks (where available)
- Polling fallback: BullMQ scheduled job checking status for DISPATCHED orders
- Manual status update by seller from dashboard

Status values: `DISPATCHED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED / RETURNED`

---

## Known Issues & Lessons Learned

_This section is populated by `.easymod/memory/failures.md` after delivery integration incidents._

_No entries yet._
