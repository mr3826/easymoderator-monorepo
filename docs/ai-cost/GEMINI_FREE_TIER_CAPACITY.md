# Gemini Free-Tier Capacity

**Date** 2026-07-28 · all limits below are **[M] measured against the live API** with the
key currently in the `GOOGLE_GEMINI_API_KEY` secret's dev counterpart, not read from
documentation.

**Headline:** the free tier's binding constraint is **not cost — it is 15 requests per
minute, project-wide**. Cost during the free period is effectively zero. The failure mode
when the limit is hit is a *silent shift of traffic onto paid OpenAI*, not an outage.

---

## 1. Secret plumbing (validated)

| Step | Value | Class |
|---|---|---|
| GitHub secret name | `GOOGLE_GEMINI_API_KEY` (exists; `GEMINI_API_KEY` does **not**) | [M] `gh secret list` |
| Workflow mapping | `ci-cd.yml:269` — `GEMINI_API_KEY: ${{ secrets.GOOGLE_GEMINI_API_KEY }}` | [C] |
| Rendered into `.env.prod` | `render-production-env.js` writes **both** `GEMINI_API_KEY` and `GOOGLE_GEMINI_API_KEY`, both from `source.GEMINI_API_KEY` | [C] |
| Read by the app | `llm.service.js` and `gemini-cache.service.js` read `GEMINI_API_KEY` | [C] |

The mapping is **correct**. This was worth verifying: the workflow env var and the secret
have different names, and had the workflow not renamed it, `render-production-env.js` would
have written two empty strings and Gemini would have been entirely non-functional in
production with every message silently served by OpenAI. It does rename it. No action.

`LLM_GEMINI_LITE_MODEL`, `LLM_GEMINI_PRO_MODEL` and `LLM_OPENAI_MODEL` are **not** in the
rendered key list and no such secrets exist, so production runs the `llm.service.js` code
defaults. The repo's `.env.prod` sets the retired `gemini-2.0-flash-lite`; that file does
not reach the droplet, but it remains a live footgun for anyone who copies it.

## 2. Measured limits

| Quota | Model | Limit | Evidence |
|---|---|---|---|
| `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` | `gemini-3.1-flash-lite` | **15 / min** | burst of 30 parallel calls → 17 ok, 13 × HTTP 429 naming this quota with `limit=15` |
| `GenerateContentInputTokensPerModelPerDay-FreeTier` | `gemini-3.1-pro-preview` | **0** | 8/8 calls returned 429 with `limit=0` |
| cached-content storage | both models | **0** | `cachedContents` POST → 429 `limit=0, requested=2003` and `requested=6003` |
| embedding RPM | `gemini-embedding-001` | rate-limited per minute; **≥ 80/min** sustainable | an unthrottled sweep 429'd mid-run; a 750 ms inter-call gap completed 122 calls cleanly |
| daily request/token cap | `gemini-3.1-flash-lite` | **not measured** | would require deliberately exhausting it |

Three consequences fall straight out of this table:

1. **`gemini-3.1-pro-preview` cannot serve a single request on this key.** It is not
   throttled — it is unavailable. It was tier 2 of the automatic failover chain, so every
   Gemini failure paid a doomed round-trip before reaching OpenAI. Removed from the
   automatic chain; see [GEMINI_FIRST_ROUTING.md](GEMINI_FIRST_ROUTING.md).
2. **Explicit context caching is impossible**, at any prompt size. See
   [PROMPT_CACHING_DECISION.md](PROMPT_CACHING_DECISION.md).
3. **15 RPM is shared by every merchant on the platform.** It is a per-project quota, not
   per-key-per-merchant.

## 3. Capacity model

Inputs — the first is measured, the rest are stated assumptions:

| Input | Value | Class |
|---|---|---|
| Gemini requests per expected 20-message conversation | **14** (10 chat/FAQ turns + 4 sentiment calls) | [M] `AI_COST_MODEL.json` |
| Conversations per merchant per month | 350 (GROWTH cap + grace) | [C] |
| Active hours per day | 12 | [A] |
| Share of daily volume in the peak hour | 25% | [A] BD f-commerce is evening-heavy |
| Duration of one active conversation | ~4 min | [A] |

Peak-hour load per merchant:

```
(350 / 30 days) × 0.25 × 14 requests ÷ 60 min  =  0.68 requests/min
```

| Merchants | Peak-hour mean RPM | vs 15 RPM limit | What the merchant sees |
|---|---|---|---|
| **10 pilot** | 6.8 | 45% | occasional 429 on evening bursts → those replies come from OpenAI |
| **22** | 15.0 | **100%** | free tier saturated *on average* at peak |
| **50** | 34.1 | 227% | most peak traffic served by OpenAI |
| **100** | 68.2 | 455% | free tier covers ~1 request in 5 at peak |

Heavy merchants (long messages, full history, more retrieval) generate the same *request
count* — 13 vs 14 — so heaviness moves cost, not capacity. Capacity scales with
**message volume**, and only message volume.

**A second, tighter constraint: concurrency.** One active conversation issues ~14 requests
over ~4 minutes ≈ **3.5 RPM**. So 15 RPM is roughly **4 simultaneously-active
conversations**, platform-wide, regardless of merchant count. Because arrivals are bursty
rather than smooth, throttling starts well before the averages in the table above suggest:
at 10 merchants the mean peak concurrency is ≈2, and a Poisson tail puts ~5% of peak-hour
minutes over the limit.

