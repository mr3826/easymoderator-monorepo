# AI Cost Optimization Backlog

**Date:** 2026-07-28 · Baseline: scenario B, **$0.008263 / ৳1.02 per conversation**
Savings are computed by `scripts/ai-cost/ai-cost-report.js` (`sensitivity` block in
[`AI_COST_MODEL.json`](AI_COST_MODEL.json)) by re-running the real scenario with one lever changed.

Read [`AI_COST_AUDIT.md`](AI_COST_AUDIT.md) §8 first. **AI is not the margin problem** — the expected
case already runs at 63% gross margin with break-even at 2.7× the plan cap. Nothing here is urgent on
cost grounds. Several items are worth doing anyway because they also fix correctness, and several
frequently-suggested optimizations are demonstrably **not worth doing** (§4).

---

## 1. Do before launch — because they are correctness bugs, not because of cost

### O-1 · Point the Gemini cache at the model that actually answers
**Current:** `intent-router.js:461` calls `geminiCache.getOrCreate(shopId, systemPrompt)` with no
model argument, so `gemini-cache.service.js:108` builds the cache for `gemini-2.0-flash` — retired
2026-06-01, and a different model from the one generating the reply. `gemini-cache.service.js:80`
swallows the resulting 400 and returns `null`. Prompt caching has therefore never worked.
**Proposed:** pass `GEMINI_LITE_MODEL` through, and stop treating a 400 as a silent skip — log it once
per model so the next dead-model regression is visible within a day rather than a quarter.
**Saving:** up to **40.6%** per conversation ($0.008263 → $0.004905) *if* the cache actually engages.
**Gated on two things beyond the code fix:** (a) the production project must be on a **paid** Gemini
tier — a live probe returned `429 TotalCachedContentStorageTokensPerModelFreeTier … limit=0` for the
key available to this audit; (b) a cacheable prefix must exceed the model's minimum. Verify (a) first;
without it this ticket delivers nothing.
**Risk:** low implementation, none to answer quality (identical bytes, cached). **Effort:** 1 h + verification.
**Do:** before launch — the diagnostic half (stop swallowing the error) regardless of (a).

### O-2 · Reorder the failover chain: `lite → gpt-4.1-mini → gemini-pro`
**Current:** `llm.service.js:166-170` escalates to `gemini-3.1-pro-preview`, which is **8.0×** the
primary. `gpt-4.1-mini` is **1.5×** and sits *behind* it.
**Proposed:** swap tiers 2 and 3. Also consider skipping `gemini-pro` entirely for the automatic
failover path — provider diversity is the point of a fallback, and a second Gemini model shares the
same outage blast radius that triggered the failover in the first place.
**Saving:** cuts the fallback uplift from $0.004613 to $0.000319 per fallback event — **93% of the
escalation cost**. At 25% fallback that is 4.0% of the whole conversation bill; during a Gemini
outage with the circuit breaker pinned open for 300 s it is the difference between 8× and 1.5× on
*every* message.
**Measured bonus:** `gpt-4.1-mini` reported a **90% automatic prompt-cache hit** on a repeated prompt
(`cached_tokens: 1920` of 2 125). A *sustained* failover — exactly the circuit-breaker scenario —
therefore warms into **$0.000402/turn, 39% cheaper than the Gemini primary**. Gemini's cache does not
engage at this prompt size at all, so the current tier-2 choice is the worst of both worlds.
**Risk:** low. `gpt-4.1-mini` already serves the product-vision path. **Quality risk:** low —
`gemini-pro` is stronger, but this is a degraded path, and the confidence gate still holds weak
answers. **Effort:** 15 min (reorder one array).
**Do:** before launch.

### O-3 · Cap or price `model_preset: 'advanced'`
**Current:** `ai-chatbot.controller.js:291` maps `advanced` → `gemini-pro` for **every** message. A
merchant on `advanced` costs ৳0.66/message ≈ ৳1,386/month at 350 conversations, against ৳999 revenue.
**Proposed:** either route `advanced` to `gemini-3.1-flash-lite` with a larger `maxTokens` budget, or
reserve `gemini-pro` for high-stakes turns (order confirmation, complaint handling) selected by the
existing `llm-tier-selection.service.js`, which is written and unused.
**Saving:** removes a **loss-making** configuration. **Risk:** medium — merchants who chose
"advanced" expect better answers. **Quality risk:** real; mitigate with selective routing rather than
a blanket downgrade. **Effort:** 2 h for selective routing.
**Do:** before launch, or disable the `advanced` preset until it is priced.

### O-4 · Fix `EMBEDDING_PROVIDER`
**Current:** every config artefact sets `gemini` or `google`; `resolveProvider()` accepts neither and
falls through to a character-bigram hash. RAG retrieval returns near-random matches.
**Proposed:** set the secret to `openai` (with the existing `OPENAI_API_KEY`), and make
`resolveProvider` **throw in production** on an unrecognised value instead of silently degrading.
**Cost:** **+$0.000002 per conversation** (+0.02%). This is not a cost optimization; it is a
correctness fix with a rounding-error price tag. **Risk:** low. **Quality risk:** strongly positive.
**Effort:** 30 min + a `reindex:qdrant` run.
**Do:** before launch.

