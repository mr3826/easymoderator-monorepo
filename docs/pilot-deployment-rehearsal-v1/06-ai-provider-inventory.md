# 06 — AI provider inventory

## Existing adapters

EasyModerator already contains direct server-side HTTP integrations. This rehearsal adds no SDK, adapter, router, or provider. The main conversational contract is in EasyMod-backend/src/modules/ai/llm.service.js. The model IDs below are source defaults; effective deployed IDs can be overridden by `LLM_GEMINI_LITE_MODEL`, `LLM_GEMINI_PRO_MODEL`, and `LLM_OPENAI_MODEL` in `.env.prod`. That file was absent from both checked worktrees and no runtime configuration was available, so effective production models are UNKNOWN.

1. Gemini 3.1 Flash-Lite is the primary path.
2. Gemini 3.1 Pro Preview is available for explicit high-stakes preference or configured escalation; automatic escalation is not the default.
3. OpenAI GPT-4.1 mini is the final fallback.

The code reads Gemini from EM-GEMINI-KEY or GEMINI_API_KEY and OpenAI from OPENAI_API_KEY. The requested Windows variable EM_GEMINI_KEY is not the exact source name; EM_OPENAI_KEY is not read by this adapter. User/process presence was checked by name only. No real value was mapped into the rehearsal.

Separate source paths use Gemini embedding-2 with an optional OpenAI embedding fallback, and an older Gemini 1.5 Flash voice-processing model. Model IDs differ across legacy tier-selection and voice paths, so the shared LLM model list is not the whole model inventory.

## Workload map

| Workload | Existing provider/model | Inputs and output | Business authority | Failure fallback | Unit cost |
|---|---|---|---|---|---|
| Customer message understanding and Bangla/Banglish normalization | Shared LLM route: Gemini Flash-Lite, optional Pro, then OpenAI GPT-4.1 mini | Conversation context and customer text; free-form or application-validated output | Application policy and tenant context; a model response does not authorize a material action | Provider error path and application fallback; no business action from model output alone | UNKNOWN without input/output token telemetry |
| Product and variant extraction; grounded product questions; reply drafting; knowledge-gap assistance | Shared LLM route above, with product/RAG context where enabled | Merchant catalog/retrieval evidence plus customer message; response text or parsed intent | Catalog/RAG grounding and deterministic response/action checks | Some provider failures fall through to keyword matching without outage provenance; see provider-failure section | UNKNOWN per valid completed task |
| Structured-choice interpretation | Existing signed choice payload and database state plus worker resolver | Opaque token or typed-number reply; resolver state transition | Persisted SENT choice, per-shop feature check, and Action Gate for commerce mutations | Reject, skip, or safe fallback | No separate model call required for a valid token |
| Customer-photo product extraction | Shared LLM chain: Gemini Flash-Lite by source default, optional Gemini Pro, then OpenAI GPT-4.1 mini by source default | Customer image plus scrubbed customer text | Product matching is advisory; order/payment/courier authority remains deterministic | OpenAI can receive the image after Gemini failure when its source-contract key is configured; no-result only after all providers fail | No cost per valid task is verified; dated photo estimates conflict with the July cost audit. |
| Merchant product-image and other vision paths | Shared provider chain when enabled | Merchant product image or image-to-product matching input | Retrieval/matching is advisory; deterministic business gates remain authoritative | `AI_VISION_ENABLED` defaults false; when enabled, preferred Gemini does not remove OpenAI fallback | Not estimated; image tokens and retries were not measured |
| Embeddings and semantic retrieval | Configurable Gemini or OpenAI path; Gemini embedding-2 is the code default in the embedding service | Query or document text; vectors | Retrieval supplies evidence but does not itself authorize a claim/action | Existing fallback/provider status reporting | UNKNOWN; accounting is disabled by default |
| Voice transcription/processing | Legacy Gemini 1.5 Flash path | Audio and task-specific prompt; parsed text/result | Application confirmation and policy checks | Feature/key gating and error response | UNKNOWN |
| Support escalation classification | Shared LLM/intent path where invoked | Conversation text; classification/structured intent | Human workflow and explicit support-case action gate | Manual review or no-op | UNKNOWN |
| Internal evaluation/research | Separate Product Experience evaluation tools, not a production router | Synthetic fixtures unless separately authorized | Evaluation only | No production side effect | No live evaluation performed |

