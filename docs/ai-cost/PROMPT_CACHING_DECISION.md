# Prompt Caching Decision

**Date** 2026-07-28 · **decision: DO NOT IMPLEMENT.** Measured saving on the current
configuration is **zero**, and the mechanism that would deliver it is unavailable on the
free Gemini project at any prompt size. Two defects in the existing attempt are fixed so
the code stops lying about what it does and stops paying for a doomed request on every
message.

---

## 1. What is actually cacheable

`buildSystemPrompt()` output for a realistic BD merchant, measured with `countTokens`:

| Block | Tokens | Stable across messages? |
|---|---|---|
| Tone/persona instructions (`TONE_PERSONA_INSTRUCTIONS.friendly_bd`) | ~640 | **Yes** — changes only when the merchant switches persona |
| Order-flow rules, forbidden phrases, language rules | included above | **Yes** |
| Business info: shop name, address, hours, socials | ~180 | **Yes** — changes on settings edit |
| Operating context: live payment/delivery facts | ~120 | **Mostly** — changes when the merchant connects bKash or a courier |
| Top-5 relevant FAQs | ~310 | **No** — selected per message by `getRelevantFaqs` |
| **Static subtotal** | **~940** | |
| Product grounding block (5 products) | ~500 | **No** — per query, and carries live price/stock |
| RAG knowledge chunks (4) | ~246 | **No** — per query |
| Conversation history (last 10 turns, verbatim) | 75–182 | **No** |
| Customer message | 6–59 | **No** |
| **Total input, expected turn** | **2,155** [M] | |

So roughly **44% of the input is genuinely static** — a real caching opportunity on paper.
Everything price-, stock-, cart- or customer-bearing is on the dynamic side, so a cache
would not risk staleness on the facts that matter.

## 2. Gemini explicit context caching — unavailable

`cachedContents` POST, both production models, two prompt sizes, live [M]:

```
gemini-3.1-flash-lite   ~2,000 tok → 429  limit=0, requested=2003
gemini-3.1-flash-lite   ~6,000 tok → 429  limit=0, requested=6003
gemini-3.1-pro-preview  ~2,000 tok → 429  limit=0, requested=2003
gemini-3.1-pro-preview  ~6,000 tok → 429  limit=0, requested=6003
```

The quota is `TotalCachedContentStorageTokensPerModel-FreeTier` with **`limit=0`**. Explicit
caching is not "too small" or "too expensive" on this key — it is **switched off entirely**.
Size is irrelevant, so raising the prompt above any minimum would not help.

## 3. Gemini implicit caching — does not engage

Three sequential `generateContent` calls sharing an identical ~2,000-token system prefix,
2.5 s apart, on `gemini-3.1-flash-lite` [M]:

| Call | `promptTokenCount` | `cachedContentTokenCount` |
|---|---|---|
| 1 | 2,087 | absent |
| 2 | 2,086 | absent |
| 3 | 2,087 | absent |

No cached-token field appears on any call. Every request bills the full prefix.
**Measured saving from Gemini caching, explicit or implicit: 0%.**

## 4. OpenAI fallback — caching *does* engage

For completeness, since the fallback tier is now `gpt-4.1-mini`: a warm repeat reported
`cached_tokens: 1920` of `prompt_tokens: 2125` — a **90% prefix hit**, taking the message
from $0.001089 to **$0.000402**, i.e. *below* the Gemini primary [M]. This needs no code:
OpenAI's prompt caching is automatic on identical prefixes. It is one input to the routing
decision in [GEMINI_FIRST_ROUTING.md](GEMINI_FIRST_ROUTING.md), not a caching feature to
build.

## 5. Defects fixed in the existing attempt

`gemini-cache.service.js` was already wired into the reply path
(`intent-router.service.js:461`, `getOrCreate(shopId, systemPrompt)`), and could never have
worked:

**A cache bound to a model that is not in the chain.** `getOrCreate` defaulted to
`process.env.LLM_DEFAULT_MODEL_GEMINI || 'gemini-2.0-flash'` — a model **retired
2026-06-01**, and no `LLM_DEFAULT_MODEL_GEMINI` is rendered into production. A
`cachedContents` handle is bound to exactly one model and is unusable by a
`generateContent` call on another, so even on a paid key with caching enabled this would
have produced zero hits while looking fully wired up. Now defaults to the model that
actually serves the request. Guarded by a test.

**One doomed HTTP request per customer message.** With the 429 never cached, `getOrCreate`
retried on every message: Redis miss → POST → 429 → `console.warn` → `null`. That is an
extra provider round-trip on the critical path of every reply, plus a warn line per
message. Now a 429 or 403 sets `gemini_cache:unavailable` for 15 minutes
(`GEMINI_CACHE_BACKOFF_SECONDS`) and the attempt is skipped. This is a **latency and log
fix, not a cost fix** — the failed request was never billed.

The service is retained rather than deleted: the invalidation logic (`_promptHash` in the
Redis key, so a changed FAQ or persona produces a different key automatically) is correct
and is the part that would be tedious to rebuild.

## 6. What would have to be true to revisit

Re-test after the paid-key migration ([GEMINI_FREE_TIER_CAPACITY.md](GEMINI_FREE_TIER_CAPACITY.md) §6):

1. `cachedContents` POST returns 200 instead of `limit=0`.
2. The static prefix clears the model's minimum. The static block is ~940 tokens; if the
   minimum is 4,096 (as the API reported for an older model during the previous audit), it
   does **not** clear it and explicit caching stays unavailable regardless of billing.
3. `generateContent` with `cachedContent` set actually reports `cachedContentTokenCount`.
   This must be *verified*, not assumed — the whole point of this document is that the
   previous implementation assumed it.

Then the arithmetic: caching ~940 of 2,155 input tokens at the cached-input rate
($0.025/M vs $0.25/M) saves ~$0.00021 per message ≈ **$0.0021 per conversation**, roughly
**34%** of the $0.006143 total — a genuinely worthwhile saving, but only once step 1 and 2
are true. Against it: cache-write cost, `$1/M token-hour` storage, and one extra API call
per shop per hour.

**Recommendation: revisit only after the paid key is live, and only if step 2 passes.**
Until then the honest position is that the cheapest prompt is a smaller prompt — see the
optimisation backlog, where trimming the 640-token persona block and the 50-FAQ image-path
dump are both larger, unconditional wins that need no provider feature.

## 7. Tenant isolation and invalidation (verified, unchanged)

Although caching is not enabled, the existing key design was reviewed against the brief's
requirements, since it will be the basis of any future attempt:

| Requirement | Status |
|---|---|
| Cache key includes the shop id | ✅ `gemini_cache:{shopId}:{promptHash}` |
| One shop's context cannot leak to another | ✅ shop id is in the key; `getOrCreate` is called with the shop's own prompt |
| Prompt-version changes invalidate | ✅ the key contains an MD5 of the full prompt text, so any change to persona, FAQs, business info or operating context yields a different key |
| Shop-setting changes invalidate | ✅ same mechanism, plus an explicit `invalidate(shopId)` that deletes by pattern |
| Tool-schema changes invalidate | n/a — no tool definitions are sent |
| Never caches a complete response for reuse across customers | ✅ only `systemInstruction` is cached |
| Redis TTL sits below the Gemini TTL | ✅ `GEMINI_CACHE_TTL - 120 s`, so the handle is recreated before it expires server-side |
| Reversible | ✅ returns `null` on any failure and the caller sends the full prompt |

The separate `intentCache` exact-match response cache (`normalisedKey(shopId, message)`,
30 min TTL) **does** reuse a complete response — but only for a byte-identical message
within the same shop, which is the intended behaviour for repeated "delivery charge koto?"
questions. It is keyed by shop id, so there is no cross-tenant exposure. Worth noting that
it will serve a stale *price* for 30 minutes if a merchant edits a product mid-window; that
is a pre-existing behaviour, not introduced here, and is logged in the backlog.
