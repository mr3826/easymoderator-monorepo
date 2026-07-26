# 04 — Webhook Security and Reliability (Workstream C)

**Verdict for this workstream: FAIL** — security is strong, reliability is not. Two
paths lose real customer messages while telling Meta `200`.

## Security — PASS, with live production evidence

`EasyMod-backend/src/modules/integration/meta-webhook.routes.js`

| Control | Implementation | Status |
|---|---|---|
| Signature validation | HMAC-SHA256 over the raw body, `x-hub-signature-256` (line 56-64) | PASS |
| Timing-safe comparison | `crypto.timingSafeEqual`, wrapped in try/catch for length mismatch | PASS |
| Raw body handling | `express.raw({ type: '*/*' })` — the raw buffer is hashed, not a re-serialized object | PASS |
| Invalid signature | `403` (line 155-158) | PASS |
| Missing signature | `403` — `isValidSignature` returns false when `signature` is falsy | PASS |
| Missing app secret | **`403` fail-closed** with an explicit log (line 160-162) | PASS |
| Challenge verification | `hub.challenge` echoed only after a timing-safe verify-token match (line 95-127) | PASS |
| Verify-token handling | constant-time compare, plus a per-channel DB lookup fallback scoped to `status: 'CONNECTED'` | PASS |
| Rate limiting | `webhookLimiter` applied at the router (line 52) | PASS |
| Error logging hygiene | logs asset IDs and error names only — no message bodies, no tokens | PASS |

### Verified live against production this run

```
POST /api/webhooks/meta   (bad signature)   → 403
POST /api/webhooks/meta/data-deletion  (unsigned)          → {"error":"Missing signed_request"}
POST /api/webhooks/meta/data-deletion  (forged signed_request) → {"error":"Invalid signed_request signature"}
POST /api/webhooks/meta/deauthorize    (unsigned)          → {"error":"Missing signed_request"}
```

All fail closed. No PII, no token, no connection string, no stack trace in any body.

## Idempotency — PASS

`messages.external_id VARCHAR(255) UNIQUE` (`20260520_000_initial_schema.js:440`) plus a
partial index `idx_msgs_ext`. `storeIncomingMessage` does a `findOne` pre-check
(line 293-303) and the DB constraint closes the check-then-insert race. The top-level
handler classifies `SequelizeUniqueConstraintError` as expected (line 176-179).

Redis provides a second layer at the worker: `claimDedupKey('msg:dedup:${shopId}:${externalId}')`
(`message-worker.js:292-294`).

Duplicate webhook delivery therefore does **not** duplicate messages or replies.

## Reliability — FAIL

### F-02 (P1) — Unknown / non-CONNECTED Page silently drops customer messages

`meta-webhook-events.handler.js:448-467`:

```js
if (!channel) {
    logger.error(`No CONNECTED facebook channel for page_id=${pageId} — incoming messages are being dropped`);
    try {
        const prev = await MetaChannel.findOne({ where: { meta_asset_id: pageId }, ... });
        if (prev) { sseManager.emit(prev.shop_id, 'channel_error', { ... }); }
    } catch (_) { /* best-effort SSE */ }
    continue;
}
```

Then the request returns `200`.

- No durable record of the dropped message. No DLQ entry. No retry.
- The SSE notice is best-effort, in-memory, and reaches only currently-open browser tabs
  — and only if a prior `meta_channels` row exists at all. A genuinely unknown Page
  produces a log line and nothing else.
- `200` tells Meta the delivery succeeded, so **Meta will not retry**. The customer's
  message is gone permanently.

**Impact:** a merchant whose Page drifts to `ERROR` / `TOKEN_EXPIRED` (a state this system
can itself set — see `03_`) loses inbound customer messages invisibly.

### F-03 (P1) — Per-message store failure is swallowed

`meta-webhook-events.handler.js:508-512`:

```js
} catch (err) {
    logger.error(`Failed to store message from ${messaging.sender.id} (page ${pageId})`, { error: err.message, stack: err.stack });
}
```

The loop continues and the request still returns `200`. A transient DB error during
`storeIncomingMessage` therefore discards a real customer message with no durable failure
state and no possibility of Meta redelivery.

The brief's rule — *"A webhook must never report successful business completion merely
because HTTP acknowledgement succeeded"* — is violated by both F-02 and F-03.

### F-11 (P2) — Processing is synchronous before the acknowledgement

`meta-webhook.routes.js:170-172` awaits the **entire** `handlePageWebhook` — channel
resolution, DB writes, consent processing — before `res.sendStatus(200)`. Meta expects a
fast acknowledgement with work handed to a queue. Under load or DB slowness this risks
Meta-side timeouts and redelivery storms.

### F-14 (P2) — Queue-unavailable path stores but never replies

`dispatchMessageJob` (`meta-webhook-events.handler.js:140-159`) handles a null queue
honestly: it logs and fires `opsAlert(...)`. This is **good** — it is alerted, not silent.
But the customer still receives no reply, and `dispatchMessageJob` is invoked
**without `await`** at line 505, so an enqueue rejection after that point is unobserved.

## Case matrix

| # | Case | Result | Receipt |
|---|---|---|---|
| 1 | Valid signed webhook | processed | `meta-webhook.routes.test.js` (passing) |
| 2 | Invalid signature | **403** | live production probe |
| 3 | Missing signature | **403** | source line 56-57 |
| 4 | Duplicate delivery | deduped | `external_id UNIQUE` + Redis claim |
| 5 | Unknown Page ID | **silent drop + 200** | **F-02 — FAIL** |
| 6 | Missing channel mapping | **silent drop + 200** | **F-02 — FAIL** |
| 7 | Deleted shop | no CONNECTED channel → F-02 path | FAIL |
| 8 | Disconnected Page | no CONNECTED channel → F-02 path | FAIL |
| 9 | Worker unavailable | stored, alerted, no reply | F-14 — PARTIAL |
| 10 | Redis unavailable | queue null → alerted | F-14 — PARTIAL |
| 11 | Provider timeout | retry/`TOKEN_EXPIRED` handling exists | PASS (source) |
| 12 | Queue retry exhaustion | `message-dlq` exists; **depth unverifiable** (see `12_`) | BLOCKED |
| 13 | Concurrent duplicate processing | DB unique + Redis claim | PASS |
| 14 | Attachment event | normalized (`MetaMessengerProvider.js:415-425`) | PASS (source) |
| 15 | Unsupported event type | skipped with debug log | PASS |
| 16 | Malformed payload | `200`, parse error logged, no processing | PASS |

## Required remediation

1. **F-02 / F-03:** persist every inbound webhook event to a durable
   `webhook_events`-style table *before* channel resolution, and mark it
   `unresolved` / `failed` rather than dropping. Alert on non-zero unresolved depth.
   Do not extend `200` to cover business-layer failure.
2. **F-04:** acknowledge immediately after durable persistence; move processing to the
   queue.
3. **F-05:** `await dispatchMessageJob` and treat enqueue failure as a durable failure
   state.
