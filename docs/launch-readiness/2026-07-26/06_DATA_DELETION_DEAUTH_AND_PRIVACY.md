# 06 — Data Deletion, Deauthorization, Privacy and Security (Workstream E)

**Verdict for this workstream: PASS in code and in live production behaviour, with one
unverifiable operational precondition (identity-mapping coverage).**

## Security test suite receipt

```
npm run test:security
Test Suites: 24 passed, 24 total
Tests:       148 passed, 148 total
Time:        11.177 s
```

Exit code 0. Includes `meta-compliance.service.test.js`, `meta-gdpr-security.test.js`,
`auth-token-version.security.test.js`, `route-perimeter.test.js`,
`safe-media-fetch.test.js`, `delivery-tracking.tenant-and-replay.test.js`.

## Data deletion

| Requirement | Status | Receipt |
|---|---|---|
| Callback URL exists | PASS | `POST https://easymod.tech/api/webhooks/meta/data-deletion` → 400, live |
| Signed request validated | **PASS** | unsigned → `{"error":"Missing signed_request"}`; forged → `{"error":"Invalid signed_request signature"}` — live production |
| HMAC-SHA256 + age/skew bounds | PASS | `meta-compliance.service.js` |
| Tenant-safe | PASS | deletion is scoped through the resolved identity mapping |
| Truthful confirmation code + status URL | PASS | returned per Meta spec |
| Status can be checked | PASS | `GET /api/webhooks/meta/data-deletion` → 200 (status lookup) |
| Durable | PASS | `meta_data_deletion_requests` table, hashed identifiers |
| Retries idempotent | PASS | conditional claim; concurrent callers cannot both claim |
| Partial failures visible | PASS | stage checkpoints + counters |
| **No false `COMPLETED`** | **PASS** | see semantics below |
| Missing identity → durable unresolved state | **PASS** | `IDENTITY_NOT_RESOLVED` |
| No-data deletion distinguishable from unresolved | **PASS** | `COMPLETED` + zero counters ≠ `IDENTITY_NOT_RESOLVED` |
| Audit evidence | PASS | strict audit persistence required |
| Failure alerts PII-free | PASS | request-ID only |

### The three-state outcome model

This is the part most systems get wrong, and this one gets right:

- `COMPLETED` **with positive counters** — mapped retained records were deleted/anonymized.
- `COMPLETED` **with zero counters** — a legitimate mapping resolved, but no retained data existed.
- `IDENTITY_NOT_RESOLVED` — no legitimate mapping exists. Counters stay zero,
  `completed_at` stays null, **no** deletion-completed audit and **no** success metric are
  emitted, and operations receives a PII-free alert.

The signature is still validated and Meta still receives its required confirmation
code/status URL, so Meta's contract is satisfied without the system lying about what it
deleted.

### Fencing tokens

`processing_token` optimistic concurrency stops a superseded deletion worker from
publishing counters or a completion audit — a genuinely subtle correctness control.

### Retention-aware deletion

Customer conversations/messages are deleted; retained **orders are anonymized rather than
deleted**, preserving order number, amounts, payment status and delivery status for
financial-record obligations. Residual-PII sweep covers invoices, delivery tracking, trx
logs, gateway responses and audit payloads. Server-owned attachments are removed; remote
attachment references are correctly **not** treated as server-owned files.

## Deauthorization

| Requirement | Status | Receipt |
|---|---|---|
| Callback exists | PASS | `POST /api/webhooks/meta/deauthorize` → 400, live |
| Signed request validation | **PASS** | unsigned → `{"error":"Missing signed_request"}` — live |
| Channel access disabled | PASS | channel disabled, token cleared |
| Tokens not retained as active credentials | PASS | token cleared on deauthorization |
| Idempotent | PASS | conditional claim |
| Failures observable | PASS | owner + ops alert path |
| Other shops/Pages unaffected | PASS | scoped by resolved identity |

Queued work is drained and an unsubscribe is attempted.

## Security controls

