# EasyModerator AI Cost Model — Assumptions & Evidence Register

> **REVISION 2026-07-28b.** The locked architecture invalidates the image-related
> assumptions below and adds free-tier ones. Superseding entries:
>
> | Assumption | Now |
> |---|---|
> | Images per conversation (3 efficient / 3 expected / 5 heavy) | still the traffic assumption, but **image token cost is 0** — blocks are stripped before the provider call |
> | Image tokenisation (1,064 flat on Gemini; resolution-scaled on OpenAI) | **measured and still valid**, but only applies if `AI_VISION_ENABLED=true` |
> | Fallback lands on `gemini-3.1-pro-preview` | **wrong** — falls back to `gpt-4.1-mini`; `gemini-pro` is `limit=0` on the free project |
> | Gemini prompt caching may engage on a paid tier | still open, but explicit caching is `limit=0` **and** implicit caching was measured not engaging at ~2,000 tokens |
> | *(new)* Gemini free tier = 15 requests/min project-wide | **[M]** measured; it is a capacity limit, not a cost limit |
> | *(new)* 14 Gemini requests per expected conversation | **[M]** from `AI_COST_MODEL.json` |
> | *(new)* 12 active hours/day, 25% of volume in the peak hour, ~4 min per conversation | **[A]** capacity model only — see `GEMINI_FREE_TIER_CAPACITY.md` §3 |
> | *(new)* Product image storage ~$0.04/merchant/month on DO Spaces | **[A]** and only once an upload flow exists |

**Audit date:** 2026-07-28 · **Pricing table version:** `2026-07-28.1` · **Currency:** USD primary, BDT secondary

Every number in `AI_COST_AUDIT.md`, `AI_COST_MODEL.csv` and `AI_COST_MODEL.json` traces to a row here.

## Evidence grades

| Grade | Meaning |
|---|---|
| **[P] provider_reported** | Read out of a real provider response (`usageMetadata` / `usage`). Highest confidence. |
| **[T] tokenizer_estimate** | Gemini `countTokens` run against the *real* assembled payload. Non-billed, provider-side tokenizer. |
| **[C] code_derived** | Read directly from source at a cited `file:line`. |
| **[S] scenario_assumption** | A traffic or behaviour assumption. Stated, never buried. |
| **[U] unknown** | Could not be established with the access available. Listed in §7. |

Reproduce every [P] and [T] figure with:

```bash
cd EasyMod-backend
node scripts/ai-cost/measure-payloads.js --json       # [T] real prompt payloads
node scripts/ai-cost/measure-image-tokens.js --json   # [P] image tokens by resolution
node scripts/ai-cost/probe-usage-metadata.js --openai # [P] live usageMetadata, both providers
node scripts/ai-cost/ai-cost-report.js                # regenerate CSV + JSON
```

---

## 1. Pricing (retrieved 2026-07-28)

**Google** — <https://ai.google.dev/gemini-api/docs/pricing> (page footer: last updated 2026-07-21).
**OpenAI** — <https://developers.openai.com/api/docs/pricing>.

USD per 1M tokens, paid tier:

| Model | Input | Cached input | Output | Batch in/out | Cache storage |
|---|---|---|---|---|---|
| `gemini-3.1-flash-lite` | **0.25** | 0.025 | **1.50** | 0.125 / 0.75 | $1.00 /1M tok/hr |
| `gemini-3.1-pro-preview` | **2.00** (≤200k) | 0.20 | **12.00** | 1.00 / 6.00 | $4.50 /1M tok/hr |
| `gemini-2.5-pro` | 1.25 | 0.125 | 10.00 | 0.625 / 5.00 | $4.50 /1M tok/hr |
| `gemini-embedding-001` | 0.15 | — | — | 0.075 | — |
| `gpt-4.1-mini` | **0.40** | 0.10 | **1.60** | 0.20 / 0.80 | — |
| `gpt-4o-mini` | 0.15 | 0.075 | 0.60 | 0.075 / 0.30 | — |
| `text-embedding-3-small` | **0.02** | — | — | 0.01 | — |
| `text-embedding-3-large` | 0.13 | — | — | 0.065 | — |
| `gemini-2.0-flash` / `-flash-lite` | **RETIRED 2026-06-01** | | | | |

Audio input on `gemini-3.1-flash-lite` is $0.50/1M (2× text). Not modelled — voice transcription is
route-only and not reachable from the message pipeline (`AI_CALL_GRAPH.md` §4).

