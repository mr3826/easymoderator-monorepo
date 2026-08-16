# Gemini-First Provider Routing

**Date** 2026-07-28 · **verdict: Gemini is primary everywhere after one correction.**
One path made OpenAI a forced primary provider; it is removed. The expensive Gemini tier is
removed from the *automatic* chain and retained for explicit escalation.

---

## 1. The chain

**Before** (`llm.service.js` at `cee9822`):

```
gemini-3.1-flash-lite  →  gemini-3.1-pro-preview  →  gpt-4.1-mini
```

**After:**

```
gemini-3.1-flash-lite  →  gpt-4.1-mini
        │
        └── gemini-3.1-pro-preview reachable only via preferredProvider: 'gemini-pro'
            (explicit escalation), or by setting LLM_AUTO_ESCALATE_TO_PRO=true
```

Two measured reasons, either of which is sufficient:

**It cannot serve a request.** On the current free Gemini project,
`gemini-3.1-pro-preview` returns HTTP 429 `GenerateContentInputTokensPerModelPerDay-FreeTier
limit=0` — 8 of 8 attempts. Not throttled; unavailable. As tier 2 it added a guaranteed
failed round-trip in front of every OpenAI fallback, on the customer's critical path.

**It is the wrong response to a transient error.** On a *paid* project it costs **8× the
input and 8× the output** of the primary. A 500 or a rate-limit blip does not justify an
8× model — that is an escalation decision, not a retry strategy. Per-message costs at
`pricing-table.json` v2026-07-28.1:

| Path | Cost/message | vs primary |
|---|---|---|
| `gemini-3.1-flash-lite` (primary) | $0.000770 | 1.0× |
| `gemini-3.1-pro-preview` | $0.005383 | **7.0×** |
| `gpt-4.1-mini` cold cache | $0.001089 | 1.4× |
| `gpt-4.1-mini` warm prompt cache | $0.000402 | **0.52×** |

`gpt-4.1-mini` is the better fallback on cost *and* availability. A live probe measured
`cached_tokens: 1920` of 2,125 on a warm repeat, i.e. OpenAI's automatic prompt caching
does engage — making the fallback tier *cheaper than the primary* on a repeated system
prompt. Gemini's caching does not engage at all
([PROMPT_CACHING_DECISION.md](PROMPT_CACHING_DECISION.md)).

`LLM_AUTO_ESCALATE_TO_PRO=true` restores the three-tier chain in one env var, and is worth
revisiting after the paid-key migration.

## 2. When Gemini escalation is justified

`preferredProvider: 'gemini-pro'` is honoured unconditionally, so the escalation door
stays open. Per the brief, it should be used only when:

- the request is genuinely complex;
- confidence is low (`confidence-gate.service` already computes this);
- the cheaper model failed a quality check (`hallucination-detector.service`);
- order or policy accuracy requires it;
- the plan or admin configuration explicitly authorises it.

**None of these are wired up today.** No caller passes `preferredProvider: 'gemini-pro'`
except the `model_preset` mapping in §4. Confidence-gated escalation is a reasonable
future feature and is in the backlog; it is deliberately *not* added here, because adding
an automatic escalation trigger is exactly the change that turns a sustainable plan into a
loss-making one, and it needs a cost ceiling designed with it.

## 3. Audit: every provider call in the repository

| Call site | Provider | Verdict |
|---|---|---|
| `intent-router._callLlm` — main reply | chain default (Gemini first) | ✅ |
| `intent-router` Stage-2 FAQ branch | chain default | ✅ |
| `intent-router._extractProductAttributes` | chain default | ✅ vision-gated off |
| `image-product-matcher.matchViaVision` | `preferredProvider: 'gemini-lite'` | ✅ vision-gated off |
| `llm.service.transliterateWithLlm` | chain default | ✅ |
| `sentiment.service` | chain default | ✅ |
| `product-ai.service.processProduct` | **was `preferredProvider: 'openai'`** | ❌ → **fixed** |
| `embedding.service.getOpenAiEmbedding` | OpenAI, only when `EMBEDDING_PROVIDER=openai` | ⚠️ see below |
| `bert-client.service` | local BanglaBERT service, no provider | ✅ |
| `clip-client.service` | local CLIP service, no provider | ✅ vision-gated off |

**`product-ai.service.js:66` was the only OpenAI-primary path in the codebase.** It pinned
`preferredProvider: 'openai'` with the comment *"GPT-4o for vision"* on every product
create and update. It is gone: attributes now derive from text
(AI_ARCHITECTURE_VALIDATION.md §3), and the vision fallback, when explicitly enabled, uses
the standard Gemini-first chain — Gemini is multimodal, so the override bought nothing even
on its own terms.

Guarded by a repo-wide scan in `gemini-first-routing.test.js` §C, which fails if
`preferredProvider: 'openai'` reappears in any non-comment source line, and asserts the
`PROVIDERS` array order is exactly `['gemini-lite', 'gemini-pro', 'openai']`.

**No parallel calls, no unconditional secondary calls.** `chat()` is a strictly sequential
`for` loop that returns on the first success.

