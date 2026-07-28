# EasyModerator — AI Variable Cost Audit

**Date:** 2026-07-28 · **Branch:** `audit/ai-cost-model` · **Production commit:** `a8cf44c`
**Pricing table:** `2026-07-28.1` · **FX:** 1 USD = 123.40 BDT (2026-07-22 spot)
**Verdict:** **PARTIALLY_VERIFIED** — see §11

Companion files: [`AI_CALL_GRAPH.md`](AI_CALL_GRAPH.md) · [`AI_COST_ASSUMPTIONS.md`](AI_COST_ASSUMPTIONS.md) ·
[`AI_COST_OPTIMIZATION_BACKLOG.md`](AI_COST_OPTIMIZATION_BACKLOG.md) · [`AI_COST_MODEL.csv`](AI_COST_MODEL.csv) ·
[`AI_COST_MODEL.json`](AI_COST_MODEL.json)

---

## 0. Revision 2026-07-28b — locked architecture

> **Read this section first. It supersedes the numbers in §1–§10 below.**
>
> §1–§10 measured the architecture *as it was*. The locked product decisions then removed
> AI vision entirely and the routing chain changed, so every headline figure moved. The
> generated artefacts (`AI_COST_MODEL.csv`, `AI_COST_MODEL.json`) are regenerated and
> **are** current; the prose in §1–§10 is retained as the measurement record of the
> pre-change system, because the token measurements it rests on are still valid inputs.
>
> New companions: [`AI_ARCHITECTURE_VALIDATION.md`](AI_ARCHITECTURE_VALIDATION.md) ·
> [`RETRIEVAL_QUALITY_EVALUATION.md`](RETRIEVAL_QUALITY_EVALUATION.md) ·
> [`GEMINI_FREE_TIER_CAPACITY.md`](GEMINI_FREE_TIER_CAPACITY.md) ·
> [`GEMINI_FIRST_ROUTING.md`](GEMINI_FIRST_ROUTING.md) ·
> [`PROMPT_CACHING_DECISION.md`](PROMPT_CACHING_DECISION.md) ·
> [`PRODUCT_IMAGE_FLOW_VALIDATION.md`](PRODUCT_IMAGE_FLOW_VALIDATION.md)

### What changed in the architecture

1. **No AI vision, anywhere.** All four vision paths are behind `AI_VISION_ENABLED`
   (default off). A customer photo is answered from its caption plus the DB product search;
   image blocks are stripped before the provider call, so no image tokens are billed.
2. **`gemini-3.1-pro-preview` is out of the automatic fallback chain.** Measured `limit=0`
   on the free Gemini project — it cannot serve a request. Fallback is now
   `gemini-3.1-flash-lite → gpt-4.1-mini`.
3. **Product search metadata is derived from text**, not from a vision response, so the
   `ai_*` ranking columns are populated for every product instead of none.
4. **`model_preset: 'advanced'` is gated** on a plan entitlement no plan grants.

### Revised headline costs

| Scenario | Before (with vision) | **After (locked)** | Change |
|---|---|---|---|
| A — efficient 20-msg conversation | $0.005903 · ৳0.729 | **$0.003783 · ৳0.467** | −35.9% |
| B — expected 20-msg conversation | $0.008263 · ৳1.020 | **$0.006143 · ৳0.758** | −25.7% |
| C — heavy 20-msg conversation | $0.015659 · ৳1.932 | **$0.007290 · ৳0.900** | −53.4% |
| One normal customer message | $0.000770 | **$0.000770** | — |
| One photo message | $0.001846 (vision) | **$0.000782** | −57.6% |
| One fallback message | $0.005383 (`gemini-pro`) | **$0.001089** (`gpt-4.1-mini`) | −79.8% |
| Product upload, 5 images | $0.001369 (intended) | **$0.000000** | −100% |
| Simple product edit | $0.000000 | **$0.000000** | — |

Scenario C falls furthest because it carried both the most images *and* the `gemini-pro`
escalation — the two things that were removed.

### Revised monthly cost (expected profile, 5% fallback)

| Conversations | AI variable | Total incl. infra | BDT | per conversation |
|---|---|---|---|---|
| 50 | $0.3187 | $0.3197 | ৳39.45 | ৳0.789 |
| 100 | $0.6374 | $0.6394 | ৳78.90 | ৳0.789 |
| 300 | $1.9121 | $1.9181 | ৳236.69 | ৳0.789 |
| **350** (plan + grace) | $2.2308 | **$2.2378** | **৳276.14** | ৳0.789 |
| 500 | $3.1868 | $3.1968 | ৳394.49 | ৳0.789 |
| 1000 | $6.3736 | $6.3936 | ৳788.98 | ৳0.789 |

### Revised gross margin at the 350-conversation ceiling

Revenue ৳999 = $8.0956. Before fixed infra, then after a $1.92 attributable infra share:

| Profile | 5% fallback | 10% | 25% | after infra (5%) |
|---|---|---|---|---|
| Efficient | **82.6%** | 82.0% | 78.6% | 58.8% |
| **Expected** | **72.4%** | 71.4% | 68.4% | **48.6%** |
| Heavy | **67.4%** | 66.4% | 63.4% | 43.7% |

Break-even conversations per month: expected @5% **1,266** · heavy @5% **1,073** ·
after fixed infra **965** · after PSP fees and VAT **773**. All are ≥ 2.2× the plan cap of
350, so the plan has substantial headroom in every profile.

### Top-up packs: the previous audit's #1 risk is resolved

