# Data Deletion Flow

**App:** EasyModerator
**Last updated:** 2026-07-28 (rewritten — the previous version described the
pre-Phase-1 implementation and was wrong in every material detail)
**Route:** `EasyMod-backend/src/modules/integration/meta-webhook-gdpr.handler.js`
**Logic:** `EasyMod-backend/src/modules/integration/meta-compliance.service.js`

This is the file to answer a **Data Protection Assessment** from. Do not
paraphrase it from memory — the details below are what the code actually does.

---

## Overview

When a user removes EasyModerator from their Facebook App Settings, Meta sends
a signed POST to the Data Deletion Request Callback. The handler validates the
signature, resolves the Meta identity to local customer records, runs the
deletion in one database transaction, cleans up file attachments, and returns an
opaque confirmation code plus a status URL the user can poll.

## Flow

```
Meta Platform
     |
| POST /webhooks/meta/data-deletion
     | body: signed_request=<sig>.<payload>
     v
meta-webhook-gdpr.handler.js
     |
     |-- 1. Validate signed_request
     |       HMAC-SHA256(payload, META_APP_SECRET), crypto.timingSafeEqual
     |       algorithm must be HMAC-SHA256; user_id must be a string
     |       issued_at must be <= 5 min in the future and <= 24 h old
     |       missing  -> 400   invalid/expired -> 403   no app secret -> 503
     |
     v
meta-compliance.service.processDeletionRequest()
     |
     |-- 2. Durable request record (meta_data_deletion_requests)
     |       keyed by a fingerprint of the signed_request
     |       stores identity_hash and confirmation_code_hash — never the raw ID
     |       status: PENDING -> PROCESSING -> COMPLETED
     |                             |-> FAILED
     |                             |-> IDENTITY_NOT_RESOLVED
     |       a repeated callback returns the same code without re-deleting
     |       a PROCESSING row older than the stale window is re-claimed
     |
     |-- 3. Resolve identity  (this is the part that used to be broken)
     |       Meta's signed_request carries an APP-scoped user ID.
     |       Customers are stored against PAGE-scoped IDs (PSIDs).
     |       meta_user_identities maps app_scoped_user_id -> page_scoped_user_id.
     |       If no usable mapping exists the request is parked as
     |       IDENTITY_NOT_RESOLVED with retryable: true — it is NOT silently
     |       reported as a successful deletion.
     |
     |-- 4. Delete, in one transaction, per matched customer
     |
     |-- 5. Clean up server-owned attachment files (outside the transaction)
     |
     v
200 { "url": "https://api.easymod.tech/webhooks/meta/data-deletion/status/<code>",
      "confirmation_code": "<opaque>" }
```

## What step 4 actually does

| Data | Treatment | Why |
|---|---|---|
| `conversations` | **Deleted** | Conversation history belongs to the customer |
| `messages` | **Deleted** with their conversations | Children of conversations |
| `customers` | **Deleted** (`individualHooks: true`, so PII-nullifying hooks run) | The subject record |
| `customer_preferences` | **Deleted** | Customer-specific |
| `customer_delivery_stats` | **Deleted** by phone | Customer-specific |
| `order_sessions`, `order_returns`, `support_tickets` | **Deleted** | Customer-specific |
| `orders` | **Anonymised, not deleted** — `customer_id` nulled, `customer_name` set to "Deleted customer", phone/address/area/zone/consignment/tracking/notes/idempotency key nulled, plus `courier_data`, `tracking_id`, `metadata` | Financial and accounting records must survive under Bangladesh law; every personal field in them is scrubbed |
| Order invoices (files) | Scrubbed; paths queued for file deletion | PII in generated documents |
| `trx_id_logs` | `sender_phone` and `ocr_raw` nulled | Payment-proof PII |
| `payment_transactions` | `gateway_response` nulled | May embed customer details |
| Delivery tracking | Scrubbed | Courier payloads carry addresses |
| Owner notifications referencing the orders | Scrubbed | PII leaks through notification text |
| Audit records | Scrubbed of customer/order PII, **rows retained** | Compliance trail survives; PII does not |
| `meta_channel_consent_events` | Retained, `customer_id` cleared | Consent audit must survive the deletion |

Attachment files owned by the server are collected during the transaction, then
deleted afterwards. If any file cannot be removed, the request is marked
`FAILED` with `ATTACHMENT_CLEANUP_FAILED` and its remaining paths are stored, so
a retry resumes **only** the file phase rather than re-running the database work.

## Key properties

**Fails closed.** No signature, expired signature, wrong algorithm, or missing
`META_APP_SECRET` → 4xx/503 before any data is touched. Verified on production
2026-07-28: `POST` with no `signed_request` → `400 {"error":"Missing signed_request"}`.

**No success theatre.** If the identity cannot be resolved, the callback is
acknowledged with an opaque status code but the durable row is
`IDENTITY_NOT_RESOLVED`, `retryable: true`, and no customer data is touched.
The status endpoint is the source of truth; a callback acknowledgment is not a
claim that deletion completed. If the transaction fails, the endpoint returns
500 with "the request is recorded for retry" and leaves the row retryable.

**No raw identifiers at rest.** The durable record stores an HMAC
`identity_hash` and a `confirmation_code_hash`, never the Meta user ID or the
plaintext confirmation code.

**Idempotent.** Keyed on a fingerprint of the signed request. A repeat returns
the original confirmation code and performs no further deletion.

**Status is user-checkable.** `GET /webhooks/meta/data-deletion/status/:code`
returns status, counts (`matched_customers`, `conversations_deleted`,
`messages_deleted`, `orders_anonymized`, `attachments_deleted`), `completed_at`,
`retryable`, and `failure_code`. Unknown code → 404.

`GET /webhooks/meta/data-deletion` (no code) returns human-readable
instructions and the contact address `privacy@easymod.tech`, for users who
arrive at the URL directly.

## Deauthorize callback

`POST /webhooks/meta/deauthorize` is separate — it fires when a user revokes
access without requesting deletion. Same signed-request validation, then
`meta-authorization-recovery.processDeauthorization(user_id)`. Data is **not**
deleted; the authorization state is. The route is POST-only, so a `GET` returns
404 by design.

## Registration

| Dashboard field | Value |
|---|---|
| App Settings → Advanced → Data Deletion Request Callback URL | `https://api.easymod.tech/webhooks/meta/data-deletion` |
| App Settings → Advanced → Deauthorize Callback URL | `https://api.easymod.tech/webhooks/meta/deauthorize` |

Apex domain only — `www.easymod.tech` 301-redirects, and Meta treats a redirect
on a callback URL as a misconfiguration.
