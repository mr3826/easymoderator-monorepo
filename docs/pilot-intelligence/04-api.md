# Pilot Intelligence — API

All routes are under `/api` and require `Authorization: Bearer <access token>`.

- The tenant is **always** the token's `shopId`. No route reads a shop id from
  the path, query, body or headers.
- Every merchant route runs `authenticate` and then `verifyShopAccess` (active
  `user_shops` membership, which sets the role to `owner`, `admin` or `staff`).
- Bodies and queries are validated with Joi. **Unknown keys are rejected
  (400).** IDs must be UUIDs.
- The machine-readable contract is `EasyMod-backend/openapi.yaml` (tags
  `CustomerIntelligence`, `OrderConfidence`, `Admin`).

Nothing existing changed shape. The only change to an existing route is that
`POST /api/order/:orderId/book-courier` (and its alias `/courier`) can answer
**409 `ORDER_CONFIDENCE_HOLD`**, and only for shops in `enforce` mode.

## Customer intelligence

These answer `409 { code: 'FEATURE_DISABLED' }` unless the shop has the
`customer_intelligence` pilot flag. The exception is `/status`, which always
answers.

### `GET /customer-intelligence/status`

```json
{ "success": true, "data": { "customer_intelligence": true, "order_confidence_mode": "shadow" } }
```

### `GET /customer-intelligence/customers`

| Query | Type | Default |
| --- | --- | --- |
| `page` | int ≥ 1 | 1 |
| `pageSize` | 1–50 | 20 |
| `search` | ≤ 100 chars; name or phone (a full BD mobile matches any stored spelling) | — |
| `view` | `all` \| `opportunities` (customers with a live opportunity) | `all` |

The body is flat, like the existing `/customer` list:
`{ success, data: Customer360ListItem[], total, page, pageSize }`.

```json
{
  "id": "…", "name": "Rahim Uddin", "phone": "01711111111", "email": null, "channel_type": "messenger",
  "profile_pic": null, "first_seen_at": "…",
  "state": "REPEAT_BUYER", "state_reasons": [{ "code": "MULTIPLE_DELIVERIES", "params": { "delivered": 3 } }],
  "total_orders": 4, "delivered_orders": 3, "returned_orders": 0, "delivered_value": 4500,
  "last_order_at": "…", "last_activity_at": "…",
  "open_opportunity": { "id": "…", "status": "OPEN", "strength": "HIGH", "reasons": ["PURCHASE_INTENT"] }
}
```

### `GET /customer-intelligence/customers/:customerId`

Returns 404 when the customer does not exist in **this** shop; another shop's
id is indistinguishable from a missing one. The `data` object contains:

| Field | Content |
| --- | --- |
| `customer` | Identity, `page`, `last_activity_at`, `last_inbound_at` |
| `contactability` | `{ platform, window_open, window_closes_at, reason }`. Advisory only: sends are still decided by the policy engine. `reason` ∈ `WITHIN_24H_WINDOW`, `OUTSIDE_24H_WINDOW`, `OPTED_OUT`, `NO_INBOUND_MESSAGE`, `NOT_A_MESSAGING_CHANNEL`. |
| `state`, `state_reasons`, `state_rules_version` | e.g. `customer-state/1.0.0` |
| `summary` | `total_orders`, `delivered_orders`, `returned_orders`, `cancelled_orders`, `in_progress_orders`, `ordered_value`, `delivered_value`, `first_order_at`, `last_order_at`, `last_delivered_at` |
| `rto_signal` | `{ available, tier: clear\|verify\|block, risk_score, list: SHOP_LIST\|NETWORK_LIST\|null, network: { shops_reported, total_attempts, rto_rate } }`, or `{ available:false, reason }` |
| `orders[]` | Up to 50: `id, order_number, created_at, total, order_status, payment_status, delivery_status, delivery_provider, outcome, link: CUSTOMER\|PHONE_MATCH, confidence` |
| `conversations[]` | Up to 20, with `customer_messages` counts |
| `opportunities[]` | Up to 10, serialized like the opportunity list |
| `timeline[]` | Up to 60 events, newest first: `CUSTOMER_FIRST_SEEN`, `CONVERSATION`, `ORDER_PLACED`, `COURIER_BOOKED`, `ORDER_DELIVERED`, `ORDER_RETURNED`, `ORDER_CANCELLED`, `OPPORTUNITY_DETECTED`, `OPPORTUNITY_CONVERTED`, `OPPORTUNITY_DISMISSED`, `OPPORTUNITY_EXPIRED`. `approximate_time: true` marks a time taken from `updated_at`. |