Every pack is now margin-positive for every profile, **without changing a single price**:

| Pack | ৳/conv | Efficient GM | Expected GM | Heavy GM | Heavy @25% fallback |
|---|---|---|---|---|---|
| `TOPUP_100` | ৳1.50 | 67.0% | 47.6% | **38.1%** | 30.5% |
| `TOPUP_250` | ৳1.40 | 64.6% | 43.8% | **33.7%** | 25.6% |
| `TOPUP_500` | ৳1.30 | 61.9% | 39.5% | **28.6%** | 19.9% |
| `TOPUP_1000` | ৳1.20 | 58.7% | 34.5% | **22.7%** | 13.2% |

The previous audit found `TOPUP_1000` at **−63.4%** gross margin for a heavy merchant,
because a heavy conversation then cost ৳1.93 against a ৳1.20 sale price. A heavy
conversation now costs **৳0.90**, so the worst pack for the worst profile still clears
**+22.7%**. The earlier recommendation to price no pack below ৳2.20/conversation is
**withdrawn** — it was correct for the architecture it was measured on and is not correct
for this one. **No pricing change is recommended.**

`TOPUP_1000` at heavy usage *and* a 25% fallback rate is the thinnest cell at 13.2%. That is
positive but not comfortable, and it is the cell to watch if the fallback rate rises —
which it will if the free Gemini key is kept past ~10 merchants
([GEMINI_FREE_TIER_CAPACITY.md](GEMINI_FREE_TIER_CAPACITY.md) §3).

### Free-Gemini period vs paid-Gemini period

These must not be conflated. On the current **free** key, `gemini-3.1-flash-lite` bills
**$0** and local embeddings bill $0, so AI variable cost is *only* the OpenAI fallback
share:

| Throttled/failed turn share | Free key, per conversation | 350 conv/month | Paid key, per conversation |
|---|---|---|---|
| 0% | $0.000000 | $0.00 | $0.006143 |
| 5% | $0.000762 | $0.267 · ৳33 | $0.006143 |
| 10% | $0.001525 | $0.534 · ৳66 | $0.006143 |
| 25% | $0.003812 | $1.334 · ৳165 | $0.006143 |

**Treat the free-key column as a promotional credit, not as the business's unit economics.**
Every plan and top-up decision above is taken against the paid column. The free tier's
binding constraint is not cost but **15 requests/minute project-wide** — roughly 4
concurrent conversations, platform-wide.

### Revised scenario matrix (Phase 8)

| Scenario | Per conversation | Note |
|---|---|---|
| Gemini-only, expected | $0.006143 · ৳0.758 | the normal case |
| Gemini retry then success | $0.006143 · ৳0.758 | a failed Gemini call is **not billed**; only latency is paid |
| Gemini quota exhaustion → OpenAI (1 turn) | $0.006462 · ৳0.797 | +5.2% |
| Gemini outage → OpenAI (all 14 turns), cold cache | $0.010143 · ৳1.252 | +65.1% |
| Gemini outage → OpenAI (all 14 turns), warm prompt cache | $0.004296 · ৳0.530 | **−30.1%** — see below |
| Heavy, no vision | $0.007290 · ৳0.900 | |
| Text-heavy catalogue (5 products + 4 chunks every turn) | $0.006143 · ৳0.758 | already the modelled default |
| Large-catalogue retrieval, 200 products | $0.000000 | Postgres FTS + local embeddings — no provider call |
| Current local retrieval | $0.000000 | n-gram hash |
| Gemini semantic retrieval | $0.000002 / conv | `gemini-embedding-001`, 4 query embeddings — **not recommended** |
| Hybrid retrieval | $0.000002 / conv | lexical + Gemini RRF — **not recommended**, no measured gain |

Retrieval is a rounding error either way. The retrieval decision is a **quality** decision,
not a cost decision — which is why it is settled in
[RETRIEVAL_QUALITY_EVALUATION.md](RETRIEVAL_QUALITY_EVALUATION.md) on accuracy, not price.

**A total Gemini outage is no longer a cost event worth planning around.** Cold, it costs
+65%; but the system prompt is identical across a merchant's messages, and OpenAI's
automatic prompt caching was measured hitting **90% of the prefix** (`cached_tokens: 1920`
of 2,125). Once warm, an all-OpenAI conversation costs **$0.004296 — 30% *less* than the
Gemini primary**, because Gemini's caching does not engage at all
([PROMPT_CACHING_DECISION.md](PROMPT_CACHING_DECISION.md)). The honest summary is that the
fallback provider is now cheaper than the primary on sustained traffic, and the reason to
keep Gemini primary is latency, the free tier, and not depending on a single vendor —
not price.

### Costs that are NOT AI and are now the larger line

With vision gone, AI is ~$2.24/merchant/month at the plan ceiling. Bigger items:

| Item | Estimate | Note |
|---|---|---|
| Fixed infra share | $1.92/merchant/month | $48 droplet ÷ 25 merchants [A] — the founder has not confirmed the droplet size |
| Product image storage + egress | ~$0.04/merchant/month | only once upload exists; $5/month Spaces covers ~125 merchants |
| PSP fee | 2.5% of ৳999 | |
| VAT | 15% | |

**Fixed infra is now ~46% of the per-merchant marginal cost.** The lever that matters at
this scale is the droplet, not the model.

---

## 1. Executive summary