**Batch API is not usable for this workload.** Both providers' batch tiers are 50% off but are
asynchronous with a multi-hour SLA. Every model call in EasyModerator is on the synchronous path of a
customer reply. The only batchable workload is bulk product re-embedding, whose total cost is
$0.0004 per 200-product reindex — the discount is worth $0.0002.

## 2. Free tier

`gemini-3.1-flash-lite` has a free tier; `gemini-3.1-pro-preview` does not. **The cost model assumes
100% paid-tier usage.** A project on the free tier is rate-limited in a way that would drop customer
replies, so treating free-tier headroom as margin would be modelling a service outage as a saving.
Any promotional Google Cloud or OpenAI credit is a one-off balance-sheet item and is excluded from
contribution margin — track it separately.

## 3. Foreign exchange

| Item | Value |
|---|---|
| Rate used | **1 USD = 123.40 BDT** |
| As of | 2026-07-22 (spot close 123.425, rounded) |
| Source | Bangladesh Bank / TradingEconomics USD-BDT; 2026 YTD average 122.44, July range 123.27–123.43 |
| Stored at | `src/modules/ai/pricing-table.json` → `fx` |

BDT figures are **derived**, never independently sourced. Provider invoices settle in USD; a BDT card
or PSP adds roughly 1.5–3% FX margin on top, which is *not* included in the AI cost lines and is
handled separately in the contribution-margin section.

## 4. Measured token counts

### 4.1 Assembled prompts — [T], Gemini `countTokens` on the real `buildSystemPrompt()` output

Fixture: `scripts/ai-cost/fixture-bd-merchant.js` — 30 products, 12 FAQs, 4 knowledge chunks, a
10-turn Bengali/Banglish history, COD-only shop with Steadfast connected. Fully synthetic; no
production data, no PII.

| Component | Tokens |
|---|---|
| Base system prompt (persona + operating context + business info, 0 FAQ) | **1 087** |
| System prompt, **text** path, top-5 relevant FAQs | **1 251** |
| System prompt, **image** path, full FAQ dump, 12-FAQ shop | **1 508** |
| System prompt, **image** path, full FAQ dump, 50-FAQ shop (`MAX_FAQ_IN_PROMPT` cap) | **2 554** |
| Grounding block: 2 products + 2 RAG chunks | 376 |
| Grounding block: 5 products + 4 RAG chunks (production limits) | **746** |
| History, 4 / 8 / 10 turns | 75 / 134 / 182 |
| Customer message: short / expected / long | 6 / 25 / 59 |
| Reply: short / typical / long | 45 / **63** / **127** |
| Sentiment system prompt | 176 |
| Vision extraction prompt (intent-router) | 138 |
| Product-AI attribute prompt | 189 |
| Product embedding document | **106** |
| FAQ embedding document | 60 |

### 4.2 Live billing metadata — [P], real `generateContent` / `chat.completions` calls, 2026-07-28

```json
{ "label": "gemini_lite_text_expected_turn", "model": "gemini-3.1-flash-lite",
  "usageMetadata": { "promptTokenCount": 2155, "candidatesTokenCount": 60,
                     "promptTokensDetails": [{ "modality": "TEXT", "tokenCount": 2155 }],
                     "serviceTier": "standard" } }

{ "label": "gemini_lite_text_expected_turn_REPEAT",
  "usageMetadata": { "promptTokenCount": 2155, ... } }      ← identical; NO cachedContentTokenCount

{ "label": "gemini_lite_vision_extraction_1image",
  "usageMetadata": { "promptTokenCount": 1215, "candidatesTokenCount": 59,
                     "promptTokensDetails": [{ "modality": "IMAGE", "tokenCount": 1064 },
                                             { "modality": "TEXT",  "tokenCount": 151 }] } }

{ "label": "explicit_cache_create_configured_model", "model": "gemini-2.0-flash",
  "httpStatus": 400,
  "error": "Cached content is too small. total_token_count=1998, min_total_token_count=4096" }

{ "label": "openai_fallback_text_expected_turn", "model": "gpt-4.1-mini",
  "usage": { "prompt_tokens": 2125, "completion_tokens": 34,
             "prompt_tokens_details": { "cached_tokens": 0 },      ← FIRST run
             "completion_tokens_details": { "reasoning_tokens": 0 } } }

// Re-run of the identical prompt ~40 minutes later:
{ "label": "openai_fallback_text_expected_turn",
  "usage": { "prompt_tokens": 2125,
             "prompt_tokens_details": { "cached_tokens": 1920 } } }   ← 90% CACHE HIT
```