### O-5 · Delete the dead model overrides from `.env.prod` / `.env.docker`
**Current:** both files set `LLM_GEMINI_LITE_MODEL=gemini-2.0-flash-lite` (shut down 2026-06-01) and
`LLM_GEMINI_PRO_MODEL=gemini-2.5-pro-preview-06-05`. CI does not render them, so production is
unaffected *today* — but any environment that loads those files sends 100% of traffic through two
dead models to `gpt-4.1-mini` after two wasted round-trips.
**Saving:** avoids a latent 1.5× cost-and-latency regression. **Risk:** none. **Effort:** 5 min.
**Do:** before launch.

---

## 2. Do after launch — real savings, low risk

### O-6 · Stop re-sending the image to the final call
**Current:** `intent-router.js:310` sends `imageUrls[0]` for attribute extraction, then
`intent-router.js:346` attaches **every** burst image again to the final reply call. The same bytes
are billed twice.
**Proposed:** when extraction succeeded and matched a product, pass the extracted attributes as text
and omit the image from the final call. Keep the image only when extraction returned `null` or found
no match — exactly the case where the model needs to see it.
**Saving:** **9.7%** per conversation ($0.008263 → $0.007465). On an image-heavy merchant, more.
**Risk:** low. **Quality risk:** low-to-moderate — the model loses direct sight of the product on the
turns where grounding already succeeded. Ship behind a flag and compare confidence scores.
**Effort:** 3 h.

### O-7 · Use the top-5 FAQ filter on the image path too
**Current:** `ai-chatbot.controller.js:267` sets `relevantFaqs = hasImages ? null : …`, and a `null`
means "dump up to 50 FAQs". Measured: system prompt 1 251 → 1 508 tokens on a 12-FAQ shop and
→ **2 554** on a 50-FAQ shop, on the turns that are already the most expensive.
**Proposed:** delete the `hasImages ?` ternary. The stated rationale ("image flow doesn't benefit") is
not supported — the FAQ selector keys off the customer's *text*, which image messages still carry.
**Saving:** **2.3%** on a 12-FAQ shop; ~9% on a 50-FAQ shop. **Risk:** very low. **Effort:** 10 min.

### O-8 · Drop the LLM sentiment tier, or fold it into the main call
**Current:** a separate `gemini-lite` call per >30-char message with no keyword hit, costing
$0.000111 (14.4% of a normal message).
**Proposed:** either rely on the keyword classifier alone, or have the main reply call return a
sentiment field alongside its answer — one call instead of two.
**Saving:** **5.4%** per conversation. **Risk:** low for the fold-in; medium for dropping it —
`shouldAutoEscalate` is a customer-experience guard, and losing nuanced Banglish frustration
detection means angry customers reach a bot instead of a human. **Prefer the fold-in.**
**Quality risk:** low if folded, real if dropped. **Effort:** 4 h (fold-in), 30 min (drop).

### O-9 · Only re-embed when the embedding text actually changed
**Current:** `product.service.js:311` re-embeds on every non-image update, including changes to
`quantity`, which is deliberately *excluded* from the embedding text.
**Proposed:** hash `buildEmbeddingText(product)` and skip the upsert when unchanged.
**Saving:** ~$0 today (local embeddings), $0.000002 per skipped write on OpenAI. **The real win is
Qdrant write pressure and latency, not money.** **Risk:** very low. **Effort:** 1 h.

### O-10 · Compress product images before the vision call — **OpenAI path only**
**Current:** `product-ai.service.js:66` forces `gpt-4.1-mini`, whose image tokens scale with
resolution: measured **2 493** tokens at 1080×1440 vs **429** at 512×512.
**Proposed:** downscale to ~512 px before the attribute-extraction call.
**Saving:** product-upload cost $0.001369 → $0.000543, a **60%** cut on that path. At 15 uploads/month
that is $0.012/merchant/month — real but tiny.
**Do not apply this to the customer-message path** (§4.1). **Risk:** low. **Quality risk:** low for
category/colour/material extraction; would matter for fine print or fabric texture.
**Effort:** 2 h (adds an image dependency — `sharp` is not currently installed).
**Prerequisite:** product image upload must exist first (audit F-7).

### O-11 · Cache query embeddings
**Current:** every text message that reaches `_callLlm` embeds the query fresh.
**Proposed:** Redis cache keyed on the normalised query. BD f-commerce is highly repetitive
("dam koto", "delivery charge koto").
**Saving:** ~$0 today; ~30–40% of the embedding line once O-4 lands, i.e. ~$0.0000008/conversation.
**Not worth engineering time for cost.** It does cut ~30 ms of latency per message.
**Risk:** low. **Effort:** 2 h. **Verdict: skip unless you want the latency.**

---

