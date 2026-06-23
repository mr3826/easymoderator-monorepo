# EasyModerator API Contract Rules

## REST API Conventions

### URL Structure
```
/api/{module}/{resource}
/api/{module}/{resource}/:id
/api/{module}/{resource}/:id/{sub-resource}

Examples:
GET    /api/orders                       list orders (paginated)
POST   /api/orders                       create order
GET    /api/orders/:id                   get order by id
PATCH  /api/orders/:id                   update order fields
POST   /api/orders/:id/dispatch          action endpoint
DELETE /api/orders/:id                   soft-delete order

GET    /api/delivery/tracking/:orderId   sub-resource
GET    /api/subscription/usage           non-resource query
POST   /api/payment/bkash/initiate       action endpoint
```

---

## Response Envelope

### Success
```json
{
  "data": { ... },
  "meta": {
    "requestId": "uuid-v4",
    "total": 150,
    "page": 1,
    "limit": 20,
    "pages": 8
  }
}
```
- `meta.total/page/limit/pages` only required for paginated list responses
- `meta.requestId` always present (set by response-standardization.middleware.js)

### Error
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description in English",
    "details": [
      { "field": "customer_phone", "message": "Must be a valid BD phone number (01XXXXXXXXX)" }
    ]
  },
  "meta": {
    "requestId": "uuid-v4"
  }
}
```

### Error Codes
| Code | HTTP Status | Meaning |
|------|------------|---------|
| `VALIDATION_ERROR` | 400 | Request body/params failed validation |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT / webhook signature |
| `FORBIDDEN` | 403 | Valid auth but insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found (for this shop) |
| `CONFLICT` | 409 | Duplicate resource or state conflict |
| `CONVERSATION_LIMIT_REACHED` | 429 | Shop's monthly conversation limit exhausted |
| `RATE_LIMITED` | 429 | Meta API rate limit reached |
| `PAYMENT_FAILED` | 402 | BKash or payment provider error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Pagination

### Request
```
GET /api/orders?page=1&limit=20&sort=created_at&order=DESC&status=PENDING
```

### Response meta
```json
{
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "pages": 8
  }
}
```

Default: `page=1, limit=20, sort=created_at, order=DESC`
Max limit: `100`

---

## Shop Scoping

- All tenant-scoped endpoints: `shop_id` extracted from JWT (`req.shop.id`)
- NEVER accept `shop_id` in request body for tenant-scoped operations
- NEVER accept `shop_id` in URL params for tenant-scoped operations
- Exception: admin routes with explicit `?shopId=` query param (admin-only middleware required)

---

## Webhook Contracts

### Meta Webhooks (Incoming)
```
Endpoint:      POST /api/webhooks/meta
Verification:  GET  /api/webhooks/meta  (hub.challenge response)
Signature:     X-Hub-Signature-256 header
Algorithm:     HMAC-SHA256 with META_APP_SECRET
Processing:    async via BullMQ (respond 200 immediately)
Response:      200 OK immediately, then process job asynchronously

Webhook replay safety:
  - job is idempotent: same messageId processed only once
  - idempotency key: job:idempotency:process-message:{messageId}:{shopId}
  - TTL: 86400s (24 hours)
```

### BKash Webhooks
```
Endpoint:   POST /api/payment-webhook/bkash
Signature:  X-BKash-Signature header
Algorithm:  HMAC-SHA256 with BKASH_WEBHOOK_SECRET
Idempotency: trxId stored in TrxIdLog entity — second call with same trxId is no-op
```

### Courier Webhooks
```
POST /api/courier-webhook/pathao
POST /api/courier-webhook/steadfast
POST /api/courier-webhook/redx

Auth: provider-specific (API key or signature)
Processing: update Order.tracking_status, send SSE to dashboard
```

### Data Deletion Callback (Meta Required)
```
POST /api/webhooks/meta/data-deletion
Body: { user_id: string, signed_request: string }
Response: { url: string, confirmation_code: string }
```

---

## Versioning Policy

**Current:** Unversioned (all routes at `/api/`)
**Future versioning:** `/api/v2/` only when breaking changes are required

**Breaking change definition:**
- Removing a required response field
- Changing a field's data type
- Changing the auth mechanism
- Changing the response envelope structure

**Non-breaking changes (no version bump needed):**
- Adding optional response fields
- Adding new endpoints
- Adding optional request params with defaults

**Contract change protocol:**
1. Write new test asserting the new contract shape FIRST
2. Update this file (`api-contract-rules.md`)
3. Update frontend TypeScript types in `src/api/types/`
4. PR description must include section: **"API Contract Change"**
5. Frontend PR must reference the backend PR: `Depends on: EasyMod-backend#{PR}`