### When the free project becomes insufficient

- **≤ 10 merchants** — adequate. Expect a handful of 429s per evening, absorbed by the
  OpenAI fallback at a few US cents per month.
- **10–20 merchants** — degrading. A rising share of peak-hour replies is served by
  OpenAI. Still cheap, but Gemini-first is no longer true in practice at peak.
- **> 20 merchants** — **insufficient.** The free project is saturated at peak and OpenAI
  becomes the de facto primary provider during the hours that matter most.

**Recommended trigger to migrate: 10 paying merchants, or the first evening on which
Gemini 429s exceed 5% of replies — whichever comes first.** Migrating early costs nothing
(pay-as-you-go bills only what is used); migrating late means paying OpenAI's higher rate
for traffic Gemini would have served more cheaply, and losing the latency of a
flash-class model.

## 4. Quota exhaustion behaviour (validated)

Traced and unit-tested in `gemini-first-routing.test.js` §B:

| Question | Answer | Class |
|---|---|---|
| Does a 429 trigger the OpenAI fallback? | **Yes.** `callGemini` throws on any non-OK status; `chat()` catches and advances to the next provider. | [M] test |
| Is the customer ever shown an error? | Only if OpenAI *also* fails, which throws `All LLM providers failed`. | [M] test |
| Do retries hammer Gemini before falling back? | **No.** There is no retry loop inside `callGemini`; one attempt per provider per message. | [C] |
| Does the circuit breaker protect us? | **Yes.** 3 consecutive failures open the `gemini-lite` circuit for 300 s, after which calls skip Gemini entirely and go straight to OpenAI. Auto-resets. | [C] + [M] test |
| Added latency during exhaustion? | One failed Gemini round-trip (~100–300 ms) per message until the breaker opens, then none. Previously **two**, because the unavailable `gemini-pro` sat in between. | [M] |

The breaker is the right shape here, and it makes the sustained-exhaustion case cheap:
after 3 failures the platform stops trying Gemini for 5 minutes instead of paying a wasted
round-trip on every message.

> **Gap worth knowing about.** The breaker is keyed per provider name, not per shop, and
> quota is a *project*-level resource — so one busy minute opens the circuit for every
> merchant at once. That is arguably correct for a shared quota, but it means a single
> merchant's burst can push the whole platform onto OpenAI for 5 minutes. Not changed
> here; noted in the backlog.

## 5. Cost during the free period

Gemini flash-lite requests inside the 15 RPM window bill **$0**. Local n-gram embeddings
bill $0. So free-period AI cost is *only* the OpenAI fallback share:

| Throttled / failed share of turns | AI cost per conversation | 350 conversations/month |
|---|---|---|
| 0% | $0.000000 · ৳0.00 | $0.00 · ৳0 |
| 5% | $0.000762 · ৳0.094 | $0.267 · ৳33 |
| 10% | $0.001525 · ৳0.188 | $0.534 · ৳66 |
| 25% | $0.003812 · ৳0.470 | $1.334 · ৳165 |

Basis: 14 turns per conversation, an OpenAI fallback turn measured at **$0.001089**
(cold cache; a warm OpenAI prompt cache measured $0.000402). Compare the paid-Gemini
figure of **$0.006143 / ৳0.758** per expected conversation in
[AI_COST_AUDIT.md](AI_COST_AUDIT.md).

**Do not read the free-period numbers as the business's unit economics.** They are a
promotional credit in the sense the brief means: real economics are the paid-Gemini
column, and every plan and top-up decision should be taken against that.

## 6. Paid-key migration path

No source change is required. `GEMINI_API_KEY` is the only variable involved and its name
does not change.

1. Create a Google Cloud project with billing enabled; enable the Generative Language API;
   create an API key restricted to it.
2. Set a **budget alert** on the billing account before the key is used — $10/month is
   ample headroom against the modelled $2.24/merchant/month at 350 conversations.
3. Update the GitHub secret: `gh secret set GOOGLE_GEMINI_API_KEY`. No other secret, no
   workflow edit, no code edit.
4. Redeploy (the secret is only read at `.env.prod` render time, so a redeploy is
   required).
5. **Verify** — all four should now behave differently:
   - `GET /health` returns the new commit;
   - a test message gets a reply with `provider: 'gemini-lite'`;
   - a burst of 30 requests no longer 429s at 15;
   - `gemini-3.1-pro-preview` answers instead of returning `limit=0`.
6. **Then re-evaluate two decisions that were made *because* the key is free:**
   - `LLM_AUTO_ESCALATE_TO_PRO` — worth reconsidering once `gemini-pro` can actually serve
     (though at ~8× the cost it should be escalation-only, not a retry tier);
   - prompt caching — explicit `cachedContents` becomes possible;
     [PROMPT_CACHING_DECISION.md](PROMPT_CACHING_DECISION.md) §5 has the re-test.

**Rollback:** set the secret back to the free-project key and redeploy. Nothing else
changes, and no data is written that depends on which key produced it. Rollback loses the
`gemini-pro` tier again, which the automatic chain no longer depends on.

**Do not** create or purchase the key as part of this work — that is a founder action with
a billing consequence.
