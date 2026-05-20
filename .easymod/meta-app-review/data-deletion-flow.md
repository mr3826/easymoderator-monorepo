# Data Deletion Flow

**App:** Easy Moderator
**Last updated:** 2026-05-20
**Handler:** `EasyMod-backend/src/modules/integration/meta-webhook-gdpr.handler.js`

---

## Overview

When a user removes Easy Moderator from their Facebook App Settings, Meta sends a signed POST to our Data Deletion Request Callback. The handler verifies the signature, runs the deletion cascade, and returns a confirmation code.

---

## Flow Diagram

```
Meta Platform
     |
     | POST /webhooks/meta/data-deletion
     | body: signed_request=<base64url-encoded-signed-payload>
     |
     v
meta-webhook-gdpr.handler.js
     |
     |-- 1. Parse signed_request
     |       Split on '.' → [encodedSig, encodedPayload]
     |       HMAC-SHA256(encodedPayload, META_WEBHOOK_APP_SECRET)
     |       crypto.timingSafeEqual(sig, expectedSig)
     |       If mismatch → 403 "Invalid signed_request signature"
     |
     |-- 2. Extract facebook_user_id from decoded payload
     |
     |-- 3. Idempotency check (Redis NX, 24h TTL)
     |       Key: gdpr:processed:deletion:{userId}:{YYYY-MM-DD}
     |       If already processed today → return 200 + same confirmation_code (skip re-deletion)
     |       Falls back to in-process Map if Redis is unavailable
     |
     |-- 4. Customer.destroy (25s timeout guard)
     |       WHERE channel_user_id = facebook_user_id
     |         AND channel_type IN ('messenger', 'instagram')
     |
     |       Sequelize CASCADE on Customer:
     |         → conversations.customer_id       (CASCADE DELETE)
     |         → orders.customer_id              (CASCADE DELETE or SET NULL — per FK definition)
     |         → policy_decisions.customer_id    (SET NULL — audit row preserved, PII removed)
     |         → meta_channel_consent_events.customer_id (SET NULL — consent audit preserved)
     |
     |       hooks.beforeDestroy nullifies PII fields before DELETE:
     |         customer.phone = null
     |         customer.email = null
     |         customer.name  = null
     |
     |-- 5. Return 200
     |       { url: "https://www.easymod.tech/privacy-policy",
     |         confirmation_code: "DEL-{userId}-{timestamp}" }
     |
     v
Meta Platform receives 200 + confirmation_code
User can verify deletion status at the privacy-policy URL
```

---

## Key Properties

### Signature Verification

The handler uses `crypto.timingSafeEqual` to compare the HMAC-SHA256 signature against the `META_WEBHOOK_APP_SECRET` environment variable. A missing or invalid signature returns 403 before any data is touched.

### Idempotency

Redis key with 24-hour TTL prevents double-deletion if Meta retries the callback. Falls back to an in-process Map if Redis is unavailable, maintaining idempotency within a single process lifecycle.

### Cascade Behaviour

| Child Table | FK Behaviour | Why |
|-------------|--------------|-----|
| `conversations` | CASCADE DELETE | Conversation history belongs to the customer |
| `messages` | CASCADE DELETE (via conversations) | Messages are children of conversations |
| `orders` | CASCADE DELETE | Orders are tied to the customer identity |
| `policy_decisions` | SET NULL on `customer_id` | Audit trail preserved for compliance; PII removed |
| `meta_channel_consent_events` | SET NULL on `customer_id` | Consent audit preserved; PII removed |

### PII Nullification

The `Customer` model's `beforeDestroy` hook sets `phone`, `email`, and `name` to `null` before the row is deleted. This ensures that even if a cascade FK references the customer row during deletion, the PII fields are already cleared.

### Timeout Guard

A 25-second `Promise.race` timeout prevents the deletion from blocking the HTTP response indefinitely. If deletion times out, the error is logged and the 200 response is still returned (Meta's spec requires a 200 even if deletion is deferred). The deletion is re-attempted on the next retry from Meta.

### Deauthorize Callback

A separate `POST /webhooks/meta/deauthorize` endpoint handles the Meta Deauthorize Callback (when a user revokes the app's access token but does not trigger full data deletion). This marks the customer record with `metadata.deauthorized = true` without deleting the record.

---

## Registration

The callback URL must be registered in the Meta App Dashboard under:
**App Settings > Advanced > Data Deletion Request Callback URL**

Value: `https://api.easymod.tech/webhooks/meta/data-deletion`

The deauthorize URL:
**App Settings > Advanced > Deauthorize Callback URL**

Value: `https://api.easymod.tech/webhooks/meta/deauthorize`