**Cross-check:** the component-wise sum for the expected turn is 1 251 + 746 + 134 + 25 = **2 156**;
Google billed **2 155**. A one-token gap across a four-part assembly is what makes the component model
usable for shapes that were not individually probed.

### 4.3 Image tokenization — [P]

`gemini-3.1-flash-lite`, default `media_resolution` (the code never sets it):

| Resolution | Tokens |
|---|---|
| 384 × 384 | **1 090** |
| 640 × 640 | 1 090 |
| 720 × 960 | **1 064** |
| 1080 × 1440 | 1 064 |
| 1600 × 1200 | 1 064 |

**Downscaling does not reduce Gemini image cost — a 384×384 thumbnail costs 2.4% *more* than a
1600×1200 original.** This directly contradicts the documented "258 tokens if ≤384 px" formula, which
describes Gemini 2.x behaviour; Gemini 3.1 Flash-Lite allocates a flat ~1 065–1 090 tokens per image
at its default media resolution. Measured behaviour governs the model.

`gpt-4.1-mini` behaves the opposite way — image tokens scale with resolution:

| Resolution | `prompt_tokens` (incl. ~40 text) | Implied image tokens |
|---|---|---|
| 512 × 512 | 469 | ~429 |
| 1080 × 1440 | 2 533 | ~2 493 |

So compression is worth nothing on the customer-message path (Gemini) and worth **~5.8×** on the
product-upload path (which forces OpenAI at `product-ai.service.js:66`).

### 4.4 Cached input tokens

**Zero on every production call.** Three independent confirmations:

1. Explicit cache creation 400s on the size floor (4 096 tokens vs a 1 087–2 554-token prompt).
2. `gemini-cache.service.js:80` swallows that 400 and returns `null`, so the caller always sends the
   full prompt.
3. Two identical live calls both reported `promptTokenCount: 2155` with the `cachedContentTokenCount`
   field absent — implicit caching did not engage.

**OpenAI behaves the opposite way, and it is measurable.** The first probe reported
`cached_tokens: 0`; the identical prompt re-sent later in the same audit reported
**`cached_tokens: 1920` of 2 125** — a 90% automatic cache hit billed at $0.10/1M instead of
$0.40/1M. Both runs are in `evidence/provider-usage-metadata.json`. On the same prompt:

| | Cold | Warm |
|---|---|---|
| `gpt-4.1-mini` fallback turn | $0.000978 | **$0.000402** |
| `gemini-3.1-flash-lite` primary turn | $0.000659 | $0.000659 (never caches) |

A warm OpenAI fallback is **39% cheaper than the Gemini primary**. The cost model uses the **cold**
figure everywhere, because a rare fallback is unlikely to find a warm cache. That is deliberately
conservative — a shop failing over for a sustained period would do better than modelled — and it
materially strengthens the case for reordering the failover chain (backlog O-2).

## 5. Behavioural assumptions — [S]

| # | Assumption | Value | Rationale / how to verify |
|---|---|---|---|
| S-1 | A "20-message conversation" is 10 customer messages + 10 AI replies | — | Given in the audit brief |
| S-2 | 1 of the 10 customer messages is a pure greeting | 0 model calls | `isPlainGreeting` regex, `intent-router.js:81` |
| S-3 | 1–2 messages are handled by the deterministic order-flow | 0 model calls | `order-flow.service.js` |
| S-4 | 4 of 10 messages in scenario B exceed 30 chars without a sentiment keyword | 4 sentiment calls | `sentiment.service.js:183-196`. Sensitive: see §6 |
| S-5 | Typical reply length | 80 output tokens | Measured samples 27 / 63 / 127; 80 sits between "typical" and "long" |
| S-6 | Scenarios B and C include one customer rephrase of an unhelpful answer | +1 full-price turn | **There is no regenerate button in the product** (grepped frontend + backend). This models the real-world equivalent: the customer asks again. Conservative. |
| S-7 | Baseline provider fallback rate | 5% of conversations | **No telemetry exists.** Modelled at 0 / 5 / 10 / 25% |
| S-8 | Products added per merchant per month | 15 | No production data available |
| S-9 | Product edits per merchant per month | 30 | No production data available |
| S-10 | Merchant catalogue size | 30 products, 12 FAQs | Matches the brief's "20–50 products" |
| S-11 | Marginal infrastructure per conversation | $0.00002 | §6 below |
| S-12 | Fixed infrastructure | $48/mo, amortised over 25 merchants = $1.92/merchant | Droplet size is **[U]**; $48 is the DigitalOcean `s-4vcpu-8gb` list price, the smallest plausible host for 7 containers incl. Postgres + Qdrant |
| S-13 | PSP fee 2.5%, VAT 15% | applied only in the contribution-margin break-even | Bangladesh standard VAT; bKash MDR is indicative |