AI is **not** the risk to EasyModerator's unit economics. At the expected usage profile a merchant
consumes **৳1.02 of AI per conversation** against a plan that charges **৳2.85–3.33**, giving a
**63% gross margin at the 350-conversation grace ceiling** and a break-even at ~950 conversations —
nearly 3× the plan cap. The GROWTH plan at ৳999/month is **comfortably sustainable**.

Four things are worth acting on, in this order:

1. **Top-up packs are loss-making for exactly the merchants who buy them.** `TOPUP_1000` sells
   conversations at ৳1.20 while a heavy merchant consumes ৳1.93 of AI — a **−63% gross margin**.
   Every pack inverts for heavy users. A merchant only buys a top-up after exhausting 350
   conversations, which self-selects for the heavy profile.
2. **The `gemini-pro` middle tier is the most expensive thing in the system, and it is also the
   *first* place a failure lands.** One escalated turn costs **8.2× a normal one** ($0.005383 vs
   $0.000770). Escalating to `gpt-4.1-mini` instead costs **1.4×** cold — and **0.6×** once OpenAI's
   automatic prompt cache warms, which was measured at a 90% hit rate. The failover chain is ordered
   most-expensive-second.
3. **Prompt caching has never worked in production, on any call.** Confirmed three ways (§4.3).
   That is a standing ~40% cost overhang — though unlocking it needs a billing change, not just a
   code fix.
4. **Images are the single largest driver** — 44% of scenario-B input tokens — and the code sends
   each one to the model **twice**. Compressing them saves nothing on Gemini (measured).

Two findings are cost-relevant but land as correctness problems:

- **RAG retrieval is almost certainly running on a non-semantic hash.** `EMBEDDING_PROVIDER` is set
  to `gemini` / `google` in every config artefact in the repo, and `resolveProvider()` accepts
  neither — both fall through to a character-bigram hash. Real embeddings would cost
  **$0.000002 per conversation**. This is a quality defect with no cost justification.
- **Product image upload is not implemented.** The Add Product form collects up to five files and
  never sends them. Today a "product upload with five images" costs **$0.00**.

---

## 2. Exact production models

| Role | Model | How it is resolved |
|---|---|---|
| Primary chat + vision | **`gemini-3.1-flash-lite`** | `llm.service.js:27` default |
| Fallback tier 2 | **`gemini-3.1-pro-preview`** | `llm.service.js:28` default |
| Fallback tier 3 | **`gpt-4.1-mini`** | `llm.service.js:29` default |
| Product attribute vision | **`gpt-4.1-mini`** (forced) | `product-ai.service.js:66` — comment says "GPT-4o for vision", the code sends `gpt-4.1-mini` |
| Embeddings | **local n-gram hash** (`text-embedding-3-small` if the secret says `openai`) | `embedding.service.js:218-253` |
| Explicit prompt cache | `gemini-2.0-flash` — **retired 2026-06-01** | `gemini-cache.service.js:108` |
| Voice transcription | `gemini-1.5-flash` (hardcoded, route-only, unreachable from the message pipeline) | `voice-processing.service.js:28` |

**The defaults are what run.** `scripts/render-production-env.js:90-160` writes a fixed key list to
`.env.prod`, and `LLM_GEMINI_LITE_MODEL` / `LLM_GEMINI_PRO_MODEL` / `LLM_OPENAI_MODEL` are not in it.
No matching GitHub secret exists (`gh secret list`, 2026-07-28).

> ⚠️ The repo's checked-in `.env.prod` and `.env.docker` set
> `LLM_GEMINI_LITE_MODEL=gemini-2.0-flash-lite` and `LLM_GEMINI_PRO_MODEL=gemini-2.5-pro-preview-06-05`.
> `gemini-2.0-flash-lite` was **shut down on 2026-06-01**. Any environment that loads those files —
> local Docker, a manual droplet deploy, a future CI change that starts honouring them — sends 100%
> of traffic to a dead primary and dead secondary, landing every reply on `gpt-4.1-mini` after two
> wasted round-trips. Deleting those three keys from both files removes a live footgun.

---

## 3. Where the money actually goes

### 3.1 Per customer message

| Event | Model calls | Input tok | Output tok | USD | BDT |
|---|---|---|---|---|---|
| Greeting (regex fast-path) | 0 | 0 | 0 | **$0.000000** | ৳0.0000 |
| Order-status lookup / cart step | 0 | 0 | 0 | **$0.000000** | ৳0.0000 |
| Duplicate webhook or BullMQ retry | 0 | 0 | 0 | **$0.000000** | ৳0.0000 |
| FAQ-branch answer | 1 | 1 292 | 45 | **$0.000391** | ৳0.0482 |
| Short text (sentiment skipped) | 2 | 1 708 | 45 | **$0.000495** | ৳0.0610 |
| **Normal text message (expected)** | **3** | **2 362** | **120** | **$0.000770** | **৳0.0951** |
| Text + 1 image | 3 | 4 905 | 175 | **$0.001489** | ৳0.1837 |
| **Fallback → `gemini-pro`** | 3 | 2 362 | 120 | **$0.005383** | ৳0.6643 |
| Fallback → `gpt-4.1-mini` (both Gemini tiers down) | 3 | 2 331 | 120 | **$0.001089** | ৳0.1344 |
| Worst reasonable path (all 3 tiers billed + retry) | 5 | 6 841 | 430 | **$0.007968** | ৳0.9833 |

The "normal" row decomposes as: main reply $0.000659 (2 156 in / 80 out on `gemini-3.1-flash-lite`,
cross-checked against a live `promptTokenCount` of **2 155**), sentiment classification $0.000111
(206 in / 40 out), RAG query embedding $0.000000.

