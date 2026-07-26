# 05 — Webhook Durability Fix (F-02, F-03)

## Flow

```
Meta webhook → verify HMAC-SHA256
  → for each messaging event: durably persist a receipt   (BEFORE ack)
  → ack Meta 200                                          (5xx only if the receipt write itself failed)
  → resolve Page/channel identity
      unknown / not CONNECTED → receipt = IDENTITY_NOT_RESOLVED (retryable, PII-free alert, no tenant assoc.)
      resolved                → store message → SSE → enqueue AI → receipt = PROCESSED
          store fails         → receipt = RETRY_PENDING (bounded backoff) → DEAD_LETTERED on exhaustion + alert
  → reconciler job (every 2 min) replays due receipts through the SAME ingestion path
```

## New artifacts

| File | Purpose |
|---|---|
| `src/database/migrations/20260726_001_meta_webhook_receipts.js` | `meta_webhook_receipts` table + status enum + indexes |
| `src/modules/integration/meta-webhook-receipt.entity.js` | Sequelize model |
| `src/modules/integration/meta-webhook-receipt.service.js` | record / classify / state transitions / claim / retention |
| `src/modules/integration/meta-channel-resolver.js` | single resolution path shared by the router and reconciler |
| `src/jobs/webhook-receipt-reconciler.job.js` | replays held/failed receipts, advances backoff, dead-letters, purges |
| `src/utils/webhook-payload-cipher.js` | AES-256-GCM for the replay body (distinct AAD from token cipher) |

Changed: `meta-webhook-events.handler.js` (receipt-first ingestion + `processMessagingEvent` shared by reconciler), `meta-webhook.routes.js` (returns **503** on `WebhookReceiptPersistenceError`), `queue-manager.js`/`jobs/index.js` (schedule the reconciler), `health.routes.js` (surface `webhookReceipts.deadLettered`/`held`), `entities.js`.

## Data minimisation & privacy

Stored: provider, page_id, event_id (Meta mid), a `dedupe_key`, event_type, **`sender_ref = sha256(PSID)`** (never the raw PSID), `payload_hash`, an **AES-256-GCM-encrypted** replay body (only for replayable events), status, retry_count, last_error_code (sanitized), next_retry_at, processing_token, timestamps. **No tokens.** Retention: PROCESSED/SKIPPED purged after 7 days, DEAD_LETTERED after 30. Operational alerts contain page_id + receipt id + counts only.

## States

`RECEIVED · PROCESSING · QUEUED · PROCESSED · SKIPPED · IDENTITY_NOT_RESOLVED · MESSAGE_STORE_FAILED · RETRY_PENDING · DEAD_LETTERED`

## Acknowledgement contract

- Durable receipt written → `200` even if downstream is pending.
- Receipt write itself failed → **`503`** so Meta redelivers (the only 5xx path).
- No AI/provider work before ack; acknowledgement stays fast.

## Concurrency

`recordReceipt` is idempotent on `dedupe_key`; a lost unique-index race resolves to the existing row (duplicate, not a 5xx). The reconciler claims each receipt with a fencing `processing_token` via a conditional UPDATE, so two runs never replay the same event; stale `PROCESSING` claims (>15 min) are reclaimed.

## Tests — `src/modules/integration/__tests__/meta-webhook-durability.test.js` (27 tests, all pass)

Covers, among others: receipt precedes ack; receipt written before channel resolution; PSID stored only as a hash; fast ack; **503 on receipt persistence failure** and no message stored; duplicate → no second receipt/message/reply; concurrent duplicates idempotent; unique-race → duplicate; unknown Page → `IDENTITY_NOT_RESOLVED`, PII-free alert, no tenant assoc., delivered after reconnect, backoff advances, dead-letters on exhaustion; store failure → durable `RETRY_PENDING`, never PROCESSED, PII-free alert, retry succeeds exactly once, DLQ on exhaustion; echo/delivery events accounted-for-and-skipped with no retained payload; no message body / secret / key in logs; replay payload encrypted (`v1:` prefix), not plaintext.

Migration up→down→up verified against a real PostgreSQL 15 container (see `08_`).