### `GET /customer-intelligence/opportunities`

Query parameters:

- `status`: `LIVE` (OPEN and ACTIONED, the default) or one of `OPEN`,
  `ACTIONED`, `CONVERTED`, `DISMISSED`, `EXPIRED`;
- `page`;
- `pageSize` (≤ 50).

The body is flat: `{ success, data: Opportunity[], total, page, pageSize }`.

```json
{
  "id": "…", "status": "OPEN", "strength": "HIGH",
  "reasons": ["PURCHASE_INTENT", "ASKED_DELIVERY_CHARGE"],
  "signals": [{ "code": "PURCHASE_INTENT", "source": "MESSAGE", "intent_id": "PURCHASE_INTENT_START",
                "attribute": null, "checkout_step": null, "message_id": "…", "at": "…" }],
  "product_refs": [{ "product_id": "…", "name": "Black Panjabi", "quantity": 2 }],
  "customer_id": "…", "conversation_id": "…",
  "first_signal_at": "…", "last_signal_at": "…", "detected_at": "…",
  "actioned_at": null, "converted_order_id": null, "resolved_at": null, "resolution_reason": null,
  "detector_version": "opportunity-detector/1.0.0",
  "recommended_action": { "code": "REPLY_IN_INBOX", "window_closes_at": "…" },
  "customer": { "id": "…", "name": "Karim", "channel_type": "messenger" }
}
```

`recommended_action.code` is one of `REPLY_IN_INBOX`,
`WAIT_FOR_CUSTOMER_MESSAGE`, `DO_NOT_CONTACT` or `CONTACT_BY_PHONE`. It is
`null` for a resolved opportunity. Signals never contain message text.

### `GET /customer-intelligence/opportunities/summary?days=30`

```json
{ "window_days": 30, "detected": 41, "by_status": { "OPEN": 9, "ACTIONED": 4, "CONVERTED": 12, "DISMISSED": 6, "EXPIRED": 10 },
  "by_strength": { "HIGH": 30, "MEDIUM": 11 }, "conversion_rate": 0.429,
  "median_minutes_to_action": 35, "median_minutes_to_order": 180 }
```

`conversion_rate` is converted ÷ (converted + dismissed + expired), and `null`
when nothing is resolved yet. No revenue is claimed.

### `POST /customer-intelligence/opportunities/:id/contacted`

The body is `{}`. It moves OPEN to ACTIONED. It returns 404 when the
opportunity is not in this shop, and 409 `OPPORTUNITY_STATE_CONFLICT` when it
is not OPEN. The action is audited (`OPPORTUNITY_CONTACTED`).

### `POST /customer-intelligence/opportunities/:id/dismiss`

The body is `{ "reason": "NOT_INTERESTED" | "ALREADY_HANDLED" | "NOT_A_REAL_REQUEST" | "OTHER" }`.
It moves a live opportunity to DISMISSED. The action is audited
(`OPPORTUNITY_DISMISSED`, with the reason).

## Order confidence (RTO Shield v2)

### `GET /order-confidence/orders/:orderId`

The decision is re-evaluated from current facts. It is idempotent, and only
writes when something changed. When the shop's mode is `off` it returns
`{ order_id, mode: 'off', decision: null }`.

```json
{
  "order_id": "…", "mode": "enforce",
  "decision": "VERIFY", "effective_state": "VERIFY", "bookable": true, "required_action": "VERIFY",
  "reasons": [
    { "code": "ADDRESS_TOO_SHORT", "severity": "VERIFY", "source": "ORDER", "evidence": { "length": 9, "minimum": 15 } },
    { "code": "NEW_CUSTOMER", "severity": "INFO", "source": "ORDER_HISTORY", "evidence": { "previous_orders": 0 } }
  ],
  "rules_version": "order-confidence/1.0.0", "evaluated_at": "…", "decision_version": 4,
  "resolution": null,
  "gate": { "last_result": "HELD", "last_at": "…", "held_count": 1 },
  "released_at": null, "outcome": null, "outcome_at": null,
  "history": [{ "at": "…", "event": "HELD", "decision": "VERIFY", "resolution": null, "actor": null }]
}
```