### 3.2 Component cost per normal message

| Component | USD | Share |
|---|---|---|
| Main reply — input tokens | $0.000539 | 70.0% |
| Main reply — output tokens | $0.000120 | 15.6% |
| Sentiment classification | $0.000111 | 14.4% |
| RAG query embedding | $0.000000 | 0.0% |
| Preprocessing, intent routing, language detection, safety, confidence | $0.000000 | 0.0% |

**Intent classification, query rewriting, language detection, safety/moderation, hallucination
detection and confidence scoring make no model calls.** They are regex, keyword and threshold logic.
Verified by grepping `guardrail.service.js`, `prompt-sanitizer.service.js`,
`hallucination-detector.service.js`, `confidence-gate.service.js`, `intent-threshold.service.js` and
`conversation-context.service.js` for `chat(` and `fetch(` — no hits.

### 3.3 What one message's 2 156 input tokens are made of

| Block | Tokens | Share | Sent on |
|---|---|---|---|
| Persona + operating context + business info (static) | 1 087 | 50.4% | **every call** |
| Top-5 relevant FAQs | 164 | 7.6% | every call |
| Grounded products (5) + RAG chunks (4) | 746 | 34.6% | most calls |
| Conversation history (8 turns, verbatim) | 134 | 6.2% | every call |
| The customer's actual message | 25 | 1.2% | — |

**Half of every bill is the same static persona block, re-sent from scratch on every single call.**
That is exactly the shape prompt caching exists for, and exactly what is broken (§4.3).

---

## 4. Cost-relevant findings

### F-1 · Top-up packs invert margin for heavy merchants — **HIGH**

`subscription.plans.js:34-39` sells top-ups below the base plan's ৳3.33/conversation:

| Pack | ৳/conv | Efficient GM | Expected GM | **Heavy GM** | Heavy @25% fallback |
|---|---|---|---|---|---|
| `TOPUP_100` | 1.50 | 49.5% | 30.1% | **−30.7%** | −38.3% |
| `TOPUP_250` | 1.40 | 45.9% | 25.1% | **−40.1%** | −48.2% |
| `TOPUP_500` | 1.30 | 41.8% | 19.4% | **−50.8%** | −59.6% |
| `TOPUP_1000` | 1.20 | 36.9% | 12.7% | **−63.4%** | −72.9% |

The selection effect is the problem: a merchant only reaches the top-up screen after burning 300 + 50
conversations, which is precisely the population most likely to be image-heavy and long-form. The
base plan absorbs heavy usage (31% GM); the top-ups do not.

Recommended threshold, not a price change: **a top-up should not price a conversation below
৳2.20** (heavy cost ৳1.93 + 15% headroom). `TOPUP_100` at ৳1.50 is the only pack within sight of that.

### F-2 · Embeddings are running on a non-semantic hash — **HIGH (quality), NIL (cost)**

`embedding.service.js:218-224` accepts only `openai`, `gcp`, `http`, `tei`. Every configuration
artefact in the repo sets something else:

| Artefact | Value | Resolves to |
|---|---|---|
| `.env.prod`, `.env.docker` | `gemini` | `local` |
| `scripts/generate-secrets.sh:132`, `.ps1:144` | `google` | `local` |
| `scripts/github-secrets-checklist.txt:33` | `google` | `local` |
| `.env.example:57` | `http` | `gcp` ✓ |

The `EMBEDDING_PROVIDER` GitHub secret's value is **[U]** — `/health/detailed` requires
authentication and returned 401. But the checklist that drove secret entry says `google`, so the
overwhelming likelihood is that production RAG retrieval returns near-random matches.

**Cost impact of fixing it: $0.000002 per conversation** ($0.0006/month at 300 conversations). There
is no cost argument for the current state. Note the code already recognises this failure mode and
surfaces it as `embedding.semantic = false` on `/health/detailed` — nobody has read it.

### F-3 · Prompt caching has never fired — **HIGH**

Three independent confirmations on 2026-07-28:

1. `intent-router.js:461` calls `geminiCache.getOrCreate(shopId, systemPrompt)` **without a model
   argument**, so the cache is created for `gemini-2.0-flash` (`gemini-cache.service.js:108`) — a
   model retired 2026-06-01 and, regardless, not the model generating the reply. A cache bound to
   model A cannot be used by model B.
2. A live `POST /v1beta/cachedContents` for that model returns
   `400 "Cached content is too small. total_token_count=1998, min_total_token_count=4096"`.
   `gemini-cache.service.js:80` treats any 400 containing `"minimum"` as a silent skip → `null`.
3. Two **identical** back-to-back `generateContent` calls both reported `promptTokenCount: 2155` with
   **no `cachedContentTokenCount` field** — implicit caching did not engage either.

