# EasyModerator Business Flow

## BD Seller Journey (7 Stages)

| Stage | Milestone | Key Action | System Event |
|-------|-----------|-----------|-------------|
| 1 | Signup | Create account, verify email | User + Shop created |
| 2 | Channel Connected | FB Page or IG OAuth authorized | Channel entity created, access token stored encrypted |
| 3 | First Automation Live | Configure keyword trigger for a post | Keyword entity created, webhook subscription active |
| 4 | First AI Reply Sent | Real customer comment triggers DM | **Aha moment** — automation visible |
| 5 | First Order Captured | Customer replies, order session → order created | Order entity with PENDING status |
| 6 | First Delivery Booked | Seller dispatches via Pathao/Steadfast/RedX | Order gets tracking_id |
| 7 | Renewal | Month 2 subscription payment | Retention achieved |

---

## Comment-to-Order Funnel (14 Steps)

Full technical flow from customer comment to order captured:

```
1. Customer comments on FB/IG post with trigger keyword
   ↓
2. Meta sends webhook: POST /api/webhooks/meta (or /api/integration/meta)
   Headers: X-Hub-Signature-256: sha256={HMAC-SHA256 of body with META_APP_SECRET}
   ↓
3. Signature verified by webhook.middleware.js
   Invalid signature → 401, drop request
   ↓
4. Webhook payload parsed → determine event type (comment / message / postback)
   ↓
5. Job enqueued to 'message-processing' BullMQ queue
   Options: { group: { id: shopId }, attempts: 3, backoff: exponential }
   Response: 200 OK (immediate, before job completes)
   ↓
6. message-worker.js consumes job — 5-guard chain:
   Guard 1: Idempotency — Redis NX key (messageId + shopId), skip if duplicate
   Guard 2: HITL active — skip AI if conversation.hitl_active = true
   Guard 3: AI pause — skip if last agent message < 30 min ago
   Guard 4: Automation mode — skip if shop.automation_enabled = false
   Guard 5: Rate limit — leaky bucket 170/hr per pageId; delay job if approaching limit
   ↓
7. intent-router.service.js — 3-tier routing:
   Tier 1: Check intent cache (Redis key: intent:{shopId}:{normalizedMsg}, TTL: 30 min)
   Tier 2: Semantic FAQ (embedding similarity ≥ 0.82 against shop knowledge base)
   Tier 3: LLM call (build context: last 10 messages + RAG snippets + shop settings)
   ↓
8. Language detection: language-switcher.service.js
   Bengali script → 'bn', Banglish patterns → 'banglish', else → 'en'
   AI reply generated in detected language
   ↓
9. guardrail.service.js — 5-guard validation on AI response:
   Guard 1: RTO fraud detection (BD phone fraud patterns)
   Guard 2: Prompt injection (prompt-sanitizer.service.js)
   Guard 3: Hallucination detection (hallucination-detector.service.js)
   Guard 4: Content policy (Meta-safe content check)
   Guard 5: Response quality score (minimum quality threshold)
   HIGH severity violation → set conversation.hitl_active = true, do not send
   ↓
10. meta-send.service.js dispatches DM via Meta Graph API (v22.0)
    POST https://graph.facebook.com/v22.0/me/messages
    Recipient: customer.psid, Access-Token: channel.access_token (decrypted at runtime)
    ↓
11. Customer replies to DM
    → order-session.service.js creates order session
    → AI guides customer through product selection, quantity, delivery address
    ↓
12. Order confirmed in conversation
    → order.service.js creates Order entity (status: PENDING)
    → rto-shield.service.checkPhone(customer.phone) — RTO risk flag
    → SSE push to seller dashboard: new order notification
    ↓
13. Seller initiates delivery booking from /app/orders
    → delivery.service.js → provider.registry.getProvider(shopId)
    → provider.validateCredentials() → provider.createOrder(orderData)
    → Order.tracking_id = result.trackingId, Order.status = DISPATCHED
    ↓
14. Optional: BKash payment link sent
    → bkash-merchant.service.createPayment(amount, orderId)
    → DM payment link to customer
    → BKash webhook: POST /api/payment-webhook/bkash
    → HMAC verified, TrxIdLog idempotency, Order.payment_status = PAID
```