The enumerated fields take these values:

| Field | Values |
| --- | --- |
| `required_action` | `NONE`, `VERIFY`, `APPROVE`, `NOT_BOOKABLE` |
| `resolution` | `{ type: VERIFIED\|APPROVED, level, method, note, resolved_by, resolved_at, applies, stale }` |
| `history[].event` | `EVALUATED`, `CHANGED`, `RESOLUTION_STALE`, `HELD`, `RELEASED`, `SHADOW_WOULD_HOLD`, `VERIFIED`, `APPROVED` |

### `POST /order-confidence/orders/:orderId/verify`

Any shop role may call this.

```json
{ "decision_version": 4, "method": "PHONE_CALL | CHAT | IN_PERSON | OTHER", "note": "optional ≤ 500" }
```

### `POST /order-confidence/orders/:orderId/approve`

**Owner or admin only.** The route answers 403 for staff, and the service
re-checks the role.

```json
{ "decision_version": 2, "note": "5–500 chars, required" }
```

Both resolution calls return the updated decision. Each writes an `audit_logs`
row in the **same transaction** as the change:

- `ORDER_CONFIDENCE_VERIFIED` or `ORDER_CONFIDENCE_APPROVED`;
- actor, the old decision and version;
- the new resolution, method, note, fingerprint and version.

Resolution conflicts answer 409, with the current decision in
`error.details.decision`:

| `code` | When |
| --- | --- |
| `DECISION_CHANGED` | `decision_version` is not the current version, or the CAS lost to a concurrent write |
| `APPROVAL_REQUIRED` | Verify was called on a MANUAL_REVIEW decision |
| `NO_RESOLUTION_REQUIRED` | The decision is READY |
| `ORDER_NOT_BOOKABLE` | The order is cancelled or refunded |
| `FEATURE_DISABLED` | The shop's mode is `off` (response body carries no decision) |

### `GET /order-confidence/summary?days=30`

Owner or admin only.

```json
{ "window_days": 30, "evaluated_orders": 120,
  "by_decision": { "READY": 96, "VERIFY": 20, "MANUAL_REVIEW": 4 },
  "held_orders": 18, "shadow_would_hold": 0, "verified": 15, "approved": 3,
  "outcomes_by_released_decision": { "READY": { "DELIVERED": 70, "RETURNED": 4 }, "VERIFY+VERIFIED": { "DELIVERED": 12, "RETURNED": 1 } } }
```

### Changed: `POST /order/:orderId/book-courier` (alias `/order/:orderId/courier`)

In `enforce` mode, a held order returns:

```json
{ "success": false, "error": { "code": "ORDER_CONFIDENCE_HOLD", "message": "…",
  "decision": "VERIFY", "reasons": ["ADDRESS_TOO_SHORT"], "decision_version": 4 } }
```

The code is `ORDER_CONFIDENCE_UNAVAILABLE` when the engine could not evaluate
the order. No courier claim is created and the provider is not called. Every
other response is unchanged.

## Admin (platform operators)

These are mounted under `/api/admin`, which runs `authenticate` and then
`requirePlatformAdmin()`. Writes require `SUPER_ADMIN` and are audited in the
same transaction.

| Method | Path | Body | Audit action |
| --- | --- | --- | --- |
| GET | `/admin/shops/:shopId/pilot-features` | — | — |
| PATCH | `/admin/shops/:shopId/pilot-features` | `{ customer_intelligence?: bool, order_confidence_mode?: 'off'\|'shadow'\|'enforce', order_confidence_config?: { high_value_cod_threshold?: 0–1,000,000, address_min_length?: 0–100 } }` (at least one key) | `admin:pilot_features_update` (old and new) |
| POST | `/admin/pilot-features/disable-all` | — | `admin:pilot_features_disable_all` |

## Health

`GET /health/detailed` includes a `pilotIntelligence` block:
`{ counters: {…}, lastEventAt }`. It carries counts only, never identifiers.
See [07-operations-runbook.md](07-operations-runbook.md).
