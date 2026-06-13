# Design — Channel notification fix + multi-product chat orders

**Date:** 2026-06-13
**Status:** Approved
**Branch:** `feat/multi-product-orders`

Two pieces shipped together in one PR / one deploy:
1. Fix the silent `Channel`-undefined notification bug.
2. Teach the AI chat order flow to build a multi-item cart.

---

## Part 1 — `Channel` notification bug

### Root cause
`src/modules/entities.js` exports `MetaChannel`, never `Channel`. Six files
destructure `Channel` from `../entities`, so `Channel` is `undefined` and
`Channel.findOne()` throws `TypeError: Cannot read properties of undefined`.
Every call site wraps the lookup in `try/catch` that logs a `warn` and returns
`{ success: false }`, so the failure is silent — the notification simply never
sends.

### Second layer: recipient
`webhook.service.sendMessage(channel, recipientId, text)` is a shim that resolves
the real `MetaChannel` from `{ shop_id, type, meta_channel_id? }` and calls the
live provider. The Meta send API needs a PSID/IGSID as `recipientId`. Only two
sites pass one today:

| Site | recipient passed | delivers after model fix? |
|---|---|---|
| `order/order-tracking.service.js:84` | `customer.external_id` (PSID) | yes |
| `webhooks/payment-webhook.controller.js:202` | `customerChannelId` (PSID) | yes |
| `delivery/delivery-tracking.service.js:350,392` | `order.customer_phone` | no — needs PSID |
| `notification/owner-notification.service.js:244,392` | `owner.phone` / `customerPhone` | no — needs PSID |
| `invoice/invoice.service.js:385` | `customer.phone` | no — legacy path |

### Fix scope (approved)
1. **All six files** — replace the undefined `Channel` with a real `MetaChannel`
   lookup (`{ shop_id, platform, status: 'CONNECTED' }`) and pass
   `{ shop_id, type, meta_channel_id }` to the shim. Stops every silent crash.
2. **delivery-tracking** — also resolve the customer's PSID from
   `order.customer_id → Customer.channel_user_id` instead of passing a phone, so
   dispatched/delivered pings actually deliver.
3. **owner-notification FB branch + legacy invoice FB-send** — fix the crash only;
   leave recipient handling as-is (owner already gets email+push; the chat invoice
   already delivers via the worker). Log a clear reason instead of pretend-sending.

`platform` mapping: a `messenger`/`facebook` channel → `MetaChannel.platform =
'facebook'`; `instagram` → `'instagram'`. The shim's `channel.type` stays
`'messenger'`/`'instagram'`.

---

## Part 2 — Multi-product chat orders

Order-creation core (`order.service.js`), the manual order form (`Orders.tsx`),
and the chat invoice (`chat-invoice.service.js`) already handle an `items[]`
array. The only single-product surface is the chat step machine
(`order-session-standalone.service.js`), which stores one `session.product_info`.

**Decisions:** add-another loop (deterministic); minimal editing (add + cancel,
no per-line removal).

### Data model
`step_data.cart = [{ product_id, name, name_bn, price, quantity }, …]`.
`session.product_info` remains "the item currently being configured." When a
quantity is captured, the configured item is pushed into `cart`.

### Step machine
Current: `SELECTING_PRODUCT → PRODUCT_CONFIRMATION → COLLECTING_QUANTITY → NAME →
PHONE → ADDRESS → ZONE → PAYMENT → ORDER_SUMMARY → (confirm)`.

Changes:
- **COLLECTING_QUANTITY** — after qty, push item to `cart`, go to **ADD_MORE**.
- **ADD_MORE** *(new)* — "Add another item, or proceed to checkout?" (bilingual).
  `add` → **ADDING_PRODUCT**; `no`/checkout → COLLECTING_NAME.
- **ADDING_PRODUCT** *(new)* — next message (name or photo) → same
  `productSearch.searchForOrder` + image matcher used at session start; 1 confident
  match → PRODUCT_CONFIRMATION/quantity; multiple → existing SELECTING_PRODUCT picker.
- **NAME → PHONE → ADDRESS → ZONE → PAYMENT** unchanged (per-order, collected once).
- **generateOrderSummary** — iterate `cart`, one line per item, sum item totals + delivery.
- **ORDER_SUMMARY confirm** — re-check stock for every cart item; build
  `items: cart.map(c => ({ product_id, quantity }))`; pass all cart items to
  `issueInvoiceForOrder`.
- Single-item order = a 1-item cart (backward compatible).

Cancel stays at the order-flow layer (`isOrderCancel`); no per-line removal.

---

## Tests (TDD, first)
- **Bug fix:** each service resolves `MetaChannel` (not undefined) and calls the
  shim with a PSID; delivery-tracking resolves PSID from the order.
- **Multi-product:** `order-session-standalone.steps.test.js` — 2- and 3-item
  carts, ADD_MORE loop, per-item stock re-check, summary lists all lines;
  `order-session-standalone.createorder.test.js` — N `order_items` rows, summed
  totals, N-line invoice.

## Packaging & deploy
One branch, two commits (1: bug fix, 2: multi-product), one PR → squash-merge →
`ci-cd.yml` builds+pushes both images and deploys to the droplet → verify
`/health` + a live trace.