## 6. Infrastructure attribution

Everything — Caddy, backend, worker, frontend, Postgres 15, Redis 7, Qdrant — runs in one
`docker-compose.prod.yml` stack on one DigitalOcean droplet at a **fixed** monthly price. There is no
per-request infrastructure billing, so the marginal cost of one more conversation is only its
durable footprint:

| Component | Per conversation | Basis |
|---|---|---|
| Postgres rows (`conversations` + ~20 `messages`) | ~1.5 KB | Row sizes from `20260520_000_initial_schema.js` |
| Qdrant | **0 new vectors** | Query-only; conversations are never embedded |
| Redis | ~6 short-lived keys (dedup 24 h, burst ~30 s, intent cache 30 min) | `message-worker.js:292`, `burst-coalescer.js:43` |
| Meta attachment download | ~200 KB per image, inbound | `safe-media-fetch.js`, 8 MB cap |
| Outbound egress to providers | image bytes re-uploaded as base64 (~1.33× the file) per model call | `llm.service.js:40-73` |
| Logging | a handful of lines | container stdout, no external ingest |

At DigitalOcean block-storage rates this rounds to well under $0.00002/conversation; the model uses
$0.00002 as a deliberately generous ceiling. **Infrastructure is not a driver at this scale** — at
1 000 conversations/month it is $0.02.

Storage growth is the real long-run item and it is a *fixed-cost* question, not a variable one:
30 products × 384-dim float32 ≈ 46 KB of vectors per merchant. A thousand merchants is ~46 MB.

## 7. Unknowns — [U]

| # | Unknown | Impact | How to close it |
|---|---|---|---|
| U-1 | Value of the `EMBEDDING_PROVIDER` GitHub secret | Decides whether embeddings cost $0 (local) or $0.02/1M (OpenAI). **Financially negligible either way** — the delta is $0.000002 per conversation — but it decides whether RAG retrieval works at all | `GET /health/detailed` → `embedding.semantic` (needs an admin token; returned 401 during this audit) |
| U-2 | Actual production fallback rate | Between 5% and 25% the expected-case margin moves 63.2% → 59.2% | Enable `AI_USAGE_ACCOUNTING=true` and read `fallbackSequence` |
| U-3 | Actual reply-length distribution | ±25% on output tokens ⇒ ±5% on conversation cost | Same |
| U-4 | Real messages-per-conversation and burst-coalescing ratio | Sets calls per billable conversation | Same |
| U-5 | Droplet size and current DigitalOcean spend | Sets the fixed-infra allocation | DO billing console |
| U-6 | Whether a failed/timed-out Gemini call is billed | Worst-case retry path assumes it is | Compare the provider console's token counter against the ledger over a week |
| U-7 | `media_resolution` default for `gemini-3.1-flash-lite` | If settable to `low`, image tokens could fall well below 1 064 | Test `generationConfig.mediaResolution` on a probe call |
| U-8 | Real merchant image-per-conversation distribution | Images are the #1 driver | Same telemetry |

## 8. What is deliberately excluded

- **Meta / WhatsApp conversation fees.** Out of scope for AI cost; the shop pays Meta separately.
- **Courier, SMS, email (Resend), and push costs.** Not AI-triggered.
- **Development and test traffic.** Non-zero but not merchant-attributable. The four probe calls run
  during this audit cost roughly $0.002 in total.
- **Internal admin / evaluation calls.** No admin-triggered model path exists in the codebase.
- **AI product-suggestion, PDF/document parsing, onboarding starter-FAQ generation.** Searched for;
  **no such code path exists**. Knowledge documents are ingested as plain text with no parsing step
  (`auto-index.job.js:116-124`).
- **Reranking, moderation, translation, and query-rewriting models.** None are implemented. The
  "safety" layer (`guardrail.service.js`, `prompt-sanitizer.service.js`,
  `hallucination-detector.service.js`, `confidence-gate.service.js`) is entirely rule-based and makes
  **zero** model calls — verified by grepping every one of those files for `chat(` and `fetch(`.
