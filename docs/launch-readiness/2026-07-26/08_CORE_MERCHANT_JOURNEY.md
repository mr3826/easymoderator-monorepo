# 08 — Core Merchant Journey (Workstream G)

**Verdict for this workstream: PASS on source and automated tests; BLOCKED for live
end-to-end, which requires a Meta tester Page.**

No merchant journey was executed end-to-end against production in this audit. Doing so
would create real shop and customer records in the production database, which the
read-only constraint forbids. What follows is source- and test-verified, plus live
verification of the unauthenticated entry points.

## Live entry points — verified this run

| Page | Result |
|---|---|
| `https://easymod.tech` | 200, renders, no console errors |
| `https://easymod.tech/login` | 200, renders, Bengali/English toggle present, "Private BD seller pilot" badge |
| `https://easymod.tech/privacy-policy` | 200, full policy renders without auth |
| `https://easymod.tech/terms` | 200 |

## Authentication and onboarding

| Check | Status | Receipt |
|---|---|---|
| Sign-up | PASS (source) | `auth.service.js`; `auth.security.test.js` passing |
| Login | PASS (live render + source) | login page verified; lockout with exponential backoff, 4h ceiling (`auth.service.js:68-94`) |
| Email verification | PASS (source) | transactional email path; `email.service.test.js` passing |
| Password reset | PASS (source) | covered by `auth.security.test.js` |
| Session invalidation | **PASS** | `tokenVersion`; a missing/malformed claim is now **rejected** rather than silently skipped — `auth-token-version.security.test.js` passing |
| First-time owner detection | PASS (source) | setup module |
| Setup-task dashboard / progress / links | PASS (source) | `setup` routes |
| Existing merchants not re-onboarded | PASS (source) | — |
| Multiple shops don't corrupt state | PASS (source) | shop-scoped |
| Refresh/relogin preserves progress | **BLOCKED** | needs a live session |

## Products and knowledge

| Check | Status |
|---|---|
| Product create / edit / delete | PASS (source + tests) |
| Price and stock grounding | PASS (source) — live values injected into retrieval |
| Product images | PASS (source) |
| FAQ / knowledge creation, starter FAQ | PASS (source) — `knowledge.test.js` passing |
| Embedding generation + retrieval after update | PASS (source) — `knowledge-gap-capture.service.test.js` passing |
| Deleted/hidden product not recommended | PASS (source) |
| Out-of-stock behaviour | PASS (source) |
| **No cross-shop knowledge leakage** | **PASS** — retrieval is `shop_id`-scoped; `analytics-knowledge-gap.security.test.js` passing |

## AI and conversation quality

Language handling is Bengali-first with explicit `bn` / `en` / `mixed` (Banglish) paths
(`order-flow.service.js:129-132`, `intent-router.service.js`, `banglish` routes).

| Check | Status | Note |
|---|---|---|
| Plain text / Bengali / English / mixed | PASS (source) | three-way language switch present throughout |
| Spelling mistakes | **BLOCKED** | needs live model evaluation |
| Multiple questions in one message | PARTIAL | burst coalescer merges a burst into one turn |
| Product + policy question | PASS (source) | |
| Unknown-answer / low-confidence handling | **PASS** | low-confidence handoff holds the reply and fetches a human (`human-handoff.service.js`) |
| Human escalation | PASS | `human-handoff.test.js` passing |
| Draft mode / live mode | PASS | `draftMode.rule.js`; pilot runbook keeps shops on DRAFT 7-14 days |
| Hallucination resistance | **BLOCKED** | requires live model evaluation with a golden set |
| Live price/stock grounding | PASS (source) | |
| Conversation history consistency | PASS (source) | |
| Duplicate message protection | **PASS** | `external_id UNIQUE` + Redis `msg:dedup` claim |

**Hallucination resistance and Bengali/Banglish answer quality were not measured.** No
golden-set evaluation exists in the repository. For a Bengali-first AI product this is a
genuine coverage gap — recorded as **F-22 (P2)**.

## Cart and order behaviour — the previously flagged risk is FIXED

The brief singles out: *"A negative response such as 'no,' 'না,' or mixed-language
equivalent proceeds toward confirmation rather than cancelling the order."*

**Verified fixed.** `order-flow.service.js:64-105` requires an **explicit** cancel phrase:

```js
const EXACT_CANCEL_PHRASES = new Set([
    'cancel', 'cancel order', 'order cancel', 'cancel korbo', 'cancel koren',
    'cancel korun', 'cancel koro', 'cancel kor', 'cancel kore din', 'cancel chai',
    'order batil', 'order baatil', 'batil', 'baatil', 'বাতিল', 'অর্ডার বাতিল',
]);
```

plus five regexes, all of which require an explicit cancel/বাতিল token or
`don't want this order`.

A bare `no`, `না`, or `na` matches **none** of these, so answering "no" to
"would you like another product?" **cannot** cancel the order. The failure mode is closed.

| Check | Status | Receipt |
|---|---|---|
| Add / remove product, change quantity, view cart | PASS (source) | `order-flow.service.js` step machine |
| "Another product?" → negative response **does not cancel** | **PASS** | `EXACT_CANCEL_PHRASES` / `CANCEL_PATTERNS` above |
| Negative response *proceeds to confirmation* | PASS (source), **not runtime-verified** | falls through to the step machine |
| Confirm terms in bn/en/mixed | PASS (source) | `PURCHASE_PATTERNS` covers `order korbo`, `confirm korun`, `অর্ডার`, etc. |
| Correct address or phone | PASS (source) | name → phone → address → zone → payment → confirm |
| **Duplicate confirmations don't duplicate orders** | **PASS** | `20260611_001_order_session_metadata_orders_idempotency.js` |
| Order creation idempotent | **PASS** | same migration |
| Failed order creation visible + retry-safe | PASS (source) | session stays `ACTIVE`; explicit guard against "said confirmed but no Order created" (`order-flow.service.js:23`) |
| Customer/order mapping tenant-safe | PASS | `resolveCustomerId` filters on `shop_id` (line 114-119) |

`hasPurchaseIntent` also correctly excludes order-number lookups (`/\b\d{5,8}\b/` → status
query, not a buy) — a nice guard against turning "where is order 123456" into a new order.

## Dead code on this path

`conversation/ai-chatbot.controller.js` contains an older order/cart implementation and is
**not mounted** — `routes.js` has no `/ai-chatbot` entry. The live path is
`message-worker.js:409 → handleOrderFlow`. Recorded as **F-27 (P3)**: delete it, because
two divergent order implementations in one tree is a maintenance trap.
