# 04 — PAYMENT_ENCRYPTION_KEY Compatibility (F-01)

## The hazard

`src/modules/payment/payment-config.entity.js` derives the AES-256-CBC key as:

```js
/^[a-f0-9]{64}$/i.test(v) ? Buffer.from(v, 'hex') : crypto.createHash('sha256').update(v).digest();
```

The production `PAYMENT_ENCRYPTION_KEY` is **not** 64 hex characters, so the effective key today is `sha256(value)`. The production validator, however, requires `/^[a-f0-9]{64}$/`. That mismatch is why the preflight reported `invalid: PAYMENT_ENCRYPTION_KEY`.

The dangerous "fix" is to set a fresh 64-hex key: it passes the validator but silently changes the derived key. AES-256-CBC has no authentication tag, so every stored merchant credential would then decrypt to **garbage rather than an error** — an undetectable data-loss event.

## The fix — render-time normalization

`scripts/render-production-env.js` → `normalizePaymentEncryptionKey()`:

1. If the value already matches `^[a-f0-9]{64}$` → use it unchanged.
2. Otherwise → write `sha256(value)` (hex).

This writes the **exact same 32 bytes the runtime already derives**, so:
- The validator's `^[a-f0-9]{64}$` and its live `aes-256-gcm` key-exercise both pass.
- Every existing ciphertext still decrypts — nothing re-encrypts.
- The GitHub secret is never modified, never read into a report, never printed.
- In GitHub Actions the derived value is registered with the log scrubber via `::add-mask::` before use.

## Tests (`scripts/__tests__/render-production-env.test.js`)

| Case | Assertion |
|---|---|
| legacy non-hex value | rendered `PAYMENT_ENCRYPTION_KEY === sha256(value)`, matches `^[a-f0-9]{64}$` |
| raw legacy value | never appears in the rendered output |
| already-64-hex value | passes through unchanged (no double hashing) |
| digest vs runtime | `Buffer.from(normalized,'hex')` equals the runtime `getEncryptionKey()` derivation |
| missing key | preflight throws `/PAYMENT_ENCRYPTION_KEY/` |

All pass (see `08_TEST_AND_SECURITY_RECEIPTS.md`).

## Documented follow-up (NOT done in this task)

A true rotation (or migration off unauthenticated CBC) requires a decrypt-old / re-encrypt-new pass and a move to AES-256-GCM for payment credentials, matching the Meta-token cipher. This is post-launch work: it needs a maintenance window, a dual-read window, and a verified re-encryption of every `PaymentConfig.credentials` row. Until then, the normalization above preserves exact compatibility, and inherits whatever strength the current secret has.