## 3. Not worth doing for cost, but track

### O-12 · Batch API for bulk re-embedding
50% discount, multi-hour SLA. Only the manual `reindex:qdrant` job is batchable, and it costs
$0.000438 per 200-product run on OpenAI. The discount is worth **$0.0002**. Every other call is on
the synchronous customer-reply path where a multi-hour SLA is not a trade-off, it is an outage.
**Verdict: never.**

### O-13 · Summarise conversation history earlier
**Measured saving: 1.2%.** History is only 134 of 2 156 tokens (6.2%) — `CONTEXT_WINDOW = 10` on
conversations the code's own comment describes as "3–8 turns". Summarisation would add an LLM call
that costs more than the tokens it removes, and BD order flows depend on exact earlier statements
(sizes, prices, addresses) that a summary blurs.
**Verdict: no. It would actively increase cost.**

### O-14 · Shorten tool schemas
There are no tool/function schemas. `llm.service.js` sends no `tools` / `functionDeclarations` block.
**Zero tokens today. Nothing to shorten.** Re-open if function calling is ever adopted.

### O-15 · Retrieve product context selectively
`hasProductIntent()` (`intent-router.js:52`) already gates the DB product lookup on a keyword list,
and RAG results are already filtered at `score > 0.5` with `limit: 4`. Tightening further trades
grounding for pennies — and **hallucinated prices are the failure mode this grounding exists to
prevent** (see the comments at `intent-router.js:396-399`). Cutting retrieved context by 25% saves
**3.9%** of the bill and directly raises the risk of a wrong price being quoted to a customer.
**Verdict: no. ৳0.04 per conversation is not worth a mis-quoted price.**

### O-16 · Suppress duplicate requests
Already done. `message-worker.js:292` claims the dedup key before any model call, so duplicate
webhooks, BullMQ retries and receipt replays all cost $0. **No work needed.**

---

## 4. Measured non-optimizations — do NOT do these

### 4.1 · Compressing customer images does not save Gemini money — it costs more
Provider-reported `countTokens` on `gemini-3.1-flash-lite`:

| Resolution | Tokens |
|---|---|
| 384 × 384 | **1 090** |
| 640 × 640 | 1 090 |
| 720 × 960 | 1 064 |
| 1080 × 1440 | 1 064 |
| 1600 × 1200 | 1 064 |

Gemini 3.1 Flash-Lite allocates a flat ~1 065–1 090 tokens per image at its default media resolution.
Compressing to 384 px makes the bill **0.5% worse** while degrading what the model can see. The
documented "258 tokens if ≤384 px" rule describes Gemini 2.x and does not apply.

The one thing that *might* work is setting `generationConfig.mediaResolution` explicitly — the code
never sets it, and Gemini 3 exposes it as a token-budget control. **Untested (audit U-7); probe it
before assuming a saving.**

### 4.2 · Cutting AI output length
**Measured saving: 4.6%** for a 25% reduction. Output is only 1 010 of ~28 000 tokens. The persona
already enforces "1–3 sentences max". Squeezing further hits the answer quality customers judge the
product by, for ৳0.05 per conversation. **Not worth it.**

---

## 5. Summary

| ID | Change | Saving | Risk | Effort | When |
|---|---|---|---|---|---|
| O-1 | Fix Gemini cache model + stop swallowing the error | up to 40.6%¹ | low | 1 h | before launch |
| O-2 | Reorder failover: OpenAI before `gemini-pro` | 93% of fallback cost | low | 15 m | before launch |
| O-3 | Cap or price `model_preset: 'advanced'` | removes a loss-maker | medium | 2 h | before launch |
| O-4 | Fix `EMBEDDING_PROVIDER` | −0.02% (costs money) | low | 30 m | before launch |
| O-5 | Delete dead model overrides from env files | avoids a latent regression | none | 5 m | before launch |
| O-6 | Stop re-sending images to the final call | 9.7% | low | 3 h | after launch |
| O-7 | Use the FAQ filter on the image path | 2.3–9% | very low | 10 m | after launch |
| O-8 | Fold sentiment into the main call | 5.4% | low | 4 h | after launch |
| O-9 | Skip unchanged re-embeds | ~0% (latency win) | very low | 1 h | after launch |
| O-10 | Compress product images (OpenAI path only) | 60% of upload cost | low | 2 h | after F-7 |
| O-11 | Cache query embeddings | ~0% (latency win) | low | 2 h | optional |
| O-12–16 | Batch, summarisation, tool schemas, selective retrieval, dedup | ≤0 or already done | — | — | **do not do** |

¹ Contingent on the production Gemini project being on a paid tier. Verify that first — it is the
highest-value open question in the audit.

**If O-1, O-2, O-6, O-7 and O-8 all land**, the expected conversation falls from $0.008263 to
**$0.004496** — a **45.6% cut**, taking the variable cost at 350 conversations from $2.98 to $1.59 and
the gross margin from 63.2% to **80.4%**. That is worth having, but none of it is required for the
plan to work.