The table records application source paths, not verified live traffic. No merchant transcript, image, audio, or personal data was sent to a provider during this task.

## Cost-document discrepancy

The existing cost records do not agree on customer-photo vision. `docs/ai-cost/AI_COST_ASSUMPTIONS.md` has a 2026-08-03 revision saying customer-photo matching shipped ON and models an approximately $0.0008 increase per expected conversation at three photo messages. `docs/ai-cost/AI_COST_AUDIT.md` §0, dated 2026-07-28b, says no AI vision exists and reports no image-token cost. The rehearsal source has a separate default-on `AI_PHOTO_MATCH_ENABLED` extraction path, so the July audit's zero-image claim and generated photo rows are stale for this code SHA. The August estimate is a scenario from a dated cost model, not verified economics for the effective deployed flags, model overrides, or provider fallback mix. The assumption register also says in one older row that image cost requires `AI_VISION_ENABLED=true`, which conflicts with its own August customer-photo revision. Reconcile these artifacts against the deployed source/config and observed usage before using them for commercial decisions.

The assumptions register records a synthetic measurement of about 1,064 Gemini image tokens per photo. At the current published paid-tier Flash-Lite input price of $0.25 per million tokens, that image-token component is approximately $0.000266 per photo, or $0.000798 for its three-photo scenario. This excludes prompt and output tokens, retries, fallback-provider use, and any other charges. It assumes that exact Gemini model and paid pricing; account tier and effective production configuration are unknown. See [Google's Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Customer-image route and privacy boundary

`AI_PHOTO_MATCH_ENABLED` defaults to true in the production renderer. The worker can pass a customer image to `_extractProductAttributes`, which calls shared `llmService.chat` with the original `image_url` and no provider exclusion. The default chain tries Gemini Flash-Lite and then OpenAI; when `LLM_AUTO_ESCALATE_TO_PRO` is enabled, Gemini Pro can precede OpenAI. The OpenAI adapter converts the image URL to inline image data. If Gemini attempts fail and a usable `OPENAI_API_KEY` is configured, customer-image data can therefore be sent to OpenAI. This is source reachability, not observed traffic; no provider call or customer data was used here.

The Compose overlay explicitly sets `AI_PHOTO_MATCH_ENABLED=false` and `AI_VISION_ENABLED=false` for backend. Worker receives the ignored `.env.pilot-rehearsal` file; at this check, its two image-flag values were also `false`. The worker was not started, so this is config-input evidence, not runtime proof. `AI_VISION_ENABLED=false` also strips images from the later reply call, but does not disable the separate default-on customer-photo extraction path in production. Existing tests cover generic provider fallback and image extraction separately, but not Gemini failure followed by an OpenAI request containing the image. Keep photo matching off for a real-customer pilot until provider image-data terms and owner authorization are confirmed. If the required policy is Gemini-only image handling, the source must exclude OpenAI for image-bearing extraction and add a synthetic regression test before enabling it.

There is a second, independent image-triggered order path. `order-flow.service.js` calls `image-product-matcher.service.js` when a customer message contains purchase intent and an image URL. This path does not check `AI_PHOTO_MATCH_ENABLED`. With `AI_VISION_ENABLED=false`, CLIP and Gemini Vision are skipped, but text-only RAG over the accompanying message still runs; a RAG hit returns a fixed confidence of `0.82`, and the order-flow caller accepts any nonempty product list without checking confidence. In this branch the image bytes are not used by RAG or sent to a provider, but the image-triggered order path can still select catalog products from the text alone. **Inference:** a generic phrase such as “order korbo” could select an unsupported candidate if the vector search returns a hit. Existing order-flow tests mock the matcher and do not calibrate the RAG result or prove both image flags disable this path. If the pilot must suppress image-triggered product selection, this separate path needs an explicit source gate and synthetic regression before use.

## Contract fit

Both providers are technically already supported, but the application uses its current direct REST contracts rather than every new provider capability. OpenAI Chat Completions sends free-form messages and max_tokens. Gemini generateContent sends prompt content and temperature. The request code does not use a provider-enforced JSON schema or tool call as business authority. Application validation and deterministic gates must remain in control.

The source comment that the current Gemini project has zero Pro quota is account-specific historical context, not verified account evidence. Billing, entitlement, model overrides, and effective deployed model IDs remain unknown. Do not use source comments or source defaults as a substitute for the deployed configuration.

## Provider failure and merchant-visible state

The circuit breaker emits an `llm_outage` SSE event, but the frontend `useInboxSSE` hook does not subscribe to it and its tests contain no outage-event case. The circuit-breaker text says AI replies are paused when one provider circuit trips, while the LLM chain can still attempt another configured provider. The accompanying Slack alert is best-effort; delivery to an assigned operator was not verified.

The actual Messenger worker calls `AIChatbotController.processNewIntent`. When the intent router fails, that controller can fall through to keyword matching and persist a response without provider-failure provenance. The fallback keywords include `price`, `cost`, `দাম`, and `কত`; a match starts an order session and returns confidence `0.75`. New shops default to `MANUAL`, but the AUTO confidence gate holds only values strictly below the default threshold `0.75`, so this fallback can pass the gate if AUTO is enabled. In MANUAL, the draft can still appear without a clear outage label. Existing tests do not cover a provider outage followed by a Bangla/Banglish price question or assert the merchant-visible fallback state.

Keep pilot reply mode at `MANUAL`. Before any AUTO mode, require synthetic outage tests for Bangla/Banglish price and order questions, a clearly identified safe clarification or human handoff instead of a misleading order prompt, and an outage signal visible to a named operator. These are source-review findings and test gaps; no live UX or outage behavior was exercised here.

## Bangladesh merchant-quality evidence

The code has synthetic tests for Bangla/Banglish product, price, stock, and variant intents, plus grounded handling for unsupported facts. These test the contract and fixtures, not natural-language quality from current providers. The V1.3 product-quality proof belongs to ancestor `33ca2b76…`, with 26 AI/product files changed between that commit and this candidate; its scores are adjacent evidence, not exact-candidate results. Its held-out dataset repeats 10 generic turns across 14 personas and has no livestream/comment-selling cases. Customer usefulness remains unmeasured. The image sample did not score exact SKU identity; separate text-RAG matching uses a fixed `0.82` confidence and has no calibrated image-to-SKU test. No provider comparison, real merchant evaluation, or live inference was performed. Do not claim current provider quality or Bangladesh merchant usefulness from these fixtures.

Existing tests cover response parsing, fallback ordering, fake provider responses, cost-helper behavior, and feature flags. They do not establish quality for Bangla/Banglish merchant tasks or cost per successful task. No speculative model comparison was run.

## Model lifecycle caveat

Official Google model lifecycle pages checked on 2026-10-27 identify the primary Gemini 3.1 Flash-Lite alias as stable/GA with an earliest shutdown date of 2027-05-07, and identify the Pro model as preview. The source also retains Gemini 1.5 Flash in the voice path (shut down 2025-09-29) and Gemini 2.0 Flash in a legacy tier-selection module (shut down 2026-06-01). Runtime reachability of those legacy paths was not established. See 08-gemini-api-evaluation.md before enabling voice or legacy tier-based model paths.