| Control | Status | Evidence |
|---|---|---|
| Page tokens encrypted at rest | PASS | AES-256-GCM |
| Payment credentials encrypted at rest | PASS | AES-256-**CBC** — see hazard below |
| Sensitive values not logged | PASS | live error bodies carry no PII/secrets; secret-pattern scan on the PR range: 0 findings |
| AuthN/AuthZ boundaries | PASS | `route-perimeter.test.js` |
| Shop-level tenant isolation | PASS | `shop_id` bound only from the authenticated token; SSE no longer accepts a query-string `shop_id` |
| Admin authorization | PASS | platform-admin guard on `/api/admin/*` |
| Audit logging | PASS | `policy_decisions` always written; compliance audits required |
| CSRF/state in OAuth | PASS | state parameter + dedicated `CSRF_SECRET` (**not yet set in prod**) |
| Redirect allowlisting | PASS | `META_OAUTH_REDIRECT_URI` fixed server-side |
| **SSRF controls** | PASS | `safe-media-fetch.js`: DNS-pin, private-CIDR rejection, MIME allowlist, byte caps, **magic-byte validation**; payment screenshot OCR routed through it |
| File-upload validation | PASS | MIME + size + signature |
| Rate limiting | PASS | webhook + API limiters |
| Session invalidation | PASS | `tokenVersion`; a missing/malformed claim is now **rejected**, not skipped |
| Login lockout | PASS | exponential backoff, 4-hour ceiling |
| Dependency vulnerabilities | **BLOCKED (backend)** / 2 high (frontend) | see `10_` |
| Secret rotation status | **BLOCKED** | cannot be confirmed without reading values — correctly out of bounds |

### Live security-header evidence (production)

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://connect.facebook.net; ...
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=()
```

**F-31 (P3):** the frontend CSP `connect-src` allowlists `https://api.easymod.tech`, a
hostname that does not serve valid TLS and is not the canonical origin. Stale config;
harmless today because the SPA calls same-origin `/api`.

## F-01 (P0 hazard) — `PAYMENT_ENCRYPTION_KEY` rotation destroys existing credentials

`payment-config.entity.js:14-20`:

```js
const keyEnv = process.env.PAYMENT_ENCRYPTION_KEY;
if (keyEnv) {
    if (/^[a-f0-9]{64}$/i.test(keyEnv)) return Buffer.from(keyEnv, 'hex');
    else return crypto.createHash('sha256').update(keyEnv).digest();  // ← silent derivation
}
```

The production-config validator requires 64 hex characters. The current production value
is **not** 64 hex (that is exactly why the deploy preflight reports
`invalid: PAYMENT_ENCRYPTION_KEY`), so the runtime is today deriving the AES key via
`sha256(value)`. Payment credentials are stored **AES-256-CBC**, which has no
authentication tag — a wrong key yields garbage rather than a clean failure.

Setting a *fresh* random hex key to satisfy the validator **silently changes the AES key
and makes every existing `payment_configs` row permanently undecryptable.**

**The lossless migration** is to set the secret to the sha256 hex digest of the *current*
value — byte-identical to what the runtime already derives, and it satisfies the regex:

```bash
printf '%s' 'CURRENT_VALUE' | openssl dgst -sha256 -hex | awk '{print $NF}'
```

**Caveat, stated plainly:** if the current value is a weak placeholder, preserving it
trades security for decryptability. A true rotation requires a decrypt-with-old /
re-encrypt-with-new migration, which does not exist in this codebase.

This must be performed by the founder. It is listed as step 1 in
`18_FOUNDER_ACTION_CHECKLIST.md` because getting it wrong is unrecoverable.

## The one operational precondition that cannot be verified here

Launch gate 10 requires `GET /api/admin/meta-identity-readiness` to report
`connectedChannelsMissingMappings: 0`. That endpoint is platform-admin authenticated, and
this audit holds no admin token and must not obtain one. **BLOCKED** — founder must check
it. Channels connected before the identity-mapping work will need a legitimate
reconnect to capture a mapping; until then their deletion requests correctly resolve to
`IDENTITY_NOT_RESOLVED` rather than a false `COMPLETED`.