---

## BKash Payment Flow

```
1. Seller triggers payment for confirmed order
   ↓
2. bkash-merchant.service.getOAuthToken(shopId, config)
   Cache check: cacheRedis.get('bkash:token:{shopId}')
   If miss: POST /token/grant → cache for 50 min
   ↓
3. bkash-merchant.service.createPayment(amount, orderId, callbackURL)
   POST https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout/create
   Response: { bkashURL, paymentID }
   ↓
4. Customer receives BKash payment link in DM
   Customer completes payment in BKash app
   ↓
5. BKash sends webhook: POST /api/payment-webhook/bkash
   Header: X-BKash-Signature (HMAC-SHA256 with BKASH_WEBHOOK_SECRET)
   ↓
6. webhook.middleware.js verifies HMAC signature → 401 if invalid
   TrxIdLog.findOrCreate({ trxId }) → if already exists, return 200 no-op
   ↓
7. paymentWebhookService.handleBkashWebhook(payload)
   → Order.payment_status = 'PAID'
   → SSE push to seller dashboard: payment confirmed
   → invoice-generator creates payment record
```

---

## Subscription Billing Flow

### Flat Monthly Plans (PACKAGE_1 + PACKAGE_2)
```
Day of month (subscription.billing_date):
  → BKash payment initiated for monthly fee
  → On success: subscription.status = 'active', conversations_used reset to 0
  → On failure: failed-payment-reconciler.js job
    Retry schedule: +1 day, +3 days, +7 days
    After 7 days unpaid: automation paused, seller notified
```

### PARTNER Plan (Per-Order Billing)
```
Daily: daily-overage-calculator.js BullMQ job
  → Count delivered orders for each PARTNER shop
  → Apply tier rate (15/12/10 BDT based on monthly total)
  → Accumulate daily charges in reconciliation records

Month end:
  invoice-generator.js job
  → Sum all daily charges for the month
  → Generate invoice entity
  → Initiate BKash payment for total amount
```

### Top-Up Pack Purchase
```
Seller clicks top-up CTA → selects pack (100/250/500/1000 conversations)
→ BKash payment flow (same as above)
→ On success: subscription.conversations_limit += pack_size
→ Immediate availability (no monthly wait)
```

---

## RTO Shield Flow

RTO = Return to Origin — delivery failure risk indicator

```
New order created:
  rto-shield.service.checkPhone(customerPhone)
  ↓
  Check: phone in blacklist (manual) → flag immediately
  Check: customer.delivery_attempts ≥ 3 AND customer.rto_rate ≥ 40% → auto-flag
  ↓
  If flagged:
    order.rto_risk_flag = true
    Owner notification: "⚠️ RTO risk detected for this customer"
    Order still created — seller decides whether to proceed
    Seller can: accept, request advance payment (BKash), or cancel
```

---

## Human-in-the-Loop (HITL) Flow

```
Trigger: Customer types escalation phrase OR AI confidence low OR guardrail HIGH severity

1. conversation.hitl_active = true (set by HITL detection logic or guardrail)
   ↓
2. message-worker.js guard 2: detects hitl_active = true
   → Skip AI processing, do not auto-reply
   ↓
3. SSE push to seller dashboard: conversation card highlighted in red/orange
   Notification: "আপনার সাহায্য দরকার — একজন গ্রাহক অপেক্ষা করছেন"
   ↓
4. Human agent (seller) reviews conversation at /app/inbox
   Types reply manually via dashboard
   ↓
5. Reply sent via meta-send.service.js
   conversation.last_agent_message_at = now
   ↓
6. message-worker.js guard 3: AI pause — 30 minutes after last_agent_message_at
   AI remains paused during this window
   ↓
7. After 30 minutes with no further agent message:
   conversation.hitl_active = false (auto-reset or manual toggle)
   AI resumes normal operation
```