A fourth blocker surfaced when probing the *correct* model: the API key available to this audit
returns `429 TotalCachedContentStorageTokensPerModelFreeTier … limit=0`, i.e. **it belongs to a
free-tier project with zero caching quota**. Production uses a separate secret
(`GOOGLE_GEMINI_API_KEY`) whose billing status is **[U]** — but if it is also free-tier, then
`gemini-3.1-pro-preview` (no free tier per Google's pricing page) cannot serve fallback at all, and
current Gemini spend is $0 with hard daily caps silently dropping replies at volume. **Verifying the
production key's billing status is the single highest-value open item in this audit.**

### F-4 · The failover chain is ordered most-expensive-second — **MEDIUM**

`llm.service.js:166-170` orders providers `gemini-lite → gemini-pro → openai`. Measured cost of the
same turn:

| Tier | USD | vs primary |
|---|---|---|
| `gemini-3.1-flash-lite` | $0.000659 | 1.0× |
| `gemini-3.1-pro-preview` | $0.005272 | **8.0×** |
| `gpt-4.1-mini` (cold cache) | $0.000978 | 1.5× |
| `gpt-4.1-mini` (warm cache — **measured**) | $0.000402 | **0.6×** |

The last row is not theoretical. Re-sending the identical prompt to `gpt-4.1-mini` later in the audit
returned `prompt_tokens_details.cached_tokens: 1920` of 2 125 — a 90% automatic cache hit. **OpenAI's
prompt cache engages on exactly the prompt shape where Gemini's does not**, which makes a warm
`gpt-4.1-mini` 39% *cheaper* than the current Gemini primary. Both runs are in
`evidence/provider-usage-metadata.json`.

When `gemini-lite` has an outage, the circuit breaker opens after 3 consecutive failures and pins
**all** traffic to `gemini-pro` for 300 seconds (`circuit-breaker.service.js:19-20`). At 350
conversations/month that is a bounded exposure, but the ordering is backwards: the cheaper, equally
capable `gpt-4.1-mini` should be tier 2 and `gemini-pro` the last resort.

Shops set to `model_preset: 'advanced'` pay tier-2 prices on **every** message
(`ai-chatbot.controller.js:291`): **৳0.66 per message**, which at 350 conversations × ~6 billed turns
is ৳1,386/month against ৳999 revenue. **A single "advanced" merchant is loss-making.**

### F-5 · Every image is sent to the model twice — **MEDIUM**

`intent-router.js:310` runs `_extractProductAttributes(imageUrls[0])` — one vision call, 1 064 image
tokens. `intent-router.js:346` then attaches **every** image in the burst to the final call
(`imageUrls.map(url => ({type:'image_url', url}))`), paying 1 064 tokens again for the same bytes.
The extracted attributes are used only for a DB search; the raw image is re-sent so the model can
"see" it.

Images are **44% of scenario-B input tokens** (6 images × 1 064 = 6 384 of 26 993).

**Measured non-optimization:** downscaling does not help. `gemini-3.1-flash-lite` bills 1 090 tokens
for a 384×384 image and 1 064 for a 1600×1200 one. Compression makes Gemini cost marginally *worse*.
It does help on the product-upload path, which forces OpenAI (429 tokens at 512px vs 2 493 at
1080×1440).

### F-6 · The image path abandons FAQ filtering — **LOW**

`ai-chatbot.controller.js:267` sets `relevantFaqs = hasImages ? null : …`, and `buildSystemPrompt`
treats `null` as "dump `faqs.slice(0, MAX_FAQ_IN_PROMPT)`" — up to 50 FAQs. Measured: the system
prompt grows from 1 251 → 1 508 tokens on a 12-FAQ shop and → **2 554** on a 50-FAQ shop, on exactly
the turns that are already the most expensive. Passing `relevantFaqs` on both paths is a one-line fix.

### F-7 · Product images are never uploaded — **HIGH (functional), NEGATIVE (cost)**

`AddProduct.tsx:37` holds up to five `File` objects in `productImages`. The payload assembled at
`AddProduct.tsx:245-296` never references them, there is no `FormData`, and no upload endpoint
exists (`product.validator.js:36` expects `images: string[]`). So `processProduct` hits
`if (!imageUrls.length) return false` (`product-ai.service.js:46`) and the entire vision pipeline is
skipped.

**A product upload with five images costs $0.00 today** — because nothing happens. All `ai_*`
columns stay null, CLIP indexing never runs, and the product's embedding text is limited to the
merchant's own typed fields.

### F-8 · Unconditional re-embedding on every product write — **LOW**

`product.service.js:311` re-embeds on any update that does not touch images, with no diff against
the previous embedding text. Changing `quantity` — a field deliberately excluded from the embedding
(`product-embedding.service.js:11`) — still triggers a full re-embed. `bulkUpdateProducts` re-embeds
every product in the batch. At local-embedding prices this is free; at OpenAI prices it is
$0.000002 each. Worth fixing for latency and Qdrant write pressure, not for cost.

### F-9 · BanglaBERT and CLIP are dead in production — **LOW (cost-increasing)**

`services/banglish-bert` and `services/clip-similarity` exist in the repo but are **not** services in
`docker-compose.prod.yml` (which runs caddy, backend, worker, frontend, postgres, redis, qdrant).
`bert-client.service.js:15` defaults to `http://localhost:8001` → connection refused → marked
unavailable for 30 s and retried forever. The free BERT greeting fast-path never fires; only the
narrower regex fast-path (`intent-router.js:79`) survives. CLIP Tier 1 image matching is likewise
always skipped, pushing image matching straight to the paid Gemini Vision tier.

### F-10 · Retries and duplicate webhooks are already free — **positive finding**

`message-worker.js:292` claims `msg:dedup:<shop>:<externalId>` with `SET NX EX 86400` **before** any
model call. A duplicate Meta delivery, a BullMQ retry (attempts: 3), and a webhook-receipt replay all
short-circuit at zero cost. Burst coalescing (`burst-coalescer.js`, 8 s debounce / 20 s cap) folds
rapid-fire messages into one AI turn.

> Correctness note, outside cost scope: because the dedup key is claimed *before* the AI runs, a job
> that fails *after* claiming it will have its retries no-op — the customer gets no reply and the DLQ
> stays empty. Worth a separate ticket.

---

## 5. The 20-message conversation

**What is billable.** `meta-webhook-events.handler.js:408-417` calls
`trackUsage(shopId, 'conversations', 1, 'conv:<id>')` **once per new conversation**, idempotent on the
conversation id. A 20-message thread is **1 billable conversation**, not 20. Only *customer* messages
can trigger a model call, AI replies never do, and several customer messages trigger nothing at all.
**Do not divide a conversation total by 20.**

| | **A — Efficient** | **B — Expected** | **C — Heavy** |
|---|---|---|---|
| Customer messages / AI replies | 10 / 10 | 10 / 10 | 10 / 10 |
| Billable conversations | 1 | 1 | 1 |
| **Model calls** | **14** | **20** | **20** |
| Total customer characters | ~170 | ~650 | ~1 900 |
| Total AI output characters (customer-visible only) | ~1 200 | ~2 200 | ~3 450 |
| Total input tokens | 20 461 | 26 993 | 33 051 |
| **Cached input tokens** | **0** | **0** | **0** |
| Total output tokens | 525 | 1 010 | 1 410 |
| Embedding tokens | 18 | 100 | 125 |
| Images processed | 6 (3 unique × 2 sends) | 6 (3 × 2) | 8 (5 × 2, batched) |
| Gemini cost | $0.005903 | $0.008263 | $0.015659 |
| OpenAI chat/fallback | $0 | $0 | $0 (escalation stays on `gemini-pro`) |
| OpenAI embeddings | $0 (local fallback) | $0 | $0 |
| Retry / failure overhead | $0 | $0.000659 (1 customer rephrase) | $0.005272 (1 pro escalation) + $0.000825 (1 rephrase) |
| Infrastructure overhead | $0.00002 | $0.00002 | $0.00002 |
| **Total per conversation** | **$0.005903** | **$0.008263** | **$0.015659** |
| **In BDT** | **৳0.73** | **৳1.02** | **৳1.93** |
| Avg per customer message | $0.000590 | $0.000826 | $0.001566 |
| Avg per AI reply | $0.000590 | $0.000826 | $0.001566 |
| **Cost per BILLABLE conversation** | **$0.005903** | **$0.008263** | **$0.015659** |

Character counts are derived from the measured fixture at 2.7–3.4 chars/token (Bengali and Banglish
tokenize far denser than English) and exclude the JSON-only outputs of the sentiment and vision
extraction calls, which no customer ever sees.

Scenario C includes one duplicate webhook (deduped, $0) and one `gemini-lite` failure escalating to
`gemini-3.1-pro-preview`. That single escalation costs $0.006036 — **38.5% of the entire
conversation** — for one turn out of twenty.

Per-operation rows for all three scenarios are in [`AI_COST_MODEL.csv`](AI_COST_MODEL.csv) (96 rows).

---

## 6. Product upload with five images

| Scenario | Vision | Embeddings | USD | BDT |
|---|---|---|---|---|
| **First upload, 5 images — as currently shipped** | 0 | 1 | **$0.000000** | ৳0.0000 |
| First upload, 5 images — once upload is wired (1080×1440) | 1 (`gpt-4.1-mini`) | 1 | **$0.001369** | ৳0.1689 |
| First upload, 5 images — pre-compressed to 512 px | 1 | 1 | **$0.000543** | ৳0.0670 |
| Simple text edit (name/price/description) | 0 | 1 | **$0.000000** | ৳0.0000 |
| Only one non-embedded field changes (e.g. quantity) | 0 | 1 | **$0.000000** | ৳0.0000 |
| Replace **one** image | 1 | 1 | **$0.001369** | ৳0.1689 |
| Replace **all five** images | 1 | 1 | **$0.001369** | ৳0.1689 |
| Delete + recreate | 1 | 1 | **$0.001369** | ৳0.1689 |
| Full shop reindex (200 products + 12 FAQs) | 0 | 212 | **$0.000000** | ৳0.0000 |

With `EMBEDDING_PROVIDER=openai` the embedding lines become $0.000002 each and the full reindex
$0.000438.

Notes that matter:

- **Only `images[0]` is ever analysed.** Images 2–5 reach no model, at any point, in any scenario.
  Replacing one image and replacing all five cost exactly the same.
- **Image bytes are never embedded as text**, and there is no image-vector store in the live stack.
  `buildEmbeddingText()` (`product-embedding.service.js:31-68`) concatenates typed fields plus
  vision-derived `ai_*` attributes. CLIP would have produced image vectors but is not deployed (F-9).
  The measured product document is **106 tokens** — one embedding, no chunking, no overlap, no
  metadata tokens. Price and stock are deliberately excluded because they change too often.
- **Duplicate detection, category suggestion, template suggestion, OCR, and description generation
  do not exist** in the code. Cost: $0.
- **Facebook-post product import does not exist** either. `product.controller.js:154` has a comment
  "AI: Extract products from uploaded content" but no such route is registered.
- Raw image storage/bandwidth is $0 — no bytes are uploaded (F-7). Once wired, five 500 KB images on
  the droplet's `backend_uploads` volume is 2.5 MB per product; a 200-product catalogue is 500 MB,
  which is a fixed-capacity question, not a variable cost.

**Best / expected / heavy product-ingestion cost:** $0.000000 / $0.000000 / $0.001369.

---

## 7. Monthly variable cost per merchant

Includes conversations, the fallback uplift, 15 product adds + 30 edits/month, and marginal
infrastructure. Excludes fixed infrastructure (allocated separately in §8).

### Expected conversation profile, 5% fallback

| Conversations | AI variable USD | Total variable USD | Total BDT | ৳/conversation |
|---|---|---|---|---|
| 50 | $0.4247 | $0.4257 | ৳52.53 | ৳1.05 |
| 100 | $0.8494 | $0.8514 | ৳105.06 | ৳1.05 |
| 300 | $2.5482 | $2.5542 | ৳315.18 | ৳1.05 |
| **350 (plan + grace)** | **$2.9729** | **$2.9799** | **৳367.72** | **৳1.05** |
| 500 | $4.2470 | $4.2569 | ৳525.31 | ৳1.05 |
| 1 000 | $8.4939 | $8.5139 | ৳1 050.62 | ৳1.05 |

### All three profiles at the volumes that matter

| Conversations | Efficient (5%) | Expected (5%) | Heavy (10%) |
|---|---|---|---|
| 50 | $0.31 / ৳38 | $0.43 / ৳53 | $0.81 / ৳100 |
| 100 | $0.62 / ৳76 | $0.85 / ৳105 | $1.61 / ৳199 |
| 300 | $1.85 / ৳228 | $2.55 / ৳315 | $4.84 / ৳598 |
| **350** | **$2.15 / ৳266** | **$2.98 / ৳368** | **$5.65 / ৳697** |
| 500 | $3.08 / ৳380 | $4.26 / ৳525 | $8.07 / ৳996 |
| 1 000 | $6.15 / ৳759 | $8.51 / ৳1 051 | $16.14 / ৳1 992 |

### Split by cost line (expected, 350 conversations, 5% fallback)

| Line | Calls/conv | USD | Share |
|---|---|---|---|
| Gemini — main text replies (4 + 1 customer rephrase) | 5 | $1.1533 | 38.7% |
| Gemini — image-path replies | 3 | $1.0387 | 34.9% |
| Gemini — vision attribute extraction | 3 | $0.4074 | 13.7% |
| Gemini — sentiment classification | 4 | $0.1561 | 5.2% |
| Gemini — FAQ-branch replies | 1 | $0.1367 | 4.6% |
| Fallback uplift (5% × $0.004613/conv) | 0.05 | $0.0807 | 2.7% |
| OpenAI chat/fallback | 0 | $0.0000 | 0.0% |
| OpenAI embeddings | 4 | $0.0000 | 0.0% |
| Product ingestion (15 adds + 30 edits) | — | $0.0000 | 0.0% |
| Storage / vector / DB overhead | — | $0.0070 | 0.2% |
| **Total** | **20** | **$2.9799** | **100%** |

Across all Gemini calls that is **9 447 550 input tokens** ($2.3619) and **353 500 output tokens**
($0.5303) per merchant-month at 350 conversations.

---

## 8. Plan sustainability

**GROWTH:** ৳999/month = **$8.10** for 300 conversations + a 50-conversation grace buffer
(`subscription.plans.js:98-119`, `THRESHOLD_BUFFER = 50`). Headline **৳3.33/conversation**;
**৳2.85** if the grace buffer is fully consumed.

### Gross margin at the 350-conversation ceiling

| Profile | Fallback | Variable cost | GM before fixed infra | GM after $1.92 infra share |
|---|---|---|---|---|
| Efficient | 5% | $2.15 | **73.4%** | 49.7% |
| Efficient | 25% | $2.48 | 69.4% | 45.7% |
| **Expected** | **5%** | **$2.98** | **63.2%** | **39.5%** |
| Expected | 10% | $3.06 | 62.2% | 38.5% |
| Expected | 25% | $3.30 | 59.2% | 35.5% |
| Heavy | 5% | $5.57 | **31.2%** | 7.5% |
| Heavy | 25% | $5.90 | 27.2% | 3.5% |

Fixed-infra share = $48/month droplet ÷ 25 merchants = $1.92. Both the droplet cost and the merchant
count are assumptions (**[U-5]**, **S-12**) — at 10 merchants the share is $4.80 and the heavy
after-infra margin goes **negative**. Fixed infrastructure, not AI, is what makes the early-stage
picture tight.

### Break-even (conversations/month before AI consumes the whole ৳999)

| Condition | Break-even |
|---|---|
| Efficient, 5% fallback | 1 315 |
| Expected, 0% fallback | 977 |
| **Expected, 5% fallback** | **950** |
| Expected, 10% fallback | 925 |
| Expected, 25% fallback | 857 |
| Heavy, 5% fallback | 508 |
| Heavy, 25% fallback | 480 |
| Image-heavy merchant, 10% fallback | 501 |
| Expected, after fixed-infra allocation | 725 |
| Expected, after 2.5% PSP fee + 15% VAT + infra | 580 |

Every break-even sits above the 350-conversation ceiling. Even a heavy, image-heavy merchant at 25%
fallback needs **480** conversations to erase the margin — 37% above the grace cap. The plan cap is
doing its job.

### Merchants using the full grace allowance

The 50-conversation buffer costs **$0.41** (expected) to **$0.78** (heavy) — ৳51 to ৳97 against ৳999
of revenue. Cheap insurance; no reason to reduce it.

### Merchants exceeding the allowance

This is the one place the pricing is wrong. See **F-1**. Top-ups sell below the base rate to the
merchants most likely to be heavy, and go negative at the heavy profile.

### Verdict

- Base GROWTH plan at 300 + 50 conversations: **comfortably sustainable** (63% expected, 31% worst
  realistic profile).
- `model_preset: 'advanced'` merchants: **loss-making** — ৳1,386/month of AI against ৳999 (F-4).
- Top-up packs for heavy merchants: **loss-making** — −31% to −63% (F-1).
- PARTNER plan (0 upfront, ৳10–15/delivered order, unlimited conversations): **unbounded exposure.**
  A PARTNER shop with high chat volume and low conversion pays nothing while consuming AI. At the
  heavy profile, 1 000 conversations costs ৳1,992 and would need ~160 delivered orders at the ৳12
  tier to break even. No conversation cap exists on this plan (`conversationsLimit: UNLIMITED`).
  Flagged as evidence, not a pricing recommendation.

---

## 9. Observability: what is and is not recorded

**Before this audit: nothing.** `llm.service.js` parsed the response for `text` and discarded
`usageMetadata` / `usage` entirely. No provider, model, token, cost, retry, or fallback figure was
persisted anywhere. Every number in this report had to be reconstructed by re-measuring the payloads.

| Field | Recorded before | Recorded now (flag on) |
|---|---|---|
| provider, model | ✗ | ✓ |
| input / cached-input / output / reasoning tokens | ✗ | ✓ |
| image count, image tokens (by modality) | ✗ | ✓ |
| embedding tokens | ✗ | ✓ |
| request count, retry sequence, fallback sequence | ✗ | ✓ |
| latency | ✗ | ✓ |
| estimated cost + `sourceOfUsage` | ✗ | ✓ |
| shopId, conversationId, messageId, productId, operationType | ✗ | ✓ |
| success/failure outcome | ✗ | ✓ |
| image size / detail level | ✗ | ✗ — not exposed by either provider |

Added in this audit, **disabled by default**:

- `src/modules/ai/pricing-table.json` — versioned, dated, sourced. No rate is hardcoded in logic.
- `src/modules/ai/cost.service.js` — pure normalisation + costing. An unknown model or missing usage
  block returns `costUsd: null`, **never `0`**, so a gap shows up as a hole rather than as cheapness.
- `src/modules/ai/usage-recorder.service.js` — one structured `ai_usage` log line per call. Gated on
  `AI_USAGE_ACCOUNTING=true`; a no-op otherwise. Idempotent on `requestId` (Redis `SET NX`), records
  **no** prompt bodies, replies, secrets or customer identifiers, and can never throw into the caller.
- Wiring: `llm.service.js` (both providers) and `embedding.service.js`, each a `void recordUsage(...)`
  that cannot alter the return value.
- 37 tests in `src/modules/ai/__tests__/cost.service.test.js`.

**Not deployed.** To turn it on: set `AI_USAGE_ACCOUNTING=true` in `.env.prod` (it is not currently
in the rendered key set, so it must be added to `render-production-env.js` first).

---

## 10. Top five cost drivers

Measured against scenario B (26 993 input tokens, $0.008263 per conversation):

| # | Driver | Input tokens | Cost share | Evidence |
|---|---|---|---|---|
| 1 | **Static persona block re-sent uncached on every call** (1 087 tok × 9 calls) | 9 783 (36.2%) | **29.6%** | F-3, §3.3 |
| 2 | **Images at ~1 064 tok each, every one sent twice** (6 sends) | 6 384 (23.6%) | **19.3%** | F-5 |
| 3 | **Retrieved grounding, 5 products + 4 RAG chunks** (746 tok × 8 calls) | 5 968 (22.1%) | **18.1%** | §3.3 |
| 4 | **`gemini-pro` escalations at 8× tier-1** | — | 2.7% at a 5% rate, but **38.5% of scenario C** | F-4 |
| 5 | **The LLM sentiment tier** (4 calls) | 824 (3.1%) | **5.4%** | §3.2 |

Drivers 1–3 are all *prompt-assembly* decisions, not model choice. Together they are **67% of every
conversation's input tokens.**

---

## 11. Verdict — PARTIALLY_VERIFIED

**Verified with provider-reported data:** the model chain and the exact model ids actually resolved
in production; per-call prompt, image, output and cached token counts on both providers; that
prompt caching never fires; image tokenization on both providers across five resolutions; the
billing/metering definition; plan and top-up economics; every code path that can spend money.

**Not verified:**

| Gap | Why it matters | How to close it |
|---|---|---|
| Production `GOOGLE_GEMINI_API_KEY` billing tier | If free-tier, `gemini-pro` fallback cannot work and replies are silently rate-capped. Highest-value unknown. | Attempt a `cachedContents` create with the production key, or read Google Cloud billing |
| `EMBEDDING_PROVIDER` secret value | Decides whether RAG works at all (F-2) | `GET /health/detailed` with an admin token |
| Real fallback / retry / reply-length distributions | ±5% on margin | `AI_USAGE_ACCOUNTING=true` for one week |
| Whether failed or client-timed-out Gemini calls are billed | Sets the worst-case retry figure | Reconcile the provider console against the ledger |
| Droplet size and current DigitalOcean spend | Sets the fixed-infra allocation, which dominates the early-stage margin | DO billing console |
| Real merchant images-per-conversation | The #1 driver | Same telemetry |

None of these move the headline conclusion — the base plan is comfortably sustainable — but the
free-tier question could invalidate the entire *Gemini* cost line in either direction, which is why
this is PARTIALLY_VERIFIED rather than COST_MODEL_VERIFIED.