### Embedding routing

`EMBEDDING_PROVIDER=openai` would make OpenAI the **normal** embedding provider, which the
locked decisions rule out.

**Resolved 2026-08-16.** `embedding.service.js` now implements Gemini as the production
primary and OpenAI as an observable fallback. `EMBEDDING_PROVIDER=gemini` calls
`getGeminiEmbedding` first and invokes OpenAI only after that request fails. The
`GEMINI_EMBEDDING_MODEL` secret that has existed since 2026-03-13 is now read by code, and
`.env.prod.example` defaults to it. The explicit `openai` provider remains available for
isolated migration proof and controlled rollback validation; it is not the production
default.

The model is **`gemini-embedding-2`**, not the `gemini-embedding-001` that
[RETRIEVAL_QUALITY_EVALUATION.md](RETRIEVAL_QUALITY_EVALUATION.md) suggested. Measured
against the live API on 2026-08-16: at `outputDimensionality=384`, `gemini-embedding-2`
returns an L2-normalised vector (‖v‖ = 1.0000) while `gemini-embedding-001` does not
(‖v‖ ≈ 0.456), which breaks any dot-product scoring. Both truncate cleanly to the existing
384-dimension Qdrant collection. Cross-lingual behaviour on shop data is the reason this is
worth having at all: cos("লাল সুতির শাড়ি", "red cotton saree") = 0.86 against
cos("লাল সুতির শাড়ি", "motorcycle engine oil") = 0.44.

Switching provider changes the vector space — run `node src/scripts/reindex-qdrant.js`
against a separately validated collection after the cutover or existing points stay
unmatchable. The migration proof therefore validates Gemini and OpenAI in separate
collections and never mixes provider vectors into the live collection.

## 4. `model_preset: 'advanced'`

**Validated in code.** `ai-chatbot.controller.js` mapped `model_preset === 'advanced'`
straight to `preferredProvider: 'gemini-pro'`, routing **every** message through the 7×
model. At the 350-conversation plan ceiling that is roughly **৳1,386/month of AI against a
৳999 plan** — loss-making before any other cost.

**Exposure is narrower than it looks**, which is worth stating plainly:

| Surface | Can it set `model_preset`? |
|---|---|
| `PUT /shop/ai-settings` | **No** — `updateAISettings` destructures a fixed field list that omits it |
| Frontend | **No** — no reference anywhere in `EasyMod-frontend/src` |
| Admin service | No |
| `shop-defaults.js` | Defaults to `'standard'` |

So no merchant can reach it today. It is one direct DB write away from being live, though,
with no cost control between the field and the 7× model.

**Decision — keep the concept, gate it at the point of use.** `BASE_FEATURES` gains
`advanced_model_preset: false`, no plan grants it, and the controller resolves `advanced`
to `gemini-pro` only when `planHasFeature(planCode, 'advanced_model_preset')` is true.

- Existing merchant settings are **preserved**, not migrated or deleted — a shop with
  `model_preset: 'advanced'` keeps the value and simply resolves to `standard`.
- The downgrade is **logged at warn** with the shop id and plan code, so it is visible
  rather than silent.
- Failure to read the subscription **denies** — an unreadable plan must not hand out the
  loss-making route.
- The concept survives for a future premium tier: flip one flag on a plan whose price
  covers it.

## 5. Cost impact

The fallback path is the only cost that moves. At the modelled 5% fallback rate:

| | fallback → `gemini-pro` (before) | fallback → `gpt-4.1-mini` (after) |
|---|---|---|
| fallback message | $0.005383 | $0.001089 |
| heavy conversation | $0.015659 → | **$0.007290** |
| 350 conv/month, heavy, 5% | — | **$2.6391** → GM 67.4% |
| 350 conv/month, heavy, 25% | — | GM 63.4% |

A 25% fallback rate now costs less than a 5% rate did before. This is the change that makes
the provider-outage scenario boring: an all-day Gemini outage moves an expected merchant
from $2.24 to about $3.4/month, still inside a 999 BDT plan.

## 6. Tests

`src/modules/ai/__tests__/gemini-first-routing.test.js` — 17 tests:

- healthy path uses `gemini-lite`, OpenAI is never contacted;
- a `gemini-lite` failure goes **straight** to OpenAI, asserting `gemini-pro` is absent;
- `LLM_AUTO_ESCALATE_TO_PRO=true` restores the three-tier chain;
- an explicit `preferredProvider: 'gemini-pro'` is still honoured;
- a free-tier `RESOURCE_EXHAUSTED` 429 falls through and is answered by OpenAI;
- a project-wide 429 still answers;
- quota 429s increment the breaker's failure counter, so sustained exhaustion opens the
  circuit rather than retrying forever;
- all-providers-fail throws rather than returning empty text;
- repo scan: no `preferredProvider: 'openai'`, `PROVIDERS` order pinned;
- vision policy: off by default, image blocks stripped, no `inlineData` reaches a provider;
- the Gemini context cache is created for the model that will serve the request.
