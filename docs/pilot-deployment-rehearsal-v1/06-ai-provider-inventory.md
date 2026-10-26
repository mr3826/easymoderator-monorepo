# 06 — AI provider inventory

## Existing adapters

EasyModerator already contains direct server-side HTTP integrations. This rehearsal adds no SDK, adapter, router, or provider. The main conversational contract is in EasyMod-backend/src/modules/ai/llm.service.js:

1. Gemini 3.1 Flash-Lite is the primary path.
2. Gemini 3.1 Pro Preview is available for explicit high-stakes preference or configured escalation; automatic escalation is not the default.
3. OpenAI GPT-4.1 mini is the final fallback.

The code reads Gemini from EM-GEMINI-KEY or GEMINI_API_KEY and OpenAI from OPENAI_API_KEY. The requested Windows variable EM_GEMINI_KEY is not the exact source name; EM_OPENAI_KEY is not read by this adapter. User/process presence was checked by name only. No real value was mapped into the rehearsal.

Separate source paths use Gemini embedding-2 with an optional OpenAI embedding fallback, and an older Gemini 1.5 Flash voice-processing model. Model IDs differ across legacy tier-selection and voice paths, so the shared LLM model list is not the whole model inventory.

## Workload map

| Workload | Existing provider/model | Inputs and output | Business authority | Failure fallback | Unit cost |
|---|---|---|---|---|---|
| Customer message understanding and Bangla/Banglish normalization | Shared LLM route: Gemini Flash-Lite, optional Pro, then OpenAI GPT-4.1 mini | Conversation context and customer text; free-form or application-validated output | Application policy and tenant context; a model response does not authorize a material action | Provider error path and application fallback; no business action from model output alone | UNKNOWN without input/output token telemetry |
| Product and variant extraction; grounded product questions; reply drafting; knowledge-gap assistance | Shared LLM route above, with product/RAG context where enabled | Merchant catalog/retrieval evidence plus customer message; response text or parsed intent | Catalog/RAG grounding and deterministic response/action checks | Safe no-answer or response fallback when retrieval/provider fails | UNKNOWN per valid completed task |
| Structured-choice interpretation | Existing signed choice payload and database state plus worker resolver | Opaque token or typed-number reply; resolver state transition | Persisted SENT choice, per-shop feature check, and Action Gate for commerce mutations | Reject, skip, or safe fallback | No separate model call required for a valid token |
| Product/customer image understanding | Gemini photo-match/vision path, feature-gated | Product or customer image and associated prompt | Product matching is advisory; order/payment/courier authority remains deterministic | Disabled or no-result path | Not estimated; image tokens and retries were not measured |
| Embeddings and semantic retrieval | Configurable Gemini or OpenAI path; Gemini embedding-2 is the code default in the embedding service | Query or document text; vectors | Retrieval supplies evidence but does not itself authorize a claim/action | Existing fallback/provider status reporting | UNKNOWN; accounting is disabled by default |
| Voice transcription/processing | Legacy Gemini 1.5 Flash path | Audio and task-specific prompt; parsed text/result | Application confirmation and policy checks | Feature/key gating and error response | UNKNOWN |
| Support escalation classification | Shared LLM/intent path where invoked | Conversation text; classification/structured intent | Human workflow and explicit support-case action gate | Manual review or no-op | UNKNOWN |
| Internal evaluation/research | Separate Product Experience evaluation tools, not a production router | Synthetic fixtures unless separately authorized | Evaluation only | No production side effect | No live evaluation performed |

The table records application source paths, not verified live traffic. No merchant transcript, image, audio, or personal data was sent to a provider during this task.

## Contract fit

Both providers are technically already supported, but the application uses its current direct REST contracts rather than every new provider capability. OpenAI Chat Completions sends free-form messages and max_tokens. Gemini generateContent sends prompt content and temperature. The request code does not use a provider-enforced JSON schema or tool call as business authority. Application validation and deterministic gates must remain in control.

Existing tests cover response parsing, fallback ordering, fake provider responses, cost-helper behavior, and feature flags. They do not establish quality for Bangla/Banglish merchant tasks or cost per successful task. No speculative model comparison was run.

## Model lifecycle caveat

Official Google model lifecycle pages checked on 2026-10-27 identify the primary Gemini 3.1 Flash-Lite alias as stable/GA with an earliest shutdown date of 2027-05-07, and identify the Pro model as preview. The source also retains Gemini 1.5 Flash in the voice path (shut down 2025-09-29) and Gemini 2.0 Flash in a legacy tier-selection module (shut down 2026-06-01). Runtime reachability of those legacy paths was not established. See 08-gemini-api-evaluation.md before enabling voice or legacy tier-based model paths.
