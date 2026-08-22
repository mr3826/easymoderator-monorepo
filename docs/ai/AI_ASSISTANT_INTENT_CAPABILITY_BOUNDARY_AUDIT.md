# EasyModerator AI Assistant Intent, Capability and Boundary Audit

**Audit date:** 2026-08-21<br>
**Audited checkout:** `easy-moderator` on branch `main`<br>
**Scope:** Current repository code, current deployment configuration, tests, and current operational documentation. Sibling checkouts under `D:\easymod` were not treated as product evidence.

## Evidence Rules

This report uses the following labels:

- `VERIFIED`: directly reachable code and supporting evidence were found.
- `PARTIALLY VERIFIED`: the path exists, but a material gate, caller, or failure case is incomplete.
- `INFERRED`: supported by current deployment/configuration structure, but the live secret value or runtime state is not in the repository.
- `NOT FOUND`: no production call edge was found after searching the active repository.
- `CONTRADICTED`: code, tests, configuration, or documentation disagree.
- `UNKNOWN`: the repository cannot establish the fact.

Repository paths below are relative to `D:\easymod\easy-moderator` unless otherwise stated. Secret values were not copied into this report.

## 1. Executive Summary

The production-reachable customer assistant is a **Facebook Page Messenger DM worker**, not a general-purpose multi-channel chatbot and not a free-form autonomous planner.

It currently:

- receives signed Facebook Messenger webhook events;
- persists customers, 24-hour conversations, messages, consent, and durable webhook receipts;
- coalesces rapid customer messages into one queued AI turn;
- detects greetings, product questions, order-number status queries, purchase intent, active checkout steps, sentiment escalation, and deterministic fallback cases;
- retrieves shop-scoped catalog, FAQ, business, payment, and delivery context;
- uses Gemini/OpenAI text generation and optional image/embedding paths;
- applies a deterministic grounding gate before a response can be sent;
- applies consent, opt-out, Meta window/tag, content, business-hours, rate, automation-mode, and channel gates;
- stores a draft or sends through the Facebook Graph API; and
- after the checkout confirmation predicate returns true, creates a real order and asynchronously attempts courier booking. The predicate is broader than an explicit-confirmation requirement.

The assistant is therefore **Level 4, Transactional Agent, with important partial boundaries**. The Level 4 classification is based on the live worker reaching `createOrderInternal()` and `deliveryService.createDeliveryOrder()`, not on the existence of unused agent-like services. There is no evidence of Level 5 autonomous planning: no production function-calling registry, arbitrary tool selection, or model-controlled multi-step planner was found. The order-flow summary says to type `YES`, but `extractConfirmation()` accepts broad substrings, including one-character `y`, so the confirmation boundary is not reliable.

The most important boundary findings are:

1. The checkout confirmation predicate can create an order without merchant approval. The order-flow mutation runs before the outbound policy gate, so Draft, consent/window, business-hours, and rate gates do not protect the deterministic mutation. `allow_order_creation`, `max_auto_order_value`, and several required-field settings are stored but not enforced on this path. `EasyMod-backend/src/jobs/message-worker.js:408-427,501-527,724-780`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:684-721,1270-1283`; `EasyMod-backend/src/modules/channel-providers/meta-channel-settings.entity.js:55-60`; `EasyMod-backend/src/modules/shop/shop.controller.js:436-464`.
2. The assistant can return order status, payment status, delivery status, and tracking code for a matching bare numeric legacy/imported order number in the current shop; it does not bind the lookup to the requesting customer's PSID. Current generated order numbers are alphanumeric. `EasyMod-backend/src/modules/ai/intent-router.service.js:220-247`; `EasyMod-backend/src/modules/order/order.service.js:46-61`.
3. The product grounding boundary is strong for catalog existence, price, stock, known/unknown product attributes, product URLs, and product-image provenance, but general merchant claims remain partly prompt-governed. The deterministic gate accepts all numbers in `sourceText`, which includes persona examples such as delivery-day examples. `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:69-85,244-274`; `EasyMod-backend/src/modules/ai/intent-router.service.js:891-905,697-710`.
4. Worker retries are configured, but the 24-hour deduplication key is claimed before AI, grounding, policy, and provider work and is not released on failure. A failed provider send can therefore be retried and then skipped as a duplicate. `EasyMod-backend/src/jobs/message-worker.js:387-391,812-823`; `EasyMod-backend/src/jobs/message-queue.js:37-44`.
5. The live system is Facebook-only. Instagram, WhatsApp, Telegram customer chat, comment automation, cold outreach, and broadcast campaigns are not production capabilities. `EasyMod-backend/src/modules/channel-providers/provider.registry.js:11-36`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:489-500`; `README.md:24-30`.

## 2. Agent Classification

| Level | Finding | Evidence |
|---|---|---|
| Level 0 - Generative responder | Rejected. The assistant reads live shop/catalog data and can execute mutations. | `EasyMod-backend/src/modules/product/product-search.service.js:103-135`; `EasyMod-backend/src/modules/order/order.service.js:286-435` |
| Level 1 - Grounded assistant | Verified. Product, FAQ, business, payment, and delivery context are retrieved or rebuilt before generation. | `EasyMod-backend/src/modules/ai/intent-router.service.js:403-451,603-700`; `EasyMod-backend/src/modules/ai/shop-operating-context.service.js:58-100` |
| Level 2 - Intent-aware assistant | Verified, but no single canonical intent namespace exists. Deterministic routing, regexes, SQL matching, BERT labels, and LLM generation coexist. | `EasyMod-backend/src/modules/ai/intent-router.service.js:199-379`; `EasyMod-backend/src/modules/ai/bert-client.service.js:10-13`; `EasyMod-backend/src/modules/conversation/order-flow.service.js:34-105` |
| Level 3 - Tool-using assistant | Verified in the application sense. The worker invokes deterministic services, but the LLM cannot choose arbitrary tools. | `EasyMod-backend/src/jobs/message-worker.js:501-552,756-811`; no function/tool dispatcher in `EasyMod-backend/src/modules/ai/llm.service.js:194-260` |
| Level 4 - Transactional agent | **Verified, partial.** Customer confirmation can create an `Order`, deduct stock, track usage, notify the merchant, and trigger courier booking. | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:684-817,1081-1118,1144-1213`; `EasyMod-backend/src/modules/order/order.service.js:286-435` |
| Level 5 - Autonomous workflow agent | Not found. The sequence is hardcoded; no model planning loop, arbitrary tool allowlist, or autonomous workflow planner is reachable. | `EasyMod-backend/src/modules/ai/llm.service.js:81-260`; `EasyMod-backend/src/jobs/message-worker.js:501-823` |

**Final classification:** `Level 4 - Transactional Agent`, constrained by deterministic workflows and policy gates. It is not a Level 5 autonomous agent.

## 3. AI Architecture

### Production customer path

```text
Facebook Messenger DM
  -> Caddy public rewrite
  -> POST /api/webhooks/meta
  -> HMAC verification and durable Meta receipt
  -> CONNECTED Facebook Page -> shop resolution
  -> customer/conversation/message transaction
  -> consent and STOP handling
  -> Redis/BullMQ burst-flush job
  -> message-processing worker
  -> dedup / HITL / manual pause / mode / channel / billing gates
  -> sentiment escalation or deterministic order-flow
  -> AIChatbotController.processNewIntent()
  -> intent-router stages
       cache -> order-number lookup -> greeting -> BERT greeting -> SQL FAQ -> LLM/RAG
  -> live product evidence + Qdrant/FAQ knowledge + operating context
  -> Gemini/OpenAI candidate generation
  -> deterministic grounding gate
  -> confidence gate
  -> outbound policy engine
  -> Meta provider registry
  -> Facebook Graph /me/messages
  -> stored delivery metadata, SSE, policy decision and grounding telemetry
```

Evidence: `Caddyfile:66-70`; `EasyMod-backend/src/app.js:114-132,204-209`; `EasyMod-backend/src/modules/integration/meta-webhook.routes.js:108-170`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:291-400,481-585`; `EasyMod-backend/src/jobs/message-worker.js:335-859`.

Production runs a separate API and BullMQ worker container. The compose file names the worker command as `node src/jobs/worker.js`; that process starts the queue manager and the message worker. `docker-compose.prod.yml:53-95`; `EasyMod-backend/src/jobs/worker.js:24-42`; `EasyMod-backend/src/jobs/queue-manager.js:124-130`.

### Other AI-triggering paths

These are production-reachable or code-reachable AI-adjacent paths, but they are not all part of the customer assistant:

| Trigger | Path | Status |
|---|---|---|
| Merchant creates or updates a product | Product service -> `queueProductProcessing()` -> text-derived product search metadata -> embedding; optional product-image vision only when `AI_VISION_ENABLED=true`. | `VERIFIED`; `EasyMod-backend/src/modules/product/product.service.js:254-264,339-348`; `EasyMod-backend/src/modules/product/product-ai.service.js:52-113,181-223` |
| Merchant uploads tabular product content | Authenticated `/api/product/ai-extract` -> deterministic delimiter/parser -> pending AI-labelled product objects; no LLM call. | `VERIFIED` as a deterministic import, not generative AI; `EasyMod-backend/src/modules/product/product.routes.js:9-16`; `EasyMod-backend/src/modules/product/product.controller.js:158-180`; `EasyMod-backend/src/modules/product/product.service.js:675-723` |
| Merchant calls `/api/rag/ingest` or `/api/rag/query` | Authenticated RAG controller overwrites body shop ID with JWT shop ID; ingest rejects a missing shop, but query does not explicitly reject a missing JWT shop and can reach the base collection without a filter. | `PARTIALLY VERIFIED` merchant RAG API; `EasyMod-backend/src/modules/rag/rag.routes.js:7-16`; `EasyMod-backend/src/modules/rag/rag.controller.js:7-50`; `EasyMod-backend/src/modules/rag/rag.service.js:244-259,373-379` |
| Merchant calls `/api/voice/transcribe` | Authenticated manual transcription -> direct Gemini 1.5 Flash -> transcript response. | `VERIFIED` transcription only; it does not enqueue the customer AI worker. `EasyMod-backend/src/modules/ai/voice-processing.routes.js:18-32`; `EasyMod-backend/src/modules/ai/voice-processing.controller.js:21-48` |
| Merchant calls `/api/sentiment/analyze` | Authenticated keyword/LLM sentiment classification -> JSON result. | `VERIFIED` read-only analysis; `EasyMod-backend/src/modules/ai/sentiment.routes.js:12-21`; `EasyMod-backend/src/modules/ai/sentiment.controller.js:16-41` |
| Manual Qdrant reindex | `npm run reindex:qdrant` -> source contract -> Qdrant. | `VERIFIED` operational path; not a scheduled customer-facing AI trigger. `EasyMod-backend/package.json:24`; `EasyMod-backend/src/modules/knowledge/index-source.contract.js:5-165` |
| Scheduled auto-index | `auto-index.job.js` exists but is not registered in `queue-manager.js`. | `IMPLEMENTED_BUT_UNREACHABLE` as a scheduled job; `EasyMod-backend/src/modules/knowledge/auto-index.job.js:37-110`; `EasyMod-backend/src/jobs/queue-manager.js:41-56,133-207` |
| Facebook comments, Instagram, WhatsApp, Telegram customer updates | No registered customer provider or active handler. | `NOT FOUND`; `EasyMod-backend/src/modules/channel-providers/provider.registry.js:11-45`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:489-500` |

## 4. AI Entry Points

| Trigger | Handler/controller | Service/worker | AI/router | Action/output | Evidence/status |
|---|---|---|---|---|---|
| Signed Meta Page webhook with `messaging[]` text or attachment | `metaWebhookRoutes` -> `handlePageWebhook()` -> `processMessagingEvent()` | `storeIncomingMessage()` -> `processInboundConsent()` -> `dispatchMessageJob()` | `message-worker.processMessageJob()` | Draft, handoff, or Meta reply; order path can mutate order state. | `VERIFIED`; `EasyMod-backend/src/modules/integration/meta-webhook.routes.js:108-170`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:481-585` |
| STOP/unsubscribe inbound message | `processInboundConsent()` | `consentService.recordOptOut()` and `cancelBurstFlush()` | AI is not called | Customer opt-out, consent audit event, no AI dispatch. | `VERIFIED`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:216-247`; `EasyMod-backend/src/modules/consent/consent.service.js:36-55,163-185` |
| Burst flush/retry | BullMQ `message-processing` worker | `processMessageJob()` | Same router; dedup happens first | One coalesced turn, or skipped/retried/DLQ. | `VERIFIED`; `EasyMod-backend/src/jobs/burst-coalescer.js:61-179`; `EasyMod-backend/src/jobs/message-worker.js:358-391,880-909` |
| Merchant opens inbox and sends a message | Authenticated `POST /conversation/:conversationId/messages` | `conversationService.createMessage()` -> `deliverViaMetaIfApplicable()` | No customer-intent LLM call | Human/business message is stored and delivery is attempted; the controller omits policy `settings`, so `draftMode` defaults to `DRAFT` and can deny delivery. AI pause is still written for 30 minutes. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/conversation/conversation.routes.js:68-79`; `EasyMod-backend/src/modules/conversation/conversation.controller.js:227-301,450-478`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:20-27` |
| Merchant toggles HITL | Authenticated conversation PATCH | `updateConversation()` -> escalation auto-reply | No classifier required | Sets HITL, attempts a holding message, and blocks worker; the handoff delivery path passes raw channel settings rather than effective shop-plus-channel settings and can default to Draft denial. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/conversation/conversation.controller.js:498-550,227-301`; `EasyMod-backend/src/modules/conversation/human-handoff.service.js:81-108`; `EasyMod-backend/src/jobs/message-worker.js:393-406`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:20-27` |
| Product create/update | Authenticated product route | `product.service` -> `queueProductProcessing` | Optional product vision; text-derived fields by default; embedding | Updates `ai_*` search fields and Qdrant product point. | `VERIFIED` background AI enrichment; `EasyMod-backend/src/modules/product/product-ai.service.js:52-113,181-223` |
| Product import upload | Authenticated product route | `extractProductsFromContent()` | No model; parser and confidence heuristic | Returns transient `pending`, `ai_generated` objects for merchant review. | `VERIFIED` deterministic, `EasyMod-backend/src/modules/product/product.service.js:665-723` |
| Manual voice transcription | Authenticated `/api/voice/transcribe` | `VoiceProcessingController.transcribe()` | Direct Gemini `gemini-1.5-flash` | Returns transcript only; does not modify the message or enqueue AI. | `VERIFIED` isolated path; `EasyMod-backend/src/modules/ai/voice-processing.controller.js:21-48`; `EasyMod-backend/src/modules/ai/voice-processing.service.js:154-228` |
| Manual sentiment analysis | Authenticated `/api/sentiment/analyze` | `sentiment.controller` -> `analyzeSentiment()` | Keywords then LLM for ambiguous text | Returns sentiment and escalation boolean; does not mutate conversation. | `VERIFIED` read-only; `EasyMod-backend/src/modules/ai/sentiment.controller.js:16-41` |
| Merchant RAG API | Authenticated `/api/rag/*` | `rag.controller` -> `rag.service` | Embedding/Qdrant | Ingest binds to the JWT shop; query can reach the base collection if the JWT has no shop ID. | `PARTIALLY VERIFIED` merchant tool surface, not an LLM tool; `EasyMod-backend/src/modules/rag/rag.routes.js:7-16`; `EasyMod-backend/src/modules/rag/rag.controller.js:40-50`; `EasyMod-backend/src/modules/rag/rag.service.js:244-259,299-421` |

## 5. Canonical Intent Registry

### Registry qualification

There is no single canonical, persisted intent identifier on the live Meta path. The worker does not set `Conversation.intent`; it stores order-flow and grounding metadata instead. `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:355-364`; `EasyMod-backend/src/jobs/message-worker.js:620-641`.

The following names are audit-level canonical names for observed production branches. They are not claimed to be persisted application enum values. BanglaBERT advertises labels such as `availability_query`, `price_query`, `order_intent`, `size_query`, `payment_intent`, `delivery_query`, `return_query`, `greeting`, and `other`, but only high-confidence `greeting` changes routing. `EasyMod-backend/src/modules/ai/bert-client.service.js:10-13`; `EasyMod-backend/src/modules/ai/intent-router.service.js:270-287`.

### Customer intents

#### `stop_opt_out`

- **Purpose:** Customer asks EasyModerator to stop messaging.
- **Trigger:** Exact STOP/unsubscribe phrases in `consentService.isStopKeyword()`.
- **Inputs:** Current message text; resolved shop, customer, channel, message ID.
- **Context:** Current Facebook channel and customer consent JSON.
- **Retrieval:** None.
- **AI involvement:** None.
- **Deterministic logic:** `recordOptOut()`; cancel pending burst.
- **Action:** Suppress AI dispatch.
- **Side effect:** Update customer consent and append consent audit event.
- **Confidence requirement:** None.
- **Human approval:** Not required.
- **Fallback:** Consent failure returns `shouldDispatch: true`, so the message can continue through AI; `PARTIALLY VERIFIED`.
- **Evidence:** `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:216-247`; `EasyMod-backend/src/modules/consent/consent.service.js:36-55,163-185`.

#### `greeting`

- **Purpose:** Respond to a pure greeting.
- **Trigger:** Tight regex greeting fast path; high-confidence BERT `primaryIntent === 'greeting'`.
- **Inputs:** Short message and detected language.
- **Context:** Shop ID for cache/evidence; no catalog required.
- **Retrieval:** None for the template response.
- **AI involvement:** No generative LLM on the template paths; the BERT greeting path still invokes an AI classifier.
- **Deterministic logic:** Language-specific template and optional first-turn disclosure.
- **Action:** Generate/store a greeting candidate, then send or hold under mode/policy.
- **Side effect:** AI message row, policy decision, possible outbound Meta message.
- **Confidence requirement:** `0.95` regex or `0.90` BERT; first-turn disclosure has its own conditions.
- **Human approval:** Only in Draft/low-confidence/non-delivering modes.
- **Fallback:** If router fails, legacy keyword fallback also recognizes greetings.
- **Evidence:** `EasyMod-backend/src/modules/ai/intent-router.service.js:147-160,253-287`; `EasyMod-backend/src/jobs/message-worker.js:695-717`.

#### `order_status_lookup`

- **Purpose:** Return current order, payment, delivery, and tracking fields.
- **Trigger:** A bare 5-8 digit number in a non-image message. Current generated order numbers are `ORD-<shop-prefix>-<sequence>`, so this branch primarily covers legacy/imported numeric order numbers.
- **Inputs:** Order number; shop ID.
- **Context:** Current shop only. Customer PSID is not used to authorize the lookup.
- **Retrieval:** PostgreSQL `orders` row by `{ shop_id, order_number }`.
- **AI involvement:** None; exact-match response.
- **Deterministic logic:** Formats order status, payment status, delivery status, and tracking code.
- **Action:** Read-only reply.
- **Side effect:** Process-local response cache for the formatted line.
- **Confidence requirement:** `1.0`.
- **Human approval:** Not required.
- **Fallback:** DB failure falls through to later routing; no explicit safe status error.
- **Hard boundary:** Shop-scoped but not customer-scoped; a guessed legacy/imported numeric order number can expose another customer in the same shop. `PARTIALLY VERIFIED`.
- **Evidence:** `EasyMod-backend/src/modules/ai/intent-router.service.js:220-249`.

#### `product_inquiry`

- **Purpose:** Answer product existence, price, stock, variant, size, color, material, category, or product-photo questions.
- **Trigger:** Product language, product terms, product attributes, or any non-closed-set message that reaches product search; deterministic product evidence decides whether generation is needed.
- **Inputs:** Current text, optional image URLs, shop ID, language, recent history.
- **Context:** Current shop catalog; active/non-deleted rows; product variants and media; current operating context.
- **Retrieval:** PostgreSQL product search, optional semantic Qdrant product candidates re-fetched live by ID, product evidence resolver.
- **AI involvement:** LLM only when deterministic evidence does not settle the response; product-photo extraction can call Gemini.
- **Deterministic logic:** Conjunctive identifying-term verification; explicit `NONE`, `VERIFIED`, `NOT_FOUND`, and `RETRIEVAL_FAILED`; live price/stock/fact table.
- **Action:** Read/recommend facts; candidate may be auto-sent in `AI_ACTIVE` after gates.
- **Side effect:** AI message, cache only for non-product-fact responses, grounding/policy logs.
- **Confidence requirement:** Deterministic product replies use `1.0`; generated replies use router confidence and the shop threshold.
- **Human approval:** Required for Draft, low confidence, grounding suppression, or policy denial.
- **Fallback:** Not-found and unknown-attribute deterministic copy; retrieval failure holding/handoff; weak/empty knowledge does not authorize product claims.
- **Hard boundary:** No product, price, stock, variant, unknown attribute, URL, or image may be asserted without evidence; general merchant claims are less completely validated.
- **Evidence:** `EasyMod-backend/src/modules/ai/intent-router.service.js:383-451,615-677,772-827`; `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:315-376`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:185-283`.

#### `product_photo_lookup`

- **Purpose:** Identify a customer-sent product photo against the current shop catalog.
- **Trigger:** Messenger image attachment; the first image in a coalesced burst is examined.
- **Inputs:** First image URL, caption, shop ID.
- **Context:** Current shop catalog and optional live vector/vision state.
- **Retrieval:** Text/RAG first for sparse caption; optional CLIP and vision tiers; all product IDs are re-read under shop scope.
- **AI involvement:** Customer-photo attribute extraction is on by default; final reply is text-only unless `AI_VISION_ENABLED=true`.
- **Deterministic logic:** `AI_PHOTO_MATCH_ENABLED` kill switch, first-photo limit, live product re-fetch, grounding media provenance.
- **Action:** Identify product and answer; may attach only that verified product image.
- **Side effect:** AI response and grounding metadata; no product/catalog mutation.
- **Confidence requirement:** Matcher returns tier confidence, but grounding and global confidence gates still control generated output.
- **Human approval:** Draft/low-confidence/policy cases require human review.
- **Fallback:** No match asks for product name; extraction failure tells model it cannot see or uses caption; vision/CLIP failure falls through.
- **Hard boundary:** Customer photo is not proof that the shop sells the item; no substitute image or Page URL is allowed.
- **Evidence:** `EasyMod-backend/src/modules/ai/intent-router.service.js:520-594`; `EasyMod-backend/src/modules/ai/image-product-matcher.service.js:36-45,93-228`; `EasyMod-backend/src/modules/ai/vision-policy.service.js:7-23,37-60`.

#### `faq_knowledge_policy_question`

- **Purpose:** Answer shop-specific FAQ, delivery, payment, return, business, and policy questions.
- **Trigger:** SQL token overlap against active shop FAQs; otherwise full LLM/RAG path.
- **Inputs:** Current text, shop ID, language, shop knowledge, operating context.
- **Context:** Active FAQ rows, business info, owner additional info, links, live payment/courier settings, up to 50 FAQ prompt entries.
- **Retrieval:** PostgreSQL FAQ token matching; Qdrant non-product snippets; business-info vectors are excluded because live context is injected separately.
- **AI involvement:** FAQ branch and full branch use LLM text generation; no semantic classifier is required.
- **Deterministic logic:** SQL token score acceptance at `>= 0.3` or two hits; live operating context overrides stale FAQ text in the prompt.
- **Action:** Read-only answer, potentially auto-sent.
- **Side effect:** FAQ usage counter increment, cache, message, policy decision; knowledge gaps on low/unknown responses.
- **Confidence requirement:** FAQ score becomes returned confidence; global shop threshold applies to generated responses in auto mode.
- **Human approval:** Required in Draft/low confidence/policy denial.
- **Fallback:** FAQ DB failure falls through to full LLM; knowledge retrieval failure becomes empty additive context; unknown answer can be held/handoff.
- **Hard boundary:** Merchant-specific facts absent from retrieved/live context must not be invented, but the gate does not validate every natural-language claim.
- **Evidence:** `EasyMod-backend/src/modules/ai/intent-router.service.js:290-379,686-710`; `EasyMod-backend/src/modules/knowledge/knowledge.service.js:545-615`; `EasyMod-backend/src/modules/ai/shop-operating-context.service.js:68-95`.

#### `general_chat_or_unknown`

- **Purpose:** Handle greetings, acknowledgements, or general questions not settled by deterministic product/FAQ logic.
- **Trigger:** Full LLM path after cache/order/greeting/FAQ stages, or keyword fallback after router failure.
- **Inputs:** Current message, up to ten prior turns, system prompt, language, shop context.
- **Context:** Conversation continuity, but earlier assistant messages are explicitly not evidence.
- **Retrieval:** May include product search, knowledge snippets, and operating context depending on the message.
- **AI involvement:** Gemini/OpenAI text generation.
- **Deterministic logic:** Language detection, closed-set chatter, confidence and grounding gates.
- **Action:** Generate a conversational answer or clarification.
- **Side effect:** Message row, grounding/policy decision, optional send.
- **Confidence requirement:** Global shop threshold in auto mode; fallback response is confidence `0` and is held.
- **Human approval:** Required when low confidence, suppressed, Draft, or policy denied.
- **Fallback:** Primary router failure uses keyword/static fallback; all LLM providers failing produces a generic holding response.
- **Hard boundary:** There is no broad deterministic fact validator for unsupported non-numeric merchant claims.
- **Evidence:** `EasyMod-backend/src/modules/conversation/ai-chatbot.controller.js:303-457`; `EasyMod-backend/src/jobs/message-worker.js:541-572,643-677`.

#### `purchase_intent_start`

- **Purpose:** Start checkout when the customer signals a decision to buy.
- **Trigger:** Conservative purchase phrases such as `want to order`, `order korbo`, `nibo`, Bengali equivalents; status/order-number hints suppress this branch.
- **Inputs:** Message, shop ID, customer channel ID, platform, optional image URLs, extracted entities.
- **Context:** Shop-scoped product search, customer identity, live stock, language.
- **Retrieval:** `searchForOrder()` never falls back to arbitrary catalog rows; image matching can identify a photo product.
- **AI involvement:** None for the step-machine; image matching may call vision/RAG.
- **Deterministic logic:** Product match required; ambiguous/no product asks the customer to identify the product.
- **Action:** Create an active `OrderSession` or return a product-needed/out-of-stock response.
- **Side effect:** `order_sessions` row.
- **Confidence requirement:** `1.0` deterministic response.
- **Human approval:** Not required to start a session.
- **Fallback:** Product not found asks for name/photo; order-flow error returns safe unavailable response rather than letting the LLM claim an order started.
- **Hard boundary:** Product browsing/price questions do not start this bridge under the primary deterministic path; legacy keyword fallback is broader when the router fails. The pattern matcher does not exclude negation, so text such as `I don't want to order ...` can still match `want to order`.
- **Evidence:** `EasyMod-backend/src/modules/conversation/order-flow.service.js:30-105,148-252`; `EasyMod-backend/src/modules/product/product-search.service.js:307-341`.

#### `order_session_checkout`

- **Purpose:** Conduct a multi-turn order workflow and create an order when the checkout confirmation predicate returns true.
- **Trigger:** Active `OrderSession.status === 'ACTIVE'` or a started purchase session.
- **Inputs:** Product selection, quantity, customer name, Bangladesh phone, address, zone, payment method, notes, confirmation/edit text.
- **Context:** Durable `order_sessions.step_data`, shop, customer channel, live catalog, delivery zones, payment configuration.
- **Retrieval:** Live stock and price, shop delivery zones, enabled payment gateways, RTO checks.
- **AI involvement:** None for normal steps; optional image product matching and MFS OCR.
- **Deterministic logic:** Step machine; active session bypasses conversational LLM and confidence hold.
- **Action:** Collect data; on confirmation call `createOrderInternal()`.
- **Side effect:** Order row, order items, stock deduction, usage event, customer enrichment, invoice text, merchant notification, courier dispatch attempt.
- **Confidence requirement:** Always `1.0`; order-flow turns bypass the confidence hold.
- **Human approval:** The UI intends to require explicit customer confirmation of the final summary, but the implementation uses substring matching and can accept unrelated text containing `y`, `yes`, `din`, or another confirmation fragment. Merchant approval is not required by the active path.
- **Fallback:** Stock/COD/RTO/subscription/business errors return a customer-facing reason or generic failure; invoice/closing failures do not undo a created order.
- **Hard boundary:** The deterministic mutation runs before the outbound policy engine, so outbound consent/window/business-hours/rate/Draft gates do not protect it. `DRAFT`, `allow_order_creation`, `max_auto_order_value`, and `required_fields` do not gate the order mutation. The confirmation predicate is also overbroad. `CONTRADICTED` against the intended Draft/approval semantics.
- **Evidence:** `EasyMod-backend/src/jobs/message-worker.js:501-527,643-655`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:684-817`; `EasyMod-backend/src/modules/order/order.service.js:286-435`.

#### `order_session_cancel`

- **Purpose:** Cancel an active, not-yet-created checkout session.
- **Trigger:** Exact/regex cancellation phrases while an active session exists.
- **Inputs:** Current message, session ID, shop ID.
- **Context:** Active session scoped by shop and customer channel.
- **Retrieval:** None.
- **AI involvement:** None.
- **Deterministic logic:** `cancelSession()` sets session status `CANCELLED`.
- **Action:** Return cancellation confirmation.
- **Side effect:** Update `order_sessions`; no existing `Order` is changed.
- **Confidence requirement:** `1.0`.
- **Human approval:** Not required.
- **Fallback:** Cancellation errors are swallowed by the bridge and the customer can still receive a successful cancellation response. `PARTIALLY VERIFIED`.
- **Hard boundary:** This is not existing-order cancellation, refund, or return.
- **Evidence:** `EasyMod-backend/src/modules/conversation/order-flow.service.js:157-175`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:863-876`.

#### `cart_edit_or_add_more`

- **Purpose:** Modify an active pre-order cart before confirmation.
- **Trigger:** `ADD_MORE`, product selection, quantity edits, remove/edit phrases in checkout.
- **Inputs:** Customer text/photo, current cart and session step data.
- **Context:** Active shop-scoped session and live product/stock checks.
- **Retrieval:** Product search and stock checks.
- **AI involvement:** None in the step machine.
- **Deterministic logic:** Cart line parsing, quantity/edit/remove handling, numbered product picker.
- **Action:** Update the session cart and ask the next checkout question.
- **Side effect:** `order_sessions.step_data` only until final confirmation.
- **Confidence requirement:** `1.0` deterministic.
- **Human approval:** No merchant approval; customer must still confirm final summary.
- **Fallback:** Ambiguity returns a numbered picker or re-prompts.
- **Hard boundary:** Does not mutate an existing order.
- **Evidence:** `EasyMod-backend/src/modules/order/order-session-standalone.service.js:374-509,684-817`; tests `EasyMod-backend/src/modules/order/__tests__/order-session-standalone.steps.test.js:232-409`.

#### `self_mfs_payment_verification`

- **Purpose:** Verify a customer-supplied bKash/Nagad/Rocket screenshot during self-MFS checkout.
- **Trigger:** Active session reaches `AWAITING_MFS_SCREENSHOT` and a new image arrives.
- **Inputs:** Screenshot URL, expected amount, expected receiver, MFS type, shop ID, session order reference.
- **Context:** Session payment data and shop self-MFS settings.
- **Retrieval:** Safe media fetch, Gemini OCR, shop-scoped TrxID log.
- **AI involvement:** Gemini vision OCR; deterministic duplicate, amount, receiver, type, fraud, and audit checks.
- **Deterministic logic:** Fail closed on missing fields, invalid status, duplicate TrxID, mismatch, fraud score, or audit write error.
- **Action:** Mark session payment as verified or ask for another screenshot.
- **Side effect:** `TrxIDLog` row on success; session step data on success.
- **Confidence requirement:** OCR confidence contributes to fraud score; no separate merchant confidence gate.
- **Human approval:** Not required for an accepted proof; human review is implied by fraud/rejection text but no automatic support ticket is created here.
- **Fallback:** OCR/verification failure returns a rejection prompt.
- **Hard boundary:** The active code never stores `step_data.total`; the verifier rejects a missing/non-positive expected amount before OCR. It also passes `session.order_id`, while the session model exposes `created_order_id`. The canonical self-MFS checkout therefore cannot successfully verify a screenshot. `CONTRADICTED`/`IMPLEMENTED_BUT_UNREACHABLE` in the intended flow.
- **Evidence:** `EasyMod-backend/src/modules/order/order-session-standalone.service.js:600-670`; `EasyMod-backend/src/modules/payment/self-mfs-handler.service.js:131-157,195-364`; `EasyMod-backend/src/modules/order/order-session.entity.js:70-81`.

#### `sentiment_handoff`

- **Purpose:** Escalate angry or frustrated customers before normal AI generation.
- **Trigger:** Strong keyword classification or ambiguous-message LLM sentiment; `frustrated`/`angry` result.
- **Inputs:** Current coalesced text and shop ID.
- **Context:** Conversation, recipient, originating channel.
- **Retrieval:** Keyword dictionaries; LLM for long ambiguous text.
- **AI involvement:** Sentiment LLM only when keyword/length heuristics do not settle it.
- **Deterministic logic:** `shouldAutoEscalate()` recognizes only `frustrated` and `angry`.
- **Action:** Set HITL, notify merchant, create/send a holding message.
- **Side effect:** Conversation HITL, notification records/jobs, AI holding message, possible outbound message.
- **Confidence requirement:** No explicit threshold for escalation.
- **Human approval:** Human required for final resolution.
- **Fallback:** Sentiment failure sets `negative`, but `shouldAutoEscalate()` does not recognize `negative`; the worker can continue to normal AI. `CONTRADICTED` against the worker's “defaulting to escalation” comment.
- **Hard boundary:** Handoff holding-message delivery is best-effort and non-retrying.
- **Evidence:** `EasyMod-backend/src/jobs/message-worker.js:456-486`; `EasyMod-backend/src/modules/ai/sentiment.service.js:164-218`; `EasyMod-backend/src/modules/conversation/human-handoff.service.js:35-126`.

#### `low_confidence_or_grounding_failure`

- **Purpose:** Hold an uncertain or unsafe AI response and involve a human.
- **Trigger:** Confidence below the shop threshold, `RETRIEVAL_FAILED`, model output invalid, grounding suppression, or selected policy denial.
- **Inputs:** Candidate response, confidence, evidence, mode, conversation, channel.
- **Context:** Shop threshold, automation mode, grounding evidence, consent/policy state.
- **Retrieval:** Depends on the failed or weak product/knowledge source.
- **AI involvement:** Candidate may come from any LLM/provider/cache/FAQ branch; the final decision is deterministic.
- **Deterministic logic:** Grounding `SEND | SAFE_FALLBACK | SUPPRESS`, confidence gate, policy engine.
- **Action:** Store held suggestion, set HITL, send holding message, or store a draft without sending.
- **Side effect:** AI message with `delivered:false`, knowledge gap, HITL, policy decision, notifications.
- **Confidence requirement:** Shop global threshold, default `0.75` in worker gate; deterministic order turns bypass it.
- **Human approval:** Required for the held customer response.
- **Fallback:** Safe deterministic copy for product/retrieval errors; suppression and handoff where no truthful copy exists.
- **Hard boundary:** Holding-message delivery can fail silently from the customer's perspective; `PARTIALLY VERIFIED`.
- **Evidence:** `EasyMod-backend/src/jobs/message-worker.js:597-677`; `EasyMod-backend/src/modules/ai/confidence-gate.service.js:15-70`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:185-229`.

#### `modification_return_complaint_delay`

- **Purpose:** Recognize requests the assistant cannot safely mutate and route them to a human.
- **Trigger:** Keyword fallback only, after the primary intent router throws: `order_modification`, `return_request`, `complaint`, `delay_inquiry`.
- **Inputs:** Current message, shop/conversation/channel/customer context.
- **Context:** Legacy HTTP-controller data passed by the worker.
- **Retrieval:** None for the detection; support ticket storage.
- **AI involvement:** None in the detector; the fallback is reached after AI/router failure.
- **Deterministic logic:** Keyword maps in `detectModificationIntents()`.
- **Action:** Create a `SupportTicket`, mark conversation for human handoff, return holding text.
- **Side effect:** Support ticket and conversation status/message.
- **Confidence requirement:** Static `0.95` response confidence; not a model-calibrated score.
- **Human approval:** Human required; no order mutation occurs.
- **Fallback:** If ticket/handoff creation fails, `processNewIntent()` throws and the worker sends generic low-confidence fallback.
- **Hard boundary:** Existing order update, cancel, return approval, and refund are not AI-accessible.
- **Evidence:** `EasyMod-backend/src/modules/conversation/ai-chatbot.controller.js:381-457,584-671`; no worker call to `orderService.updateOrder/cancelOrder/createReturnRequest` was found.

### Merchant/API intent surface

These are direct authenticated merchant operations, not model-classified customer intents:

| Canonical audit name | Trigger and actual action | AI role | Status/evidence |
|---|---|---|---|
| `merchant_ai_settings_update` | `PUT /api/shop/ai-settings` stores mode, threshold, handoff, fields, and labels. | No model; changes worker behavior. | `PARTIALLY VERIFIED`: authentication and value validation exist, but the route/service does not independently verify current `UserShop` membership/role and `updateShopAiSettings()` ignores `userId`; `EasyMod-backend/src/modules/shop/shop.routes.js:16-18,61-71`; `EasyMod-backend/src/modules/shop/shop.controller.js:408-464`; `EasyMod-backend/src/modules/shop/shop.service.js:360-388` |
| `merchant_channel_settings_update` | PATCH Meta channel settings stores page AI toggle, mode, thresholds, and `allow_order_creation`; the canonical whitelist does not expose `business_hours` even though the entity/rule support it. | No model; worker reads only some fields. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/channel-providers/meta-channel.controller.js:205-273`; `EasyMod-backend/src/modules/channel-providers/meta-channel-settings.entity.js:47-53`; `EasyMod-backend/src/jobs/message-worker.js:408-427,643-655` |
| `merchant_faq_maintenance` | FAQ create/update/delete writes PostgreSQL and syncs/deletes Qdrant points. | No model required; affects future retrieval. | `VERIFIED`; `EasyMod-backend/src/modules/knowledge/knowledge.service.js:252-303` |
| `merchant_document_ingestion` | Document API stores metadata and asynchronously calls RAG ingestion. | Embedding only; no answer/action execution. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/knowledge/knowledge.service.js:354-417` |
| `merchant_rag_query_or_ingest` | Authenticated RAG API read/write. | Embeddings/Qdrant. | `PARTIALLY VERIFIED`, because ingest binds/requires the JWT shop while query does not explicitly reject a missing shop; not an AI-selected tool. `EasyMod-backend/src/modules/rag/rag.controller.js:7-50`; `EasyMod-backend/src/modules/rag/rag.service.js:244-259,373-379` |
| `merchant_product_import_review` | CSV/TSV parser returns `pending` AI-labelled rows; UI approves by creating ordinary products. | No LLM in the import path. | `DRAFT_ONLY`/human approval; `EasyMod-frontend/src/app/components/Products.tsx:205-314` |
| `merchant_voice_transcription` | Authenticated manual audio transcription. | Direct Gemini transcription. | `READ_ONLY`; `EasyMod-backend/src/modules/ai/voice-processing.controller.js:21-48` |
| `merchant_sentiment_analysis` | Authenticated sentiment endpoint. | Keywords plus LLM. | `READ_ONLY`; `EasyMod-backend/src/modules/ai/sentiment.controller.js:16-41` |

## 6. Capability Registry

| Capability | Status | What is actually implemented | Evidence and boundary |
|---|---|---|---|
| General customer conversation | `PARTIAL` | LLM replies, static greetings, clarification, language-specific output, and generic fallback. | `EasyMod-backend/src/modules/ai/intent-router.service.js:253-379,741-760`; unsupported merchant claims are not exhaustively validated. |
| Conversation context | `PARTIAL` | Last ten prior messages are passed; no summarization. | `EasyMod-backend/src/jobs/message-worker.js:97-116`; history omits `source_references`, breaking the intended product attribute follow-up. |
| Bangla, Banglish, English handling | `VERIFIED` | Deterministic language detection and prompt language instruction. | `EasyMod-backend/src/modules/conversation/conversation-state-standalone.service.js:374-433`; `EasyMod-backend/src/modules/ai/intent-router.service.js:953-959` |
| Greeting | `AUTONOMOUS` | Deterministic template can be auto-sent in active mode. | `EasyMod-backend/src/modules/ai/intent-router.service.js:147-160,258-266`; mode/policy still apply. |
| Product search/identification | `AUTONOMOUS` for replies | Shop-scoped SQL search, optional Qdrant candidate retrieval, conjunctive verification, live re-fetch. | `EasyMod-backend/src/modules/product/product-search.service.js:103-135,283-305`; `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:315-376` |
| Current product price | `AUTONOMOUS` for grounded replies | Price read from live PostgreSQL product row, not vector text. | `EasyMod-backend/src/modules/product/product-search.service.js:59-135`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:244-250` |
| Stock/availability | `AUTONOMOUS` for grounded replies | `in_stock`, tracked quantity, active state, and stock checks are read live. | `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:234-258`; `EasyMod-backend/src/modules/product/product-search.service.js:193-205` |
| Variants/sizes/colors/material | `PARTIAL` | Known facts and explicit UNKNOWN handling; attribute-only multi-turn context is broken on the actual worker history. | `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:208-259,380-405`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:309-330` |
| Product image response | `AUTONOMOUS` when proven | Only the verified product-owned HTTPS URL can be attached; no substitute Page URL. | `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:202-223,253-261`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:505-552` |
| Customer photo matching | `PARTIAL` | Default-on extraction and RAG/text matching; optional CLIP/vision tiers are deployment-dependent. | `EasyMod-backend/src/modules/ai/vision-policy.service.js:7-34`; `EasyMod-backend/src/modules/ai/image-product-matcher.service.js:143-228` |
| Product comparison | `NOT_IMPLEMENTED` | No customer-AI comparison intent/tool or comparison workflow found. | No production call edge found in `EasyMod-backend/src/modules/ai` and worker routing. |
| Product recommendation/upsell | `IMPLEMENTED_BUT_UNREACHABLE` by AI | Co-purchase recommendation service exists behind authenticated merchant product routes, but worker/router never invokes it. | `EasyMod-backend/src/modules/product/product-upsell.service.js:26-142`; `EasyMod-backend/src/modules/product/product.routes.js:23-32` |
| FAQ answers | `AUTONOMOUS` for allowed replies | SQL token matching and LLM answer with FAQ source; active FAQ rows are shop-scoped. | `EasyMod-backend/src/modules/ai/intent-router.service.js:290-369`; `EasyMod-backend/src/modules/knowledge/knowledge.service.js:545-615` |
| Business information | `AUTONOMOUS` for prompt-grounded answers | Live shop business info and additional info are injected; business RAG is supplemental. | `EasyMod-backend/src/modules/knowledge/knowledge.service.js:545-566`; `EasyMod-backend/src/modules/ai/intent-router.service.js:988-1005` |
| Payment policy information | `PARTIAL` | Live COD/self-MFS context is built, but context failure returns an empty prompt block. | `EasyMod-backend/src/modules/ai/shop-operating-context.service.js:58-100` |
| Delivery policy information | `PARTIAL` | Prompt states nationwide/courier status; checkout uses configured zones when present but falls back to hard-coded default charges. | `EasyMod-backend/src/modules/ai/shop-operating-context.service.js:86-95`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:885-902,971-999` |
| Custom knowledge documents | `PARTIAL` | API and async ingestion exist; no frontend management surface and ingestion status can be marked indexed after `{ success:false }`. | `EasyMod-backend/src/modules/knowledge/knowledge.service.js:354-417`; `EasyMod-backend/src/modules/rag/rag.service.js:299-342` |
| Order-number status read | `READ_ONLY` | Returns order/payment/delivery/tracking fields for bare numeric legacy/imported order numbers. | `EasyMod-backend/src/modules/ai/intent-router.service.js:220-247`; `EasyMod-backend/src/modules/order/order.service.js:46-61`; customer binding absent. |
| Order information collection | `AUTONOMOUS` | Durable session step machine collects product, quantity, name, phone, address, zone, payment, notes. | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:342-360,511-681` |
| Order creation | `CONFIRMATION_REQUIRED` plus `PARTIAL` | An overbroad confirmation substring triggers real order creation; merchant approval is not required; Draft and outbound policy do not prevent the deterministic mutation. | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:684-721,1270-1283`; `EasyMod-backend/src/jobs/message-worker.js:501-527,724-779` |
| Existing-order update | `HUMAN_ONLY` | Authenticated merchant route exists; no AI call edge. | `EasyMod-backend/src/modules/order/order.service.js:465-550`; no worker/router caller found. |
| Existing-order cancellation | `HUMAN_ONLY` | Authenticated merchant cancellation restores stock; AI only cancels pre-order sessions. | `EasyMod-backend/src/modules/order/order.service.js:846-890`; `EasyMod-backend/src/modules/conversation/order-flow.service.js:157-175` |
| Return/refund request mutation | `HUMAN_ONLY` | Fallback can create a support ticket, not a return/refund mutation. | `EasyMod-backend/src/modules/order/order.service.js:894-917`; `EasyMod-backend/src/modules/conversation/ai-chatbot.controller.js:427-445` |
| Self-MFS payment verification | `IMPLEMENTED_BUT_UNREACHABLE` in the canonical checkout | OCR/fraud/TrxID logic exists, but the active session passes no stored expected total and an undefined order field, so the verifier fails before OCR. | `EasyMod-backend/src/modules/payment/self-mfs-handler.service.js:203-229`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:636-659,1681-1717`; `EasyMod-backend/src/modules/order/order-session.entity.js:75-81` |
| Courier booking | `PARTIAL` | Order confirmation predicate schedules active-provider booking with three in-process attempts; tracking persistence is not called from this path. | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:792-793,1152-1213`; `EasyMod-backend/src/modules/delivery/delivery-tracking.service.js:49-90` |
| Delivery tracking read/update | `IMPLEMENTED_BUT_UNREACHABLE` by customer AI | Tracking service and provider webhooks exist, but no AI intent/tool calls them. | `EasyMod-backend/src/modules/delivery/delivery-tracking.service.js:97-160`; no worker/router call edge found. |
| Customer identification | `AUTONOMOUS`/`PARTIAL` | Inbound PSID maps to shop/channel customer; Meta profile enrichment is best-effort. | `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:316-327`; `EasyMod-backend/src/modules/customer/customer-profile.service.js:80-135` |
| Customer history/profile lookup | `PARTIAL` | Customer and message history exist, but live AI receives message history rather than an authoritative customer/order profile and order status is not identity-bound. | `EasyMod-backend/src/jobs/message-worker.js:97-116`; `EasyMod-backend/src/modules/ai/intent-router.service.js:220-247` |
| Customer CRUD/tags/segmentation/notes | `HUMAN_ONLY` | Merchant services/routes exist; no customer-AI mutation edge. | `EasyMod-backend/src/modules/customer/customer.routes.js`; no worker/router caller found. |
| Human escalation | `AUTONOMOUS` trigger, `HUMAN_ONLY` resolution | Sentiment/grounding/low-confidence can set HITL and notify; human resolves. | `EasyMod-backend/src/modules/conversation/human-handoff.service.js:35-126` |
| Merchant AI settings | `HUMAN_ONLY` | Authenticated merchant controls directly change behavior. | `EasyMod-backend/src/modules/shop/shop.controller.js:408-464` |

## 7. Tool / Action Registry

No formal LLM function-calling registry was found. The rows below are internal service capabilities the deterministic worker can invoke.

| Tool/capability | Read/write | Purpose | Inputs | Side effects | Authorization/tenant control | Reachable by AI? | Evidence |
|---|---|---|---|---|---|---|---|
| Connected channel resolver | Read | Map Meta Page to connected EasyModerator channel/shop. | Page ID, platform. | None. | Page status `CONNECTED`; shop comes from DB, not request body. | Yes, ingress. | `EasyMod-backend/src/modules/integration/meta-channel-resolver.js:20-32`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:555-574` |
| Durable receipt | Write | Preserve inbound event for replay/dedup. | Page ID, event payload. | `meta_webhook_receipts` row. | Dedupe key from Meta MID/hash; payload encrypted. | Yes, ingress. | `EasyMod-backend/src/modules/integration/meta-webhook-receipt.service.js:79-143` |
| Customer/conversation/message storage | Write | Create/update current shop conversation and message. | Shop, channel, sender, text/attachments. | Customer, conversation, message rows; SSE. | Customer and conversation lookup includes shop/channel; receipt channel is trusted. | Yes. | `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:316-400` |
| Consent service | Read/write | Track implicit opt-in, STOP opt-out, last inbound. | Shop, channel, customer, platform. | Customer JSONB and consent audit rows. | Helpers read customer by primary key without shop predicate; caller supplies trusted IDs. | Yes. | `EasyMod-backend/src/modules/consent/consent.service.js:132-228` |
| Product search/live catalog | Read | Find candidates and live price/stock/variants/media. | Shop, query/attributes/product IDs. | None; errors are logged. | SQL always includes `shop_id`; active/non-deleted filter. | Yes. | `EasyMod-backend/src/modules/product/product-search.service.js:103-135,177-205,283-305` |
| Qdrant/RAG query | Read | Retrieve knowledge/product candidates. | Query, limit, shop ID. | Embedding call; no application mutation. | Live customer path supplies shop ID; authenticated merchant `queryData()` does not explicitly reject a missing JWT shop ID, so a missing-shop request can reach an unfiltered base collection. Shared collection adds `shopId` filter only when a shop ID is present. | Yes. | `EasyMod-backend/src/modules/rag/rag.controller.js:40-50`; `EasyMod-backend/src/modules/rag/rag.service.js:244-259,373-421`; `EasyMod-backend/src/modules/ai/intent-router.service.js:403-451` |
| FAQ/business knowledge | Read | Build prompt context and FAQ matches. | Shop ID, current message. | FAQ hit counter on accepted FAQ. | PostgreSQL filters by `shop_id`; cache is per shop. | Yes. | `EasyMod-backend/src/modules/knowledge/knowledge.service.js:545-615`; `EasyMod-backend/src/modules/ai/intent-router.service.js:290-369` |
| Shop operating context | Read | Read current payment/courier facts. | Shop ID. | None. | Shop-scoped DB reads. | Yes. | `EasyMod-backend/src/modules/ai/shop-operating-context.service.js:38-100` |
| Order session | Read/write | Start/resume/advance/cancel checkout state. | Shop, customer channel, session ID, step data. | `order_sessions` mutation. | Session reads/writes include shop ID and customer channel. | Yes. | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:220-359,823-876` |
| Internal order creation | Write | Create order and order items from confirmed session. | Shop ID, customer/order fields, catalog product IDs, idempotency key. | Order row, stock decrement, usage event, notifications. | Product/stock/COD/RTO/subscription guards; deliberately bypasses user auth; no independent customer ownership check. | Yes. | `EasyMod-backend/src/modules/order/order.service.js:286-435,451-458` |
| Payment screenshot verifier | Write | OCR and validate self-MFS payment proof. | Shop, order/session ID, image, expected amount/receiver/type. | `TrxIDLog` on success; session data on success. | Shop-scoped duplicate/fraud checks; order linkage has gaps. | Intended active-session path, but canonical precheck fails before OCR because expected total is not stored. | `EasyMod-backend/src/modules/payment/self-mfs-handler.service.js:195-229`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:636-659` |
| Courier booking | Write/external | Book active courier after order confirmation. | Shop, order delivery payload. | External consignment; emits failure notification. | Requires active connected shop integration; no local durable booking idempotency. Provider-level deduplication from stable merchant identifiers is not verified by this repository audit. | Yes, after the order confirmation predicate returns true. | `EasyMod-backend/src/modules/delivery/delivery.service.js:18-39,103-176`; `EasyMod-backend/src/modules/delivery/providers/provider.registry.js:20-37,56-68,90-102`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:1152-1213` |
| Grounding gate | Read/decision | Decide whether candidate is safe to send. | Candidate, evidence, language, attachments. | Logs decision; no DB mutation in gate itself. | Evidence contains shop owner IDs/URLs; deterministic. | Yes, mandatory worker step. | `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:155-283` |
| Confidence gate | Decision | Hold low-confidence generated replies. | Confidence, mode, threshold, order-flow flag. | Leads to held message/HITL/knowledge gap. | Shop mode/threshold. | Yes. | `EasyMod-backend/src/modules/ai/confidence-gate.service.js:46-70` |
| Policy engine | Decision/write | Consent/window/content/business/rate/mode gate. | Message and shop/customer/channel context. | `policy_decisions` row; may transform text. | Policy context uses shop/customer/channel; persistence failure does not block send. | Yes, mandatory before Meta provider. | `EasyMod-backend/src/modules/policy/policy.engine.js:67-150` |
| Meta Messenger provider | External write | Send text/attachments to originating Page. | Connected channel/token, PSID, normalized message, allowed decision. | Graph API messages; delivery IDs; rate slot. | Provider requires `decision.allow`; encrypted channel token; channel/shop check occurs upstream. | Yes. | `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:448-546` |
| Human handoff | Write/external | Set HITL, notify merchant, send reassurance. | Conversation, shop, channel, recipient, reason. | HITL, notification, holding AI row, possible outbound. | Customer lookup shop-scoped in handoff path; holding delivery best-effort. | Yes. | `EasyMod-backend/src/modules/conversation/human-handoff.service.js:35-126` |
| Knowledge gap capture | Write | Record unanswered/low-confidence questions. | Shop, question, platform, language, source. | `knowledge_gaps` row. | Shop ID supplied by worker; no dedupe key. | Yes, fire-and-forget. | `EasyMod-backend/src/modules/knowledge/knowledge-gap-capture.service.js:30-50`; `EasyMod-backend/src/jobs/message-worker.js:657-692` |

### Existing services not reachable by customer AI

`orderService.updateOrder`, `cancelOrder`, and `createReturnRequest`; customer CRUD; customer-memory writes; courier connection/settings/tracking management; product/category mutation; FAQ/document/business-info writes; response-template CRUD; subscription/billing mutation; Meta OAuth/channel lifecycle; guardrail approval APIs; and product upsell APIs have no production call edge from `message-worker` or `intent-router`. Their existence does not make them assistant tools. Representative evidence: `EasyMod-backend/src/modules/order/order.service.js:465-550,657-917`; `EasyMod-backend/src/modules/product/product.routes.js:29-39`; `EasyMod-backend/src/modules/customer/customer.routes.js`; `EasyMod-backend/src/modules/delivery/delivery.routes.js`; `EasyMod-backend/src/modules/ai/guardrail.service.js:20-180`.

Deterministic checkout/session/payment/courier mutations also run before `policyEngine.evaluateOutbound()`. The worker's earlier HITL/manual/mode/billing guards still apply, but outbound consent, 24-hour window, business-hours, rate-limit, and Draft policy decisions do not authorize or deny those mutations. `EasyMod-backend/src/jobs/message-worker.js:408-427,501-527,724-780`; `EasyMod-backend/src/modules/policy/policy.engine.js:67-104`.

## 8. Autonomy Matrix

`Suggest` means the system can produce a merchant-visible candidate. `Read` means it can obtain authoritative data. `Execute` means the assistant path can cause the listed action. “Customer confirmation” is distinct from merchant approval.

| Capability | Suggest | Read | Execute | Confirmation | Human override | Hard block |
|---|---:|---:|---:|---|---|---|
| Greeting/general response | Yes | Context-dependent | Conditional auto-send | None | HITL/Draft/manual | Mode, confidence, consent, window, policy |
| Grounded product facts | Yes | Yes | Conditional auto-send | None | Held draft/HITL | No verified product, unknown facts, unsupported price/URL/media |
| FAQ/business/policy answer | Yes | Yes | Conditional auto-send | None | Held draft/HITL | Policy, mode, window, and product-claim grounding; there is no universal knowledge-presence hard block |
| Order-number status | No | Yes | Read-only response | None | Human can answer | Only shop/number existence; customer ownership is not checked |
| Start checkout | Yes | Yes | Yes, creates session | Customer purchase phrase/product identification | Human can take over | Product ambiguity, stock, active session errors |
| Continue checkout | Yes | Yes | Yes, mutates session | Customer supplies each field | HITL/manual inbox | Session expiry, invalid data, business errors |
| Create order | No merchant approval | Yes | Yes | **Intended customer confirmation, but substring matching can accept unrelated text** | Human can intervene, but no required merchant approval | Product/stock/COD/RTO/subscription; outbound policy, Draft, `AI_SUGGEST_ONLY`, and `HUMAN_ACTIVE` do not protect the deterministic mutation |
| Cancel active checkout session | No | Yes | Yes | Explicit cancellation phrase | Human can intervene | Session must be active |
| Modify/cancel existing order | Suggestion/ticket only | Merchant API only | No | Human/merchant action | Required | No AI call edge |
| Return/refund | Suggestion/ticket only | Merchant API only | No | Human/merchant action | Required | No AI mutation tool |
| Verify self-MFS screenshot | Yes | Yes | Intended, but canonical flow fails before OCR | Customer supplies screenshot | Possible manual review, not enforced | Missing expected total/order linkage in active session |
| Book courier | No merchant approval | Active provider/settings | Yes, fire-and-forget | Follows the order confirmation predicate | Merchant retry/manual path | No active provider, provider failure; no local durable idempotency/tracking persistence |
| Human handoff | N/A | Conversation state | Yes, sets HITL/notification | No | Human resolution required | Notification/delivery may fail best-effort |
| Merchant AI settings | N/A | Yes | Yes by authenticated request | Merchant request | Authenticated route, but current `UserShop` membership/role is not independently rechecked by the settings service | Auth/validation; `updateShopAiSettings()` and intent-threshold update ignore `userId` |
| Merchant product import | Draft object | Product source | No final product without UI approval | **Merchant approval** | Required | Parser validation; final create is normal product mutation |

## 9. Human-in-the-Loop Boundary

### Automatic escalation triggers

- Customer sentiment `frustrated` or `angry`.
- Generated confidence below shop threshold in auto mode.
- Catalog retrieval failure or unsupported/invalid candidate that cannot be safely rewritten.
- Grounding `SUPPRESS`.
- Explicit merchant HITL toggle.
- Manual agent message pauses AI for 30 minutes.

Evidence: `EasyMod-backend/src/jobs/message-worker.js:393-486,597-677`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:185-229`; `EasyMod-backend/src/modules/conversation/conversation.controller.js:471-478,498-540`.

### What approval means in practice

- **Draft mode:** The generated AI response is stored with `delivered:false` and `held_reason:'draft_mode'`; it is not sent by the worker. `EasyMod-backend/src/jobs/message-worker.js:771-779`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:15-27`.
- **Low confidence:** In auto mode, the AI response is stored as a held suggestion, the conversation is put into HITL, a knowledge gap is recorded, and a holding response is attempted. In Draft, `AI_SUGGEST_ONLY`, or Manual, the confidence gate is a no-op and policy denial stores the draft without this low-confidence HITL branch. The handoff delivery path uses raw channel settings rather than the worker's effective shop-plus-channel settings. `EasyMod-backend/src/modules/ai/confidence-gate.service.js:15-19,25,62-69`; `EasyMod-backend/src/jobs/message-worker.js:643-677,765-779`; `EasyMod-backend/src/modules/conversation/human-handoff.service.js:81-108`.
- **Use this:** The frontend does not call an approval endpoint. It creates a new `agent` message, which is stored and passed to the human-message delivery path. That path omits policy `settings`, so the default `DRAFT` rule can deny delivery. `EasyMod-frontend/src/app/components/inbox/InboxThreadDetail.tsx:258-282`; `EasyMod-backend/src/modules/conversation/conversation.controller.js:227-301,450-478`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:20-27`.
- **Edit and send:** The UI tells the merchant to copy/paste the text; it does not provide a true edit-and-approve mutation. `EasyMod-frontend/src/app/components/inbox/InboxThreadDetail.tsx:258-263`.
- **Ignore/dismiss:** Dismissal is React state only and is not a durable approval/rejection record. `EasyMod-frontend/src/app/components/UnifiedInbox.tsx:400-406`; `EasyMod-frontend/src/app/components/inbox/InboxThreadDetail.tsx:244-247,484-489`.
- **Order confirmation:** The summary instructs the customer to type `YES`, but `extractConfirmation()` uses substring matching and can treat unrelated text as confirmation; there is no merchant approval checkpoint. `EasyMod-backend/src/modules/order/order-session-standalone.service.js:697-721,1270-1283`.

### Automation modes

| Merchant setting | Actual worker behavior | Evidence |
|---|---|---|
| `AUTO` / `AI_ACTIVE` | Conversational candidate may be sent after grounding, confidence, policy, channel, subscription, consent, window, and rate gates; deterministic order/session/payment mutations occur before outbound policy. | `EasyMod-backend/src/jobs/message-worker.js:184-217,501-527,643-831` |
| `DRAFT` | Conversational AI runs and is held; deterministic order flow still runs before this gate and can create an order. | `EasyMod-backend/src/jobs/message-worker.js:501-527,771-779` |
| `MANUAL` | Worker returns before sentiment/AI generation; human inbox remains usable. | `EasyMod-backend/src/jobs/message-worker.js:415-427` |
| `HUMAN_ACTIVE` | Accepted by validators but not included in the non-delivering set; a direct API write can therefore proceed as auto-send. | `EasyMod-backend/src/modules/shop/shop.controller.js:366-375`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:15-27` |

## 10. Data and Tenant Boundary

### Verified tenant controls

- Meta Page resolution binds the event to a `CONNECTED` `MetaChannel`; the inbound request does not supply a shop ID. `EasyMod-backend/src/modules/integration/meta-channel-resolver.js:20-32`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:503-512`.
- Customer creation is keyed by `shop_id + channel_type + channel_user_id`. `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:316-327`.
- Worker conversation lookup is `{ id: conversationId, shop_id: shopId }`. `EasyMod-backend/src/jobs/message-worker.js:393-401`.
- Product SQL, live product re-fetch, order creation product checks, delivery integration lookup, and RAG ingestion bind to the current shop. The authenticated RAG query path overwrites the request shop with `req.user.shopId` but does not reject a missing value; a missing-shop query can reach the base collection without a shop filter. `EasyMod-backend/src/modules/product/product-search.service.js:103-107,182-189,291-296`; `EasyMod-backend/src/modules/order/order.service.js:132-171`; `EasyMod-backend/src/modules/rag/rag.controller.js:7-27,40-50`; `EasyMod-backend/src/modules/rag/rag.service.js:244-259,373-379`.
- The Meta-shaped E2E cross-shop case proves Shop A catalog facts are not sent through Shop B's Page. `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:369-405`.

### Partial or unsafe boundaries

- **Qdrant isolation mode is not proven from the deployment renderer.** Runtime supports per-tenant collections or a shared collection with `shopId` filters, but `QDRANT_PER_TENANT` is documented in `.env.example` and omitted from `scripts/render-production-env.js`; the rendered production environment therefore defaults the runtime to shared-collection filtering. `EasyMod-backend/.env.example:37-45`; `EasyMod-backend/src/modules/rag/rag.service.js:30-56,244-260`; `EasyMod-backend/scripts/render-production-env.js:156-167`. Actual live Qdrant state is `UNKNOWN`.
- **Merchant AI-settings authorization is incomplete.** The routes require authentication, but `updateShopAiSettings()` and the intent-threshold update path do not independently verify current `UserShop` membership/role and ignore `userId`. `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/shop/shop.routes.js:16-18,61-71`; `EasyMod-backend/src/modules/shop/shop.controller.js:410-464,492-499`; `EasyMod-backend/src/modules/shop/shop.service.js:360-388`; `EasyMod-backend/src/modules/ai/intent-threshold.service.js:41-71`.
- **Order status lookup is not customer-owned.** For legacy/imported bare numeric order numbers, the current shop and number are sufficient; PSID/customer ID is not included. Current generated order numbers are alphanumeric. `EasyMod-backend/src/modules/ai/intent-router.service.js:224-240`; `EasyMod-backend/src/modules/order/order.service.js:46-61`.
- **Customer profile enrichment uses `Customer.findByPk(customerId)` without a shop predicate, and a supplied Meta channel ID is not checked against the shop.** `EasyMod-backend/src/modules/customer/customer-profile.service.js:55-65,80-91`.
- **Checkout customer enrichment also uses an unscoped primary-key lookup.** `EasyMod-backend/src/modules/order/order-session-standalone.service.js:1120-1141`.
- **Consent helper writes use primary-key customer lookup without shop predicate.** `EasyMod-backend/src/modules/consent/consent.service.js:132-179,193-208`.
- **Provider tokens are not placed in model context by the live worker.** The channel token is read by the Meta provider immediately before Graph transport; LLM requests contain system prompt/messages only. `EasyMod-backend/src/jobs/message-worker.js:789-811`; `EasyMod-backend/src/modules/ai/llm.service.js:81-181`.
- **PII scrubbing is incomplete.** Only the text-only full LLM message calls `scrubPII`; the FAQ prompt and photo-extraction prompt interpolate raw current text, prior history is mapped raw, and sentiment sends raw customer text to the LLM. `EasyMod-backend/src/modules/ai/intent-router.service.js:335-340,590-596,839-861`; `EasyMod-backend/src/jobs/message-worker.js:101-116`; `EasyMod-backend/src/modules/ai/sentiment.service.js:113-135`.
- **Prompt injection detection exists but is not on the live worker path.** `sanitize()` is used by `GuardrailService`, while the worker imports grounding and does not call `GuardrailService.validateResponse()`. `EasyMod-backend/src/modules/ai/prompt-sanitizer.service.js:21-81`; `EasyMod-backend/src/modules/ai/guardrail.service.js:20-68`; `EasyMod-backend/src/jobs/message-worker.js:23-36`.
- **Consent can fail open on customer lookup failure.** The worker converts a customer lookup error to `null`, and both consent rules allow `NO_CUSTOMER_CONTEXT`; an active-mode reply can therefore proceed without an opt-out check. `EasyMod-backend/src/jobs/message-worker.js:735-738`; `EasyMod-backend/src/modules/policy/rules/consentRequired.rule.js:23-29`; `EasyMod-backend/src/modules/policy/rules/messengerOptedOut.rule.js:16-29`.

## 11. Grounding and Hallucination Boundary

### Actual flow

```text
customer text/photo
  -> product SQL search and/or Qdrant query
  -> live product re-fetch under shop_id
  -> ProductEvidence { NONE | VERIFIED | NOT_FOUND | RETRIEVAL_FAILED }
  -> FAQ/RAG snippets and live operating context
  -> evidence block + shop system prompt
  -> Gemini/OpenAI candidate
  -> deterministic outbound grounding gate
  -> confidence gate and policy engine
  -> Meta provider
```

Evidence: `EasyMod-backend/src/modules/ai/intent-router.service.js:603-700`; `EasyMod-backend/src/modules/ai/grounding/grounding.contract.js:19-55`; `EasyMod-backend/src/jobs/message-worker.js:575-615,643-831`.

### What is mandatory

The grounding gate is invoked for every customer-worker candidate, including cache, FAQ, LLM, fallback, and deterministic order text. Claim checks for retrieval failure, missing-product availability, currency, URLs, and unknown attributes apply only when the source is model-generated (`llm`, `faq`, or `cache`); deterministic order/templates and EasyModerator-authored fallback text bypass those claim checks. Attachment provenance is enforced for all sources. `EasyMod-backend/src/modules/ai/grounding/grounding.contract.js:140-151`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:202-223,226-283`; `EasyMod-backend/src/jobs/message-worker.js:579-585`.

### Zero, weak, and conflicting retrieval

| Condition | Actual behavior | Classification/evidence |
|---|---|---|
| No product entity | `ProductEvidenceStatus.NONE`; general conversation may proceed. | `VERIFIED`; `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:331-337` |
| Product requested, no verified match | Deterministic not-found reply; no product claim or substitute image. | `VERIFIED`; `EasyMod-backend/src/modules/ai/intent-router.service.js:798-808`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:110-141` |
| Product row exists but attribute is null | Attribute is `UNKNOWN`; generated claim is replaced with known facts plus “not recorded”. | `VERIFIED`; `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:224-259`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:263-274` |
| Qdrant returns product hit | Hit is only a candidate; product is re-fetched live by ID under shop scope. | `VERIFIED`; `EasyMod-backend/src/modules/ai/intent-router.service.js:403-451,620-643`; `EasyMod-backend/src/modules/ai/__tests__/intent-router.test.js:99-139` |
| Qdrant fails | Knowledge snippets become empty; product SQL remains authoritative; if product SQL succeeds the answer can continue. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/ai/intent-router.service.js:447-452` |
| Product SQL throws in the actual search service | SQL method catches and returns `[]`, which can be interpreted as `NOT_FOUND` rather than `RETRIEVAL_FAILED`. | `CONTRADICTED`; `EasyMod-backend/src/modules/product/product-search.service.js:160-172`; router's intended failure contract is `EasyMod-backend/src/modules/ai/intent-router.service.js:383-395` |
| Vector-product live re-fetch throws | `getProductsByIds()` and `_mergeVectorProductCandidates()` swallow the error as `[]`; evidence can become `NOT_FOUND` rather than `RETRIEVAL_FAILED`. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/ai/intent-router.service.js:473-481,620-636`; `EasyMod-backend/src/modules/product/product-search.service.js:283-304`; `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:321-355` |
| Weak vector hit | Only scores above `0.5` are considered for knowledge; product evidence still requires conjunctive term matching. | `VERIFIED`; `EasyMod-backend/src/modules/ai/intent-router.service.js:410-425`; `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:191-205` |
| Conflicting FAQ/live operating context | Prompt says live operating context wins, but both are recorded in `sourceText`; numeric gate treats both as supported numbers. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/ai/shop-operating-context.service.js:68-95`; `EasyMod-backend/src/modules/ai/intent-router.service.js:686-700`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:69-85` |
| Stale cache after FAQ/business update | Knowledge/gemini caches are invalidated, but the independent process-local intent response cache is not. | `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/knowledge/knowledge.service.js:118-121`; `EasyMod-backend/src/modules/ai/intent-router.service.js:18-35,104-135` |
| Empty/invalid LLM output | Product turn gets safe fallback; no-evidence turn is suppressed and handed off. | `VERIFIED`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:185-200`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:650-681` |

### Grounding limitation

Grounding is strongest for structured catalog facts and media. The gate's `supportedNumbers()` scans all numeric text in `sourceText`, and the friendly persona itself contains delivery examples (`1-2 days`, `2-3 days`). The router then records the whole system prompt as authoritative source text. This can authorize a number because it appears in a prompt example rather than because the merchant supplied that fact for the current question. `PARTIALLY VERIFIED` risk, not a demonstrated exploit in the checked tests. `EasyMod-backend/src/modules/ai/intent-router.service.js:891-905,697-710`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:69-85`.

## 12. Conversation State and Multi-Turn Capability

| State | Storage/limit | Actual behavior |
|---|---|---|
| Message history | PostgreSQL `messages`; worker loads ten prior messages. | Passed verbatim as user/assistant text; no summarization. `EasyMod-backend/src/jobs/message-worker.js:97-116`; `EasyMod-backend/src/modules/ai/intent-router.service.js:483-497` |
| Current conversation | PostgreSQL `conversations`; rolling 24-hour shop/customer/channel lookup. | Current webhook path creates/reuses a conversation and updates activity. `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:330-388` |
| Order workflow | PostgreSQL `order_sessions`; active session has 24-hour expiry. | Durable multi-turn checkout works through the deterministic step machine. `EasyMod-backend/src/modules/order/order-session.entity.js:33-104`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:823-839` |
| Consent/window | Customer JSONB plus consent events. | Inbound updates last inbound; STOP persists opt-out; policy reads it. `EasyMod-backend/src/modules/consent/consent.service.js:76-89,193-228` |
| Redis pause | `ai:pause:<conversationId>`, 30 minutes. | Human message pauses worker; toggling HITL off clears pause. `EasyMod-backend/src/modules/conversation/conversation.controller.js:471-478,525-529` |
| Burst state | Redis pending/first-seen keys; 8-second debounce, 20-second cap. | Multiple rapid messages become one AI turn. `EasyMod-backend/src/jobs/burst-coalescer.js:35-43,72-107,139-179` |
| Intent cache | Process-local `MemoryCache`; default 1800 seconds. | Not distributed and not invalidated by FAQ/business updates. `EasyMod-backend/src/modules/ai/intent-router.service.js:27-35,104-135` |
| Grounding provenance | Stored on AI message `source_references` and metadata. | Durable for audit, but omitted when worker reloads history. `EasyMod-backend/src/modules/conversation/conversation-state-standalone.service.js:198-232`; `EasyMod-backend/src/jobs/message-worker.js:101-116` |

**Multi-turn conclusion:** A transactional checkout workflow is genuinely supported because the order session is durable and worker-reachable. A general multi-turn “ask about the product mentioned two turns ago” workflow is only partial: the designed provenance-carrying path exists, but the production worker history loader strips provenance. The Meta E2E suite records the observed result: `eta chiffon?` asks which product rather than resolving the prior product. `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:309-330`.

## 13. Provider and Model Responsibilities

| Provider/model | Responsibility | Reachability/configuration | Fallback/status |
|---|---|---|---|
| Google Gemini Lite, default `gemini-3.1-flash-lite` | Normal customer replies, FAQ replies, sentiment, customer-photo extraction, optional image matching. | Production code default; deployment passes `GEMINI_API_KEY`. Exact live key/model value is not in repo. | First provider unless explicitly overridden. `EasyMod-backend/src/modules/ai/llm.service.js:29,194-197,231-260`; `.github/workflows/ci-cd.yml:710-718` |
| Google Gemini Pro, default `gemini-3.1-pro-preview` | Explicit advanced/high-stakes calls. | Code-supported; automatic escalation is off unless `LLM_AUTO_ESCALATE_TO_PRO=true`; current plan gate does not grant advanced preset. | Not automatic by default; explicit `preferredProvider:'gemini-pro'` works. `EasyMod-backend/src/modules/ai/llm.service.js:200-240`; `EasyMod-backend/src/modules/ai/__tests__/gemini-first-routing.test.js:85-117`; `EasyMod-backend/src/modules/conversation/ai-chatbot.controller.js:24-41,340-351`; `EasyMod-backend/src/modules/subscription/subscription.plans.js:74-81` |
| OpenAI, default `gpt-4.1-mini` | Final LLM fallback; explicit OpenAI embedding provider. | Production-reachable if `OPENAI_API_KEY` is configured; workflow passes it. | Fallback after Gemini Lite, and after Pro only when Pro is included. `EasyMod-backend/src/modules/ai/llm.service.js:81-126,194-260` |
| Gemini Embedding 2 | Customer/product/knowledge vector query and ingestion. | Production default when `EMBEDDING_PROVIDER` is unset in production; workflow permits an explicit provider/model. Actual deployed values are `UNKNOWN`. | Optional READY OpenAI collection fallback only when Gemini query embedding fails and a fallback collection is configured. `EasyMod-backend/src/modules/rag/embedding.service.js:181-231,303-409`; `EasyMod-backend/src/modules/rag/rag.service.js:373-421` |
| OpenAI `text-embedding-3-small` | Explicit vector space or fallback collection. | Supported, not necessarily configured. | Never mixed into a Gemini-bound collection. `EasyMod-backend/src/modules/rag/rag.service.js:384-413` |
| HTTP/TEI/GCP embedding | Custom embedding endpoint. | Code-supported, but renderer does not render `EMBEDDING_API_URL`/`EMBEDDING_API_KEY`; production reachability is `UNKNOWN`/`INFERRED unavailable through canonical renderer`. | No provider fallback in `getEmbeddingResult`; collection-level fallback only in RAG. `EasyMod-backend/src/modules/rag/embedding.service.js:234-296,389-409`; `EasyMod-backend/scripts/render-production-env.js:156-167` |
| Local n-gram | Development/non-semantic fallback. | Code can activate it for invalid/unrecognized provider or non-production default. | Not safe for production semantic retrieval; logs warning. `EasyMod-backend/src/modules/rag/embedding.service.js:18-46,298-323` |
| BanglaBERT | Greeting classification only in the live router; other labels are hints that do not change routing. | Client defaults to `localhost:8001`; no BERT service appears in production compose. | Returns null and falls through when unavailable. `EasyMod-backend/src/modules/ai/bert-client.service.js:1-16,35-64`; `docker-compose.prod.yml:1-12,30-168` |
| CLIP service | Optional customer image similarity and product-image indexing. | Client defaults to `clip-similarity:8002`; no such compose service. | Returns null and falls through to RAG/vision. `EasyMod-backend/src/modules/product/clip-client.service.js:11-20,34-69`; `docker-compose.prod.yml:1-12,30-168` |
| Direct Gemini `gemini-1.5-flash` | Manual voice transcription endpoint. | Route is mounted/authenticated; direct service uses a separate hardcoded model path. | No model failover through `llm.service`. `EasyMod-backend/src/modules/ai/voice-processing.service.js:27-29,154-228` |
| Anthropic/Claude | No runtime provider implementation. | Not implemented; only stale docs/tests/legal references. | No fallback path. `EasyMod-backend/src/modules/ai` contains no Anthropic client; stale references include `EasyMod-frontend/tests/e2e/chatbot-journey.test.js:494-498`. |
| LLM tier-selection service | Historical tier/model selection. | No production caller found; model IDs are stale relative to `llm.service`. | `IMPLEMENTED_BUT_UNREACHABLE`; `EasyMod-backend/src/modules/ai/llm-tier-selection.service.js:48-90,169-215` |

Provider chain tests verify Gemini first, OpenAI fallback, optional Pro escalation, and total failure. `EasyMod-backend/src/modules/ai/__tests__/gemini-first-routing.test.js:38-187`.

## 14. Failure and Fallback Architecture

| Failure | Actual behavior | Risk/status | Evidence |
|---|---|---|---|
| Invalid webhook signature | 403; no customer processing. | `VERIFIED` fail closed. | `EasyMod-backend/src/modules/integration/meta-webhook.routes.js:110-136` |
| Malformed webhook JSON | Logs and returns 200; no receipt/retry. | `PARTIALLY VERIFIED`; safe from injection but silently discards malformed payload. | `EasyMod-backend/src/modules/integration/meta-webhook.routes.js:114-121` |
| Receipt DB persistence failure | 503 so Meta can redeliver. | `VERIFIED`. | `EasyMod-backend/src/modules/integration/meta-webhook.routes.js:147-156`; `EasyMod-backend/src/modules/integration/meta-webhook-receipt.service.js:130-143` |
| Unresolved/disconnected Page | Durable receipt held with retry ladder; reconciler runs every two minutes; eventually dead-letters. | `VERIFIED`, bounded. | `EasyMod-backend/src/modules/integration/meta-webhook-receipt.service.js:198-225,279-325`; `EasyMod-backend/src/jobs/queue-manager.js:200-207` |
| Message storage failure | Receipt marked retry-pending, then dead-lettered after bounded retries. | `VERIFIED`, but manual replay required after DLQ. | `EasyMod-backend/src/modules/integration/meta-webhook-receipt.service.js:227-270` |
| Queue unavailable or burst scheduling throws | Message remains in DB, alert is sent, but `dispatchMessageJob()` is not awaited; receipt is then marked `PROCESSED`. | `CONTRADICTED`/dangerous loss gap. | `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:148-195,514-530` |
| Duplicate webhook | Receipt dedup by MID/hash and message external ID; worker also has Redis dedup. | `VERIFIED`, but early dedup affects retries. | `EasyMod-backend/src/modules/integration/meta-webhook-receipt.service.js:79-129`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:299-313`; `EasyMod-backend/src/jobs/message-worker.js:387-391` |
| Primary LLM fails | Circuit breaker records failure; default chain skips Pro and falls through to OpenAI. | `VERIFIED`; circuit-open/reset concurrency is not directly tested. | `EasyMod-backend/src/modules/ai/llm.service.js:194-260`; `EasyMod-backend/src/modules/ai/circuit-breaker.service.js:36-84` |
| All LLM providers fail | Worker returns generic response at confidence `0`; grounding/policy path holds/hands off. | `VERIFIED` at candidate path. | `EasyMod-backend/src/jobs/message-worker.js:557-572,643-677`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:559-599` |
| Embedding provider fails | Embedding HTTP paths retry; Gemini query may use a compatible READY OpenAI fallback collection; otherwise RAG error is swallowed by router as empty knowledge. | `PARTIALLY VERIFIED`. | `EasyMod-backend/src/modules/rag/embedding.service.js:76-112`; `EasyMod-backend/src/modules/rag/rag.service.js:373-421`; `EasyMod-backend/src/modules/ai/intent-router.service.js:447-452` |
| Qdrant unavailable | Knowledge is omitted; product SQL can continue. | `PARTIALLY VERIFIED`; product claim safety depends on product SQL. | `EasyMod-backend/src/modules/ai/intent-router.service.js:403-452` |
| PostgreSQL product query fails | Low-level search catches and returns empty list; higher-level `RETRIEVAL_FAILED` branch may not run. | `CONTRADICTED` against fail-closed design. | `EasyMod-backend/src/modules/product/product-search.service.js:160-172`; `EasyMod-backend/src/modules/ai/intent-router.service.js:389-395` |
| Invalid structured model output | Photo/product metadata parsers return null/false; sentiment falls back to keywords; MFS verification fails closed; general text reaches grounding gate. | `PARTIALLY VERIFIED`; no provider-native schema validation. | `EasyMod-backend/src/modules/ai/intent-router.service.js:839-874`; `EasyMod-backend/src/modules/product/product-ai.service.js:229-242`; `EasyMod-backend/src/modules/ai/sentiment.service.js:141-207`; `EasyMod-backend/src/modules/payment/self-mfs-handler.service.js:131-157` |
| Worker/provider send fails | Eligible ordinary worker errors use the three-attempt BullMQ policy and then write `message-dlq`; provider rate-limit errors move the job delayed, and Meta authorization errors use `UnrecoverableError`. The early 24-hour dedup key can still cause an ordinary retry to return `duplicate`. | `CONTRADICTED` retry semantics. | `EasyMod-backend/src/jobs/message-queue.js:37-44`; `EasyMod-backend/src/jobs/message-worker.js:387-391,812-823,880-909` |
| Meta auth error 102/190 | Channel recovery clears token, sets manual/AI disabled, drains channel jobs, notifies owner; worker raises unrecoverable error only after recovery. | `VERIFIED`; recovery failure remains retryable. | `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:518-545`; `EasyMod-backend/src/modules/channel-providers/meta-authorization-recovery.service.js:95-136` |
| Text send succeeds, attachment send fails | Provider sends bodies sequentially; prior text may already be delivered before the attachment fails. | `PARTIALLY VERIFIED` dangerous partial external mutation. | `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:455-513` |
| Low confidence | In auto mode, stores held draft, captures gap, sets HITL, and attempts holding message; Draft, `AI_SUGGEST_ONLY`, and Manual take the policy-denial path and do not enter the confidence-HITL branch. | `PARTIALLY VERIFIED`, holding delivery best-effort. | `EasyMod-backend/src/modules/ai/confidence-gate.service.js:15-19,25,62-69`; `EasyMod-backend/src/jobs/message-worker.js:643-677,765-779`; `EasyMod-backend/src/modules/conversation/human-handoff.service.js:70-126` |
| Policy denial | Stores raw response as held suggestion; rate-limit denial moves job delayed. | `VERIFIED`, but dedup key remains claimed across delay. | `EasyMod-backend/src/jobs/message-worker.js:765-779`; `EasyMod-backend/src/modules/policy/rules/rateLimit.rule.js:57-85` |
| Redis unavailable | Local config can use in-memory clients; production queue requires Redis configuration, while some fail-open/fail-safe choices vary by subsystem. | `UNKNOWN` for live runtime; configuration-dependent. | `EasyMod-backend/src/config/redis.js:1-18,27-73`; `EasyMod-backend/src/jobs/message-queue.js:6-45` |
| Subscription row missing | `isAiActive(null)` returns true; worker fails open and can continue AI. | `VERIFIED` fail-open policy. | `EasyMod-backend/src/modules/subscription/subscription.access.js:9-26`; `EasyMod-backend/src/jobs/message-worker.js:430-454` |
| Conversation outside 24-hour window | AI/system messages receive a default `POST_PURCHASE_UPDATE` tag in code; human-agent messages are blocked. Frontend blocks expired Draft “Use this”. | `CONTRADICTED` documentation/UI versus backend runtime. | `EasyMod-backend/src/modules/policy/rules/twentyFourHourWindow.rule.js:18-46`; `EasyMod-backend/src/modules/policy/rules/templateRequired.rule.js:26-54`; `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:483-489`; `EasyMod-frontend/src/app/components/inbox/InboxThreadDetail.tsx:264-280` |

## 15. Security and Authorization Boundary

### AI decision to mutation review

| Mutation | AI decision | Authorization/tenant check | Validation/business rules | Mutation/audit result |
|---|---|---|---|---|
| Create order | Deterministic confirmed checkout, not free-form LLM tool call. | `createOrderInternal()` bypasses user auth; shop ID comes from trusted worker/session, but the internal method does not independently verify customer ownership or `allow_order_creation`. | Product belongs to shop, live price, stock, COD cap, subscription limit, RTO Shield, transaction and idempotency key. | Order/items/stock/usage/notification; no actor=`AI` order audit record. `EasyMod-backend/src/modules/order/order.service.js:286-435,451-458` |
| Courier booking | `setImmediate()` after order completion. | Active provider lookup requires same shop and connected/active integration. | Provider payload normalization; no local durable booking idempotency. | External booking; tracking record writer is not called; three in-process retries can duplicate if provider-level deduplication is absent or unverified. `EasyMod-backend/src/modules/order/order-session-standalone.service.js:792-793,1152-1213`; `EasyMod-backend/src/modules/delivery/delivery.service.js:18-39,103-176`; `EasyMod-backend/src/modules/delivery/providers/provider.registry.js:20-37,56-68,90-102` |
| Customer profile enrichment | Fire-and-forget after inbound/checkout. | Caller passes trusted IDs; helper lacks customer/shop and channel/shop defense-in-depth. | Placeholder-name checks; Meta token/proof. | Customer name/metadata write; no dedicated audit. `EasyMod-backend/src/modules/customer/customer-profile.service.js:55-135` |
| Consent | STOP/inbound deterministic action. | Consent event records shop/channel/customer fields; customer lookup is primary-key only. | Opt-out preserved; admin-only re-opt-in clears prior opt-out. | JSONB and append-only consent event. `EasyMod-backend/src/modules/consent/consent.service.js:132-228` |
| AI outbound send | Candidate -> grounding -> confidence -> policy. | Shop/customer/channel context; provider requires allowed policy decision; channel token encrypted at rest. | Consent, opt-out, window/tag, sanitizer, business hours, rate limit, Draft/manual. | Policy decision row, AI message row, provider IDs; policy persistence failure does not block send. `EasyMod-backend/src/modules/policy/policy.engine.js:118-141`; `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:448-546` |
| HITL/handoff | Sentiment/grounding/threshold outcome. | Conversation was loaded by worker with shop scope; holding customer lookup is shop-scoped. | `hitl=true`, notification and policy path. | Conversation/message/notification, but holding send has no durable retry. `EasyMod-backend/src/modules/conversation/human-handoff.service.js:46-126` |

### Security findings

- **No arbitrary service/tool invocation:** The model receives text/images and returns text. Service invocation is hardcoded in worker/router code; no LLM-generated IDs are dispatched directly to arbitrary services. `VERIFIED`.
- **Prompt injection:** A regex sanitizer exists, but it is not called by the live worker. The grounding prompt tells the model to treat customer text as data, but this is prompt-only protection. `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/ai/prompt-sanitizer.service.js:21-81`; `EasyMod-backend/src/modules/ai/guardrail.service.js:42-68`; `EasyMod-backend/src/jobs/message-worker.js:23-36`.
- **Cross-shop product isolation:** Tested and enforced. `VERIFIED`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:369-405`.
- **Same-shop cross-customer order disclosure:** Legacy/imported bare numeric order lookup is not bound to the PSID/customer. `HIGH` risk; `PARTIALLY VERIFIED` behavior, no negative security test found. `EasyMod-backend/src/modules/ai/intent-router.service.js:224-240`.
- **Tenant-defense gaps in helper mutations:** Profile, consent, and checkout enrichment rely on trusted IDs rather than reasserting shop ownership. `PARTIALLY VERIFIED`; see paths above.
- **Secret exposure:** Provider API keys are read only by provider clients; usage recorder explicitly avoids prompt/response bodies and customer identifiers. `EasyMod-backend/src/modules/ai/usage-recorder.service.js:15-17`; `EasyMod-backend/src/modules/ai/__tests__/cost.service.test.js:322-342`. Local ignored environment files exist in the workspace, but their values are intentionally not reproduced.
- **Auditability:** Policy decisions, consent events, grounding metadata, and some merchant actions are recorded. AI order creation does not write a dedicated actor/decision/session audit record. `PARTIALLY VERIFIED`; `EasyMod-backend/src/modules/order/order.service.js:393-411`; `EasyMod-backend/src/jobs/message-worker.js:620-641`.

## 16. Prompt Architecture

| Prompt/template | Purpose | Inputs | Outputs/constraints | Authority and failure behavior | Evidence |
|---|---|---|---|---|---|
| Shop persona/system prompt | Role, tone, language, payment/delivery rules, business info, links, FAQ, conversation continuity. | Shop knowledge, language, image flag, tone, relevant FAQs, operating context. | Free-form text; instructed to be concise and not invent product/order facts. | Prompt authority is supplemented, not replaced, by grounding gate; operating context is intended to override stale FAQ/persona examples. | `EasyMod-backend/src/modules/ai/intent-router.service.js:891-1005` |
| Grounding evidence prompt | Render verified products, explicit UNKNOWNs, not-found/retrieval failure, media rules. | `GroundingEvidence`. | Model sees catalog/evidence block and rules. | Only evidence is supposed to authorize merchant facts; deterministic safe replies bypass the model. | `EasyMod-backend/src/modules/ai/grounding/grounding-prompt.js:80-199` |
| FAQ prompt branch | Ask LLM to answer from selected FAQ content. | FAQ content, customer question, language, system prompt. | Text; prompt says use FAQ context. | FAQ content is recorded as evidence and sent through grounding gate. | `EasyMod-backend/src/modules/ai/intent-router.service.js:335-369` |
| Customer photo extraction | Convert first customer photo to searchable attributes/description. | Image URL and caption. | JSON requested by prompt; parsed with regex/`JSON.parse`, no schema. | Failure returns null; later path must not claim it saw the image. | `EasyMod-backend/src/modules/ai/intent-router.service.js:839-874` |
| Image matcher vision tier | Describe product image for attribute search. | Image URL. | JSON requested; manually parsed. | Disabled unless `AI_VISION_ENABLED=true`; failure falls through. | `EasyMod-backend/src/modules/ai/image-product-matcher.service.js:36-89` |
| Merchant product image extraction | Derive `ai_*` search fields from merchant product image. | Product image/name. | JSON requested; parsed manually. | Disabled by default; text derivation is default. | `EasyMod-backend/src/modules/product/product-ai.service.js:32-42,155-177` |
| Sentiment system prompt | Classify positive/neutral/frustrated/angry. | Raw customer text. | JSON requested; enum checked, confidence range not checked. | Parse/LLM failure falls back to keyword result. | `EasyMod-backend/src/modules/ai/sentiment.service.js:92-157,198-218` |
| Self-MFS OCR prompt | Extract transaction ID, amount, sender/receiver, type, status, confidence. | Screenshot image. | JSON requested; downstream field checks. | Parse or validation failure rejects verification; audit write fails closed. | `EasyMod-backend/src/modules/payment/self-mfs-handler.service.js:88-100,131-157,322-364` |
| Voice transcription prompt | Transcribe Bengali/English/Banglish audio. | Base64 audio, language hint. | Plain text only. | Direct service error becomes API failure; no integration with customer worker. | `EasyMod-backend/src/modules/ai/voice-processing.service.js:154-228` |
| Banglish transliteration prompt | Convert Banglish to Bangla. | Text and rule-based attempt. | One-line text. | Uses normal LLM chain; caller is not part of the live customer worker path in the audited flow. | `EasyMod-backend/src/modules/ai/llm.service.js:263-277` |
| Embedding input contract | Format query/document input for embedding space. | Text, title, provider identity. | Vector input, not natural-language response. | Provider/model/version/dimension identity is checked against Qdrant manifest. | `EasyMod-backend/src/modules/rag/embedding.service.js:181-231`; `EasyMod-backend/src/modules/rag/embedding-space.js:48-170` |

### Structured output finding

The LLM HTTP requests do not use provider-native JSON schema, `response_format`, or function calling. They specify model, messages, token limit, and temperature; JSON is requested in prompts and parsed manually. `EasyMod-backend/src/modules/ai/llm.service.js:81-181`; `EasyMod-backend/src/modules/ai/intent-router.service.js:867-874`; `EasyMod-backend/src/modules/product/product-ai.service.js:229-242`. This is `PARTIALLY VERIFIED` safety: downstream checks are strong for MFS and grounding, but schema validation is absent for extraction/sentiment fields.

### Obsolete or contradictory prompt architecture

- `intent-router.service.js` comments still describe an Anthropic system-array/cache architecture, while runtime calls Gemini/OpenAI. `EasyMod-backend/src/modules/ai/intent-router.service.js:881-885`; `EasyMod-backend/src/modules/ai/llm.service.js:133-181`.
- The old `guardrail.service` contains prompt-injection and toxicity logic but has no live worker caller. `EasyMod-backend/src/modules/ai/guardrail.service.js:20-139`; `EasyMod-backend/src/jobs/message-worker.js:23-36`.
- `conversation-context.service.js` is unused and represents a different history/consistency strategy than the live “history is not evidence” prompt. `EasyMod-backend/src/modules/ai/conversation-context.service.js:153-188`; `EasyMod-backend/src/modules/ai/intent-router.service.js:972-981`.
- Business rules such as “do not claim an order exists” and payment/delivery behavior exist in prompts, while actual order creation and payment verification are deterministic code. Prompt-only rules are weaker than the corresponding mutation rules. `EasyMod-backend/src/modules/ai/intent-router.service.js:907-912`; `EasyMod-backend/src/modules/conversation/order-flow.service.js:148-252`.

## 17. Test Coverage Versus Capability

Tests were inspected as repository evidence; this audit did not execute the application test suites.

| Capability | Implementation | Tests | Failure tests | Confidence |
|---|---|---|---|---|
| Signed webhook, receipts, dedup, consent | Live Meta route and receipt service. | `EasyMod-backend/src/modules/integration/__tests__/meta-webhook.routes.test.js:176-359`; `EasyMod-backend/src/modules/integration/__tests__/meta-webhook-durability.test.js:232-526`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:53-103` | Receipt storage/dedup covered; queue dispatch failure after receipt processing is not covered. | `HIGH` for ingress; `MEDIUM` for dispatch reliability |
| Product grounding and hallucination prevention | Evidence resolver and outbound gate. | `EasyMod-backend/src/modules/ai/grounding/__tests__/grounding-boundary.test.js:125-634`; `EasyMod-backend/src/jobs/__tests__/message-worker.grounding.test.js:128-298`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:107-681` | Missing product, unknown attributes, unsupported price/URL, bad media, LLM outage, retrieval failure, malformed output. | `HIGH` for tested product/media claims |
| Product/FAQ routing | Intent router, SQL search, RAG candidate re-fetch. | `EasyMod-backend/src/modules/ai/__tests__/intent-router.test.js:55-326`; `EasyMod-backend/src/modules/ai/__tests__/build-system-prompt.test.js:25-92` | Mocked retrieval/provider paths; real SQL exception swallowing is not exercised. | `MEDIUM-HIGH` |
| Provider fallback | Gemini/OpenAI chain and circuit breaker. | `EasyMod-backend/src/modules/ai/__tests__/gemini-first-routing.test.js:38-187` | Total outage and 429 covered; circuit-open concurrency and live provider transport not covered. | `MEDIUM-HIGH` |
| Automation modes and confidence | Worker settings merge and confidence gate. | `EasyMod-backend/src/jobs/__tests__/message-worker.greeting.test.js:194-245`; `EasyMod-backend/src/modules/ai/__tests__/confidence-gate.test.js:43-87`; `EasyMod-backend/src/modules/shop/__tests__/ai-settings.test.js:114-189` | Mode/threshold boundaries covered; no integration test proving Draft/policy gates protect deterministic order mutation. | `MEDIUM` |
| Order capture | Deterministic session and order core. | `EasyMod-backend/src/modules/conversation/__tests__/order-flow.service.test.js:57-294`; `EasyMod-backend/src/modules/order/__tests__/order-session-standalone.steps.test.js:78-626`; `EasyMod-backend/src/modules/order/__tests__/order-session-standalone.createorder.test.js:28-108` | Stock, invoice, COD/step cases covered; no full signed Meta -> real order E2E; courier side effects are mocked/fire-and-forget. | `MEDIUM` |
| Self-MFS verification | OCR/fraud/TrxID log service. | `EasyMod-backend/src/modules/payment/__tests__/self-mfs-handler.audit-log-failure.test.js:39-105`; `EasyMod-backend/src/modules/payment/__tests__/self-mfs-handler.media-security.test.js` | Standalone service failure tests exist, but no test proves the canonical checkout supplies a valid expected total/order ID; source shows it does not. | `LOW` |
| Courier booking | Delivery service and order-session dispatch. | `EasyMod-backend/src/modules/order/__tests__/order.controller.book-courier.test.js`; step tests mock dispatch. | No local durable booking idempotency or AI partial-booking E2E; provider-level deduplication is unverified; no tracking persistence assertion for the AI path. | `LOW` |
| Human handoff/HITL | Handoff service and conversation controller. | `EasyMod-backend/src/modules/conversation/__tests__/human-handoff.test.js:43-118`; frontend `EasyMod-frontend/src/test/UnifiedInbox.test.tsx:464-516` | Holding delivery failure is tested as non-throwing, not durable recovery; configured handoff preferences are not runtime-tested. | `MEDIUM` |
| Tenant isolation | Shop-scoped product/RAG/delivery routes. | `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:369-405`; `EasyMod-backend/src/security/__tests__/route-perimeter.test.js:41-59`; `EasyMod-backend/src/modules/delivery/__tests__/delivery-rag.routes.security.test.js` | No test for same-shop cross-customer order-number lookup; no helper-level profile/consent tenant tests. | `HIGH` for product, `LOW` for order status/helper writes |
| Conversation memory | PostgreSQL messages, Redis pause, order session. | `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:309-330`; `EasyMod-backend/src/modules/conversation/__tests__/conversation-state-language.test.js` | E2E explicitly records missing `source_references`; no summary/long-history tests. | `MEDIUM` |
| Voice | Manual transcription endpoint/service. | `EasyMod-backend/src/modules/ai/__tests__/voice-processing.limits.test.js` | Size/input limits covered; no end-to-end mutation/worker integration because no caller exists. | `LOW` for assistant capability |
| Merchant knowledge ingestion | FAQ sync, document ingestion, manual reindex. | `EasyMod-backend/src/modules/knowledge/__tests__/knowledge.test.js`; `EasyMod-backend/src/modules/knowledge/__tests__/auto-index.job.test.js`; `EasyMod-backend/src/modules/knowledge/__tests__/index-source.contract.test.js` | Document `{success:false}` status path and scheduled registration gap remain. | `MEDIUM` |
| Legacy chatbot HTTP surface | Unmounted routes/controller. | `EasyMod-backend/src/security/__tests__/route-perimeter.test.js:10-15`; quarantined `EasyMod-backend/src/modules/ai/__tests__/chatbot-rag.test.js:350-355`; frontend stale E2E `EasyMod-frontend/tests/e2e/chatbot-journey.test.js:255-286,464-483` | The stale suite is explicitly not coverage. | `HIGH` that it is not production-reachable |

The default Jest suite intentionally stubs queues and excludes real Postgres/Redis integration, Meta-shaped E2E, and quarantined tests. `EasyMod-backend/jest.config.js:1-57`; `EasyMod-backend/jest.meta-e2e.config.js:1-24`; `EasyMod-backend/tests/quarantine.json:23-30`.

## 18. Dead, Partial, Disabled and Unreachable AI Features

| Feature/path | Classification | Evidence |
|---|---|---|
| `/api/ai-chatbot/*` HTTP route | `IMPLEMENTED_BUT_UNREACHABLE` | Not mounted in `EasyMod-backend/src/modules/routes.js:31-65`; perimeter test requires absence at `EasyMod-backend/src/security/__tests__/route-perimeter.test.js:10-15`. |
| Legacy chatbot RAG test | `TESTED_BUT_DISCONNECTED` and not coverage | Quarantine identifies stale API contract and superseded delivery mechanism. `EasyMod-backend/tests/quarantine.json:23-30`. |
| Frontend chatbot journey | `TESTED_BUT_DISCONNECTED` | Mocks `/api/ai-chatbot/process`, a route not mounted by current backend. `EasyMod-frontend/tests/e2e/chatbot-journey.test.js:255-286,464-483`. |
| `ConversationStateService.ingestMessage()` old path | `IMPLEMENTED_BUT_UNREACHABLE` for live Meta ingress | Live webhook stores directly; worker uses `loadConversationHistory` and `storeAIResponse`; old service belongs to unmounted controller path. `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:316-400`; `EasyMod-backend/src/jobs/message-worker.js:488-552`; `EasyMod-backend/src/modules/conversation/conversation-state-standalone.service.js:15-193`. |
| `GuardrailService.validateResponse()` | `IMPLEMENTED_BUT_UNREACHABLE` | Definition exists, but no worker/controller caller found; current trust boundary is grounding. `EasyMod-backend/src/modules/ai/guardrail.service.js:20-139`; `EasyMod-backend/src/jobs/message-worker.js:23-36`. |
| Prompt injection `sanitize()` | `IMPLEMENTED_BUT_UNREACHABLE` on live worker | Only guardrail path uses it; live intent path uses `scrubPII()` only. `EasyMod-backend/src/modules/ai/prompt-sanitizer.service.js:41-81`; `EasyMod-backend/src/modules/ai/intent-router.service.js:590-596`. |
| Per-intent threshold service | `IMPLEMENTED_BUT_UNREACHABLE` | API can store thresholds, but `getThresholdForIntent()` has no live caller; worker uses global threshold. `EasyMod-backend/src/modules/ai/intent-threshold.service.js:14-31`; `EasyMod-backend/src/jobs/message-worker.js:649-655`. |
| LLM tier selection | `IMPLEMENTED_BUT_UNREACHABLE` | Service has old model IDs and no current caller. `EasyMod-backend/src/modules/ai/llm-tier-selection.service.js:48-90,169-215`. |
| BERT microservice | `PARTIAL`/likely unreachable in canonical compose | Client falls back safely, but no BERT service is in `docker-compose.prod.yml`. `EasyMod-backend/src/modules/ai/bert-client.service.js:1-16,35-64`; `docker-compose.prod.yml:1-12,30-168`. |
| CLIP microservice | `PARTIAL`/likely unreachable in canonical compose | Client falls through to RAG; no CLIP service is in compose. `EasyMod-backend/src/modules/product/clip-client.service.js:11-20,34-69`; `docker-compose.prod.yml:1-12,30-168`. |
| Voice conversation processing functions | `IMPLEMENTED_BUT_UNREACHABLE` | `processVoiceMessage()` and `processVoiceInConversation()` have no production caller; route only returns a transcript. `EasyMod-backend/src/modules/ai/voice-processing.controller.js:21-48`; `EasyMod-backend/src/modules/ai/voice-processing.service.js:40-90,249-287`. |
| Live webhook input-length guard | `IMPLEMENTED_BUT_UNREACHABLE` on the customer path | `isTooLong()` is enforced only by the unmounted HTTP chatbot controller; live webhook text is passed into the worker without the 500-character check. `EasyMod-backend/src/modules/ai/prompt-sanitizer.service.js:8-12`; `EasyMod-backend/src/modules/conversation/ai-chatbot.controller.js:111-115`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:495-512`. |
| Auto-index scheduler | `IMPLEMENTED_BUT_UNREACHABLE` as scheduled runtime | Job exists but is not registered in queue manager; only manual `reindex:qdrant` is exposed. `EasyMod-backend/src/modules/knowledge/auto-index.job.js:37-110`; `EasyMod-backend/src/jobs/queue-manager.js:41-56`; `EasyMod-backend/package.json:24`. |
| `HUMAN_ACTIVE` | `CONTRADICTED` mode behavior | Accepted by schema, but not treated as non-delivering by worker/policy; frontend maps it to MANUAL. `EasyMod-backend/src/modules/channel-providers/meta-channel-settings.entity.js:27-32`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:15-27`; `EasyMod-frontend/src/app/components/AISettingsForm.tsx:35-39`. |
| `allow_order_creation` | `PARTIALLY IMPLEMENTED` setting | Persisted and exposed, not read by live order flow. `EasyMod-backend/src/modules/channel-providers/meta-channel.service.js:482-500`; `EasyMod-backend/src/jobs/message-worker.js:501-527`. |
| `max_auto_order_value` | `PARTIALLY IMPLEMENTED` setting | Validated/stored; active order core enforces environment COD cap instead. `EasyMod-backend/src/modules/shop/shop.controller.js:436-464`; `EasyMod-backend/src/modules/order/order.service.js:186-197,331-334`. |
| `required_fields`/`ask_email` | `PARTIALLY IMPLEMENTED` settings | Stored, but step machine uses fixed name/phone/address/payment/notes sequence. `EasyMod-backend/src/modules/shop/shop.controller.js:415-461`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:1232-1247`. |
| Handoff notification preference | `PARTIALLY IMPLEMENTED` | UI/API stores selection; notification fan-out always creates in-app and attempts push/Telegram based on binding preferences, not the selected shop field. `EasyMod-frontend/src/app/components/AISettingsForm.tsx:351-407`; `EasyMod-backend/src/modules/notification/merchant-notification.service.js:45-115`. |
| Handoff trigger keywords/cooldown | `IMPLEMENTED_BUT_UNREACHABLE` settings | `handoff_settings.trigger_keywords` and `cooldown_minutes` are stored but the live worker uses hard-coded sentiment classes and the handoff service does not read them. `EasyMod-backend/src/modules/shop/shop.controller.js:415-461`; `EasyMod-backend/src/jobs/message-worker.js:456-486`; `EasyMod-backend/src/modules/conversation/human-handoff.service.js:35-126`. |
| Product upsell service | `IMPLEMENTED_BUT_UNREACHABLE` by AI | Authenticated product API only; no worker/router call. `EasyMod-backend/src/modules/product/product-upsell.service.js:26-142`; `EasyMod-backend/src/modules/product/product.routes.js:23-32`. |
| Anthropic/Claude provider | `NOT IMPLEMENTED` | No runtime client; stale legal/test/docs references remain. `EasyMod-frontend/tests/e2e/chatbot-journey.test.js:494-498`. |

## 19. Capability Gaps

The following are gaps in the current implementation, not assumed future features:

- No canonical intent schema or persisted intent decision for the live worker.
- No formal AI tool registry or typed function-calling boundary.
- No customer-identity check on AI order-status lookup.
- No merchant approval gate before AI-created order mutation.
- Draft mode is not a mutation-safe mode for checkout.
- `allow_order_creation`, `max_auto_order_value`, `required_fields`, per-intent thresholds, per-channel thresholds, and handoff preference fields are not consistently authoritative.
- Merchant AI-settings and per-intent-threshold routes authenticate requests but do not independently verify current `UserShop` membership/role; the settings service ignores `userId`. `EasyMod-backend/src/modules/shop/shop.routes.js:16-18,61-71`; `EasyMod-backend/src/modules/shop/shop.controller.js:410-464,492-499`; `EasyMod-backend/src/modules/shop/shop.service.js:360-388`; `EasyMod-backend/src/modules/ai/intent-threshold.service.js:41-71`.
- Existing-order modification, cancellation, returns, refunds, customer CRUD, settings changes, and courier management are not AI capabilities.
- General unsupported merchant claims are not validated as comprehensively as product price/URL/media claims.
- Worker history does not carry grounding provenance, so product attribute follow-ups are not reliably multi-turn.
- Queue dispatch acknowledgment, early dedup claim, delayed-rate-limit retry, and provider partial-send handling are not transactionally safe.
- Courier booking lacks local durable idempotency and does not persist the AI path's successful tracking result through `createTrackingRecord()`; provider-level deduplication from stable merchant identifiers is not verified.
- Actual production embedding provider, Qdrant collection state, and tenant-mode runtime values cannot be established from repository evidence alone.
- Voice transcription is not integrated into inbound Messenger message normalization or AI routing.
- BERT and CLIP are code-supported but not present in the canonical compose stack.
- Structured extraction uses prompt-requested JSON and manual parsing rather than provider-native schemas plus schema validation.

## 20. Contradictions and Risks

| Priority | Finding | Label | Evidence |
|---|---|---|---|
| High | Order-flow checkout, payment, and courier mutations run before outbound policy. Draft, `AI_SUGGEST_ONLY`, `HUMAN_ACTIVE`, consent/window, business-hours, and rate gates do not protect those deterministic mutations; the confirmation predicate is also overbroad. | `CONTRADICTED` | `EasyMod-backend/src/jobs/message-worker.js:408-427,501-527,724-780`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:15-27`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:684-721,1270-1283`; `EasyMod-backend/src/modules/channel-providers/meta-channel-settings.entity.js:55-60` |
| High | Purchase-intent matching does not exclude negation, so a message containing `I don't want to order` can enter checkout routing. | `PARTIALLY VERIFIED` | `EasyMod-backend/src/modules/conversation/order-flow.service.js:34-45,91-98` |
| High | A legacy/imported bare numeric order number can expose another customer's order/payment/delivery status within the same shop. | `PARTIALLY VERIFIED` security risk | `EasyMod-backend/src/modules/ai/intent-router.service.js:224-240`; `EasyMod-backend/src/modules/order/order.service.js:46-61` |
| High | If the worker's customer lookup fails, both consent rules allow `NO_CUSTOMER_CONTEXT`; an active-mode reply can proceed without checking opt-out state. | `PARTIALLY VERIFIED` security risk | `EasyMod-backend/src/jobs/message-worker.js:735-738`; `EasyMod-backend/src/modules/policy/rules/consentRequired.rule.js:23-29`; `EasyMod-backend/src/modules/policy/rules/messengerOptedOut.rule.js:16-29` |
| High | Authenticated RAG query does not explicitly reject a missing JWT shop ID and can query the shared base collection without a tenant filter. | `PARTIALLY VERIFIED` tenant risk | `EasyMod-backend/src/modules/rag/rag.controller.js:40-50`; `EasyMod-backend/src/modules/rag/rag.service.js:244-259,373-379` |
| High | Worker retry policy is defeated by the early 24-hour dedup key. | `CONTRADICTED` retry design | `EasyMod-backend/src/jobs/message-worker.js:387-391,812-823`; `EasyMod-backend/src/jobs/message-queue.js:37-44` |
| High | Inbound receipt is marked processed even when queue dispatch/scheduling fails. | `PARTIALLY VERIFIED` loss risk | `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:148-195,514-530` |
| High | Courier external retry has no local durable booking idempotency and successful AI booking does not call tracking persistence. Provider-level deduplication is unverified. | `PARTIALLY VERIFIED` external mutation risk | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:792-793,1152-1213`; `EasyMod-backend/src/modules/delivery/delivery-tracking.service.js:49-90`; `EasyMod-backend/src/modules/delivery/providers/provider.registry.js:20-37,56-68,90-102` |
| Medium | `confirmed` order status sent by AI is outside `ORDER_STATES`; state consistency can reset it to `draft`. | `CONTRADICTED` | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:1095-1117`; `EasyMod-backend/src/modules/order/order.service.js:19-22,244-261,410-411` |
| Medium | Real SQL product errors and vector-product live re-fetch errors are caught as empty results, undermining the intended `RETRIEVAL_FAILED` fail-closed branch. | `CONTRADICTED` | `EasyMod-backend/src/modules/product/product-search.service.js:160-172,283-304`; `EasyMod-backend/src/modules/ai/intent-router.service.js:383-395,473-481,620-636` |
| Medium | `HUMAN_ACTIVE` can auto-send if written directly despite its human-mode name. | `CONTRADICTED` | `EasyMod-backend/src/modules/shop/shop.controller.js:366-375`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:15-27` |
| Medium | Backend code allows tagged AI/system sends outside the 24-hour window, while README/frontend say the path is blocked until templates exist. Human-agent sends are blocked. | `CONTRADICTED` | `EasyMod-backend/src/modules/policy/rules/twentyFourHourWindow.rule.js:18-46`; `EasyMod-backend/src/modules/policy/rules/templateRequired.rule.js:41-54`; `README.md:24-30`; `EasyMod-frontend/src/app/components/inbox/InboxThreadDetail.tsx:264-280` |
| Medium | Prompt persona example numbers become grounding source numbers. | `PARTIALLY VERIFIED` grounding risk | `EasyMod-backend/src/modules/ai/intent-router.service.js:891-905,697-710`; `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:69-85` |
| Medium | Prompt injection sanitizer and legacy guardrail are not on live worker path. | `PARTIALLY VERIFIED` security gap | `EasyMod-backend/src/modules/ai/prompt-sanitizer.service.js:21-81`; `EasyMod-backend/src/modules/ai/guardrail.service.js:20-68`; `EasyMod-backend/src/jobs/message-worker.js:23-36` |
| Medium | PII scrubbing covers only the text-only full LLM message; FAQ/photo prompts, raw history, and sentiment input can carry unredacted customer text. | `PARTIALLY VERIFIED` privacy gap | `EasyMod-backend/src/modules/ai/intent-router.service.js:335-340,590-596,839-861`; `EasyMod-backend/src/jobs/message-worker.js:101-116`; `EasyMod-backend/src/modules/ai/sentiment.service.js:113-135` |
| Medium | The 500-character input guard belongs to the unmounted HTTP chatbot route; live webhook text reaches the worker without that guard. | `PARTIALLY VERIFIED` input-boundary gap | `EasyMod-backend/src/modules/ai/prompt-sanitizer.service.js:8-12`; `EasyMod-backend/src/modules/conversation/ai-chatbot.controller.js:111-115,303-365`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:495-512` |
| Medium | `business_hours` exists in the entity and policy rule but is absent from the canonical Meta settings whitelist; the rule also ignores timezone and may not match the documented array shape. | `PARTIALLY VERIFIED` configuration gap | `EasyMod-backend/src/modules/channel-providers/meta-channel.controller.js:205-210,249-265`; `EasyMod-backend/src/modules/channel-providers/meta-channel-settings.entity.js:47-53`; `EasyMod-backend/src/modules/policy/rules/businessHours.rule.js:12-16,29-41` |
| Medium | Transactional payment/delivery/invoice notifications can resolve the oldest shop Page instead of the originating Page because the compatibility shim is not given `meta_channel_id`. | `PARTIALLY VERIFIED` communication-routing risk | `EasyMod-backend/src/modules/webhook/webhook.service.js:73-87,204-228`; compare `EasyMod-backend/src/jobs/message-worker.js:381-385` |
| Medium | Manual and transactional outbound paths omit policy `settings`, so `draftMode` defaults them to non-delivering `DRAFT`; the handoff path passes raw channel settings rather than effective shop-plus-channel settings. Their “send” behavior is therefore an attempt rather than a verified delivery capability. | `PARTIALLY VERIFIED` | `EasyMod-backend/src/modules/conversation/conversation.controller.js:227-301,450-478`; `EasyMod-backend/src/modules/conversation/human-handoff.service.js:81-108`; `EasyMod-backend/src/modules/webhook/webhook.service.js:98-170`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:20-27` |
| Medium | Production README says `/ai-chatbot`, `/payment/bangladesh`, IG delivery, and auto-index are active, but current routes/config/tests contradict it. | `CONTRADICTED` documentation | `EasyMod-backend/README.md:118-168,242-260`; `EasyMod-backend/src/modules/routes.js:31-65`; `EasyMod-backend/src/security/__tests__/route-perimeter.test.js:10-21`; `EasyMod-backend/src/jobs/queue-manager.js:41-56` |
| Medium | Historical AI cost/retrieval docs describe old embedding/provider behavior inconsistent with current runtime resolver. | `CONTRADICTED` historical documentation | `docs/ai-cost/AI_CALL_GRAPH.md:24-26`; `EasyMod-backend/src/modules/rag/embedding.service.js:303-345`; `docs/ai-cost/RETRIEVAL_QUALITY_EVALUATION.md:52-72` |
| Low | Frontend and quarantined chatbot tests assert obsolete `/api/ai-chatbot/process` and obsolete model metadata. | `TESTED_BUT_DISCONNECTED` | `EasyMod-frontend/tests/e2e/chatbot-journey.test.js:255-286,464-483`; `EasyMod-backend/tests/quarantine.json:26-30` |

## 21. Final Intent Map

The following is the concise canonical map of every production-reachable customer branch. The names are audit identifiers, not persisted application enums.

```text
stop_opt_out
  Detection: exact STOP/unsubscribe keywords in inbound webhook
  Required context: shop + customer + channel
  Retrieval: none
  Reasoning: deterministic consent
  Allowed tools: consent service, burst cancellation
  Confirmation: explicit customer opt-out phrase
  Action: suppress AI dispatch
  Side effects: consent JSONB + consent audit event
  Response: no AI response
  Fallback: consent failure currently continues dispatch
  Hard boundary: must not message an opted-out customer

greeting
  Detection: pure greeting regex or high-confidence BERT greeting
  Required context: language and shop
  Retrieval: none
  Reasoning: deterministic template
  Allowed tools: message store, grounding/policy, Meta send
  Confirmation: none
  Action: answer or hold/send
  Side effects: AI row, policy row, optional outbound
  Response: language-specific greeting
  Fallback: static keyword greeting
  Hard boundary: mode/policy/consent still control send

order_status_lookup
  Detection: bare 5-8 digit number in text (mainly legacy/imported numeric order numbers)
  Required context: shop + number; customer identity is missing
  Retrieval: shop-scoped orders row
  Reasoning: deterministic formatting
  Allowed tools: order read and response cache
  Confirmation: none
  Action: read-only status reply
  Side effects: process-local cache
  Response: order/payment/delivery/tracking fields
  Fallback: continue to normal router if DB lookup misses/fails
  Hard boundary: no cross-shop read, but same-shop customer ownership is not enforced

product_inquiry
  Detection: product terms/attributes or non-chatter message reaching product search
  Required context: shop + message + optional history/image
  Retrieval: live PostgreSQL catalog plus optional Qdrant candidates
  Reasoning: conjunctive product evidence; LLM only where needed
  Allowed tools: product search, RAG, knowledge, operating context, grounding
  Confirmation: none for facts
  Action: answer, offer real alternatives, or ask clarification
  Side effects: AI row/cache/policy telemetry/optional send
  Response: grounded price/stock/attributes/media status
  Fallback: not-found, unknown-attribute, retrieval-failed deterministic copy
  Hard boundary: no unsupported product fact, price, URL, or image

product_photo_lookup
  Detection: customer image attachment
  Required context: first image URL + shop + optional caption
  Retrieval: RAG/text; optional CLIP/vision; live catalog re-fetch
  Reasoning: image attributes are candidates, catalog row is authority
  Allowed tools: image matcher, LLM vision, product search, RAG, media gate
  Confirmation: none
  Action: identify product and answer; attach verified product image only
  Side effects: AI row/grounding telemetry/optional attachment send
  Response: match/no-match/image unavailable
  Fallback: ask for product name or state image cannot be processed
  Hard boundary: photo does not prove shop inventory; first image only

faq_knowledge_policy_question
  Detection: active FAQ SQL token hit or full LLM/RAG path
  Required context: shop message language live operating context
  Retrieval: FAQ rows, Qdrant snippets, business info, current payment/courier settings
  Reasoning: LLM phrasing constrained by prompt/evidence gate
  Allowed tools: knowledge reads, RAG, LLM, grounding, policy
  Confirmation: none
  Action: answer or hold/handoff
  Side effects: FAQ hit counter, AI row, policy row, optional send
  Response: shop-specific answer when supplied
  Fallback: unknown/holding response and knowledge gap
  Hard boundary: unsupported merchant claims are not fully claim-validated

general_chat_or_unknown
  Detection: no deterministic branch or router failure
  Required context: current message + up to ten prior turns
  Retrieval: optional product/FAQ/RAG context
  Reasoning: Gemini/OpenAI text generation
  Allowed tools: LLM, grounding, confidence, policy
  Confirmation: none
  Action: answer/clarify/hold
  Side effects: AI row, possible HITL and send
  Response: generated or generic fallback
  Fallback: keyword/static response, confidence 0 on total failure
  Hard boundary: not a general database or arbitrary-tool agent

purchase_intent_start
  Detection: conservative buy/order phrase
  Required context: shop + customer channel + product text/photo
  Retrieval: shop-scoped order product search and optional image match
  Reasoning: deterministic product identification
  Allowed tools: product search, image match, order-session create
  Confirmation: customer purchase phrase starts session
  Action: create/resume order session or ask for product
  Side effects: order_sessions row
  Response: quantity/product selection prompt or product-needed response
  Fallback: safe unavailable/product-needed response
  Hard boundary: no order exists merely because conversational LLM says so

order_session_checkout
  Detection: active order session
  Required context: durable session step_data and current customer answer
  Retrieval: live product/stock, delivery zones, payment settings, RTO
  Reasoning: deterministic step machine
  Allowed tools: session, product, payment verification, order creation, courier
  Confirmation: summary intends to require YES, but substring matching can accept unrelated text
  Action: collect data and create order
  Side effects: order/items/stock/usage/notification/courier
  Response: next step, summary, order number, invoice/closing text
  Fallback: business rejection or generic order failure
  Hard boundary: merchant approval settings are not enforced before mutation

order_session_cancel
  Detection: explicit cancellation phrase while session is active
  Required context: active shop-scoped session
  Retrieval: none
  Reasoning: deterministic
  Allowed tools: cancel session
  Confirmation: explicit customer cancellation
  Action: mark session CANCELLED
  Side effects: order_sessions update
  Response: cancellation confirmation
  Fallback: current bridge can report success even if cancellation fails
  Hard boundary: cannot cancel an existing order

cart_edit_or_add_more
  Detection: active ADD_MORE/summary edit step
  Required context: durable cart and current answer
  Retrieval: shop product/stock
  Reasoning: deterministic line parser
  Allowed tools: session, product search/stock
  Confirmation: final order summary still required
  Action: mutate pre-order cart
  Side effects: session step_data only
  Response: picker/quantity/next-step prompt
  Fallback: re-prompt/numbered picker
  Hard boundary: cannot modify a committed order

self_mfs_payment_verification
  Detection: screenshot at AWAITING_MFS_SCREENSHOT
  Required context: expected amount/receiver/type and shop
  Retrieval: safe media + Gemini OCR + TrxID log
  Reasoning: deterministic fraud and match checks after OCR
  Allowed tools: screenshot verifier
  Confirmation: customer supplies screenshot
  Action: intended to mark verification success/failure; canonical flow fails before OCR
  Side effects: TrxIDLog/session data only on a reachable successful verification path
  Response: payment confirmed or rejection/retry
  Fallback: fail closed
  Hard boundary: no stored expected total and undefined session.order_id prevent canonical verification

sentiment_handoff
  Detection: angry/frustrated keyword or LLM sentiment
  Required context: conversation + originating channel
  Retrieval: sentiment dictionary/LLM
  Reasoning: deterministic escalation predicate
  Allowed tools: HITL, notification, holding-message send
  Confirmation: none
  Action: pause AI and notify human
  Side effects: HITL, notification, holding AI row, optional send
  Response: holding reassurance
  Fallback: holding delivery failure is swallowed
  Hard boundary: human must resolve customer issue

low_confidence_or_grounding_failure
  Detection: confidence/policy/grounding outcome
  Required context: candidate + evidence + shop mode
  Retrieval: evidence already produced
  Reasoning: deterministic safety gate
  Allowed tools: knowledge gap, HITL, policy, holding message
  Confirmation: human review for held candidate
  Action: hold, fallback, suppress, or handoff
  Side effects: held AI row, HITL/gap/policy records
  Response: safe copy or holding response
  Fallback: suppress rather than guess
  Hard boundary: no candidate bypasses grounding/policy on worker path

modification_return_complaint_delay
  Detection: keyword fallback after router failure
  Required context: conversation/shop/customer
  Retrieval: none
  Reasoning: deterministic keyword mapping
  Allowed tools: support ticket + handoff marker
  Confirmation: human resolution
  Action: create ticket/mark handoff
  Side effects: SupportTicket and conversation status/message
  Response: representative will contact customer
  Fallback: generic low-confidence fallback if ticket path fails
  Hard boundary: no existing-order mutation/refund/return execution
```

## 22. Final Capability Matrix

| Capability | Final status | Evidence |
|---|---|---|
| Facebook Messenger customer replies | `AUTONOMOUS` in `AI_ACTIVE`; `DRAFT_ONLY` in Draft | `EasyMod-backend/src/jobs/message-worker.js:724-831`; `EasyMod-backend/src/modules/policy/rules/draftMode.rule.js:15-27` |
| Greetings | `AUTONOMOUS` subject to policy | `EasyMod-backend/src/modules/ai/intent-router.service.js:253-266` |
| Product search and identification | `READ_ONLY` data plus `AUTONOMOUS` response | `EasyMod-backend/src/modules/product/product-search.service.js:103-135`; `EasyMod-backend/src/modules/ai/grounding/product-evidence.service.js:315-376` |
| Product price/stock/variants/known attributes | `AUTONOMOUS` only when grounding evidence verifies them | `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:244-274` |
| Product image attachment | `AUTONOMOUS` only for exact verified product-owned HTTPS media | `EasyMod-backend/src/modules/ai/grounding/outbound-grounding.gate.js:202-223`; `EasyMod-backend/tests/meta-e2e/meta-e2e.test.js:525-552` |
| Customer photo matching | `PARTIAL` | `EasyMod-backend/src/modules/ai/image-product-matcher.service.js:143-228`; optional services absent from compose |
| FAQ/business/policy answers | `PARTIAL`/`AUTONOMOUS` for supplied facts | `EasyMod-backend/src/modules/knowledge/knowledge.service.js:545-615`; grounding limitation in Section 11 |
| Order status lookup | `READ_ONLY` | `EasyMod-backend/src/modules/ai/intent-router.service.js:220-247`; customer ownership not checked |
| Start/continue checkout | `AUTONOMOUS` session workflow | `EasyMod-backend/src/modules/conversation/order-flow.service.js:148-252`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:342-360` |
| Create order after customer confirmation predicate | `CONFIRMATION_REQUIRED` and `PARTIAL` | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:684-721,1270-1283`; overbroad confirmation and Draft/approval gap |
| Existing-order edit/cancel | `HUMAN_ONLY` | No AI call edge; merchant routes in `EasyMod-backend/src/modules/order/order.service.js:465-550,846-890` |
| Returns/refunds | `HUMAN_ONLY` | No AI mutation call edge; `EasyMod-backend/src/modules/order/order.service.js:894-917` |
| Self-MFS payment verification | `IMPLEMENTED_BUT_UNREACHABLE` in canonical checkout | `EasyMod-backend/src/modules/payment/self-mfs-handler.service.js:203-229`; `EasyMod-backend/src/modules/order/order-session-standalone.service.js:636-659,1681-1717` |
| Courier booking | `PARTIAL` and autonomous after the confirmation predicate returns true | `EasyMod-backend/src/modules/order/order-session-standalone.service.js:792-793,1152-1213` |
| Delivery tracking/order-status mutation | `IMPLEMENTED_BUT_UNREACHABLE` by AI | `EasyMod-backend/src/modules/delivery/delivery-tracking.service.js:49-160`; no worker/router caller |
| Customer profile enrichment | `PARTIAL` autonomous side effect | `EasyMod-backend/src/modules/customer/customer-profile.service.js:80-135` |
| Customer CRUD/tags/segmentation/notes | `HUMAN_ONLY` | Merchant routes/services only; no AI call edge |
| Human handoff | `AUTONOMOUS` trigger, `HUMAN_ONLY` resolution | `EasyMod-backend/src/modules/conversation/human-handoff.service.js:35-126` |
| Merchant AI settings | `HUMAN_ONLY` | `EasyMod-backend/src/modules/shop/shop.controller.js:408-464` |
| Merchant FAQ management | `HUMAN_ONLY` | `EasyMod-backend/src/modules/knowledge/knowledge.service.js:243-303` |
| Merchant product import | `DRAFT_ONLY` pending merchant approval | `EasyMod-frontend/src/app/components/Products.tsx:205-314` |
| Merchant voice transcription | `READ_ONLY` | `EasyMod-backend/src/modules/ai/voice-processing.controller.js:21-48` |
| Product recommendations/upsells | `IMPLEMENTED_BUT_UNREACHABLE` by AI | `EasyMod-backend/src/modules/product/product-upsell.service.js:26-142`; `EasyMod-backend/src/modules/product/product.routes.js:23-32` |
| Instagram/WhatsApp/Telegram customer chat | `NOT_IMPLEMENTED` | `EasyMod-backend/src/modules/channel-providers/provider.registry.js:11-36` |
| Public comment automation/comment-to-DM | `NOT_IMPLEMENTED` in active webhook path | `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:442-444`; `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js:489-500` |
| Cold-DM/broadcast automation | `NOT_IMPLEMENTED` | `README.md:24-30`; no production entry/tool edge found |
| Arbitrary tool/function calling | `NOT_IMPLEMENTED` | No tool registry or function-call handling in `EasyMod-backend/src/modules/ai/llm.service.js` or worker |
| Autonomous multi-step planning across tools | `NOT_IMPLEMENTED` | Hardcoded worker/order sequence; no planner loop found |

## 23. Final Boundary Statement

**The EasyModerator AI assistant can autonomously...** receive Facebook Messenger DMs, maintain a bounded conversation/order-session state, answer grounded greetings/product/FAQ/business questions, escalate selected sentiment or safety cases, send policy-approved conversational replies in active automation mode, create an order when its checkout confirmation predicate returns true, and attempt courier booking for that created order. The canonical self-MFS screenshot path does not successfully reach OCR verification.

**The EasyModerator AI assistant can read/recommend but cannot autonomously...** safely expose customer-owned order status without an identity check, compare products through a dedicated AI workflow, use the merchant upsell service, mutate an existing order, cancel a committed order, approve returns/refunds, edit products, change customers, change channel/subscription/settings, or select arbitrary backend tools.

**The EasyModerator AI assistant requires confirmation before...** it is intended to create an order: the customer is shown a final summary and the code checks a confirmation predicate. That predicate uses substring matching and can accept unrelated text; this is customer-side confirmation logic, not merchant approval. The current code does not enforce merchant approval settings before the mutation.

**The EasyModerator AI assistant requires a human/merchant to...** resolve HITL conversations, review and manually handle held Draft suggestions (the UI uses copy/paste and delivery is only attempted because the manual path can be denied by default Draft policy), handle existing-order changes/cancellations/returns/refunds, correct unsupported or unknown business information, manage merchant knowledge/settings/products/customers/couriers, and resolve courier/payment cases that fail automated checks.

**The EasyModerator AI assistant has no production capability to...** receive Instagram, WhatsApp, Telegram customer messages; automate public comments or comment-to-DM; cold-DM or broadcast; execute arbitrary LLM-selected tools; perform autonomous planning; or use the unmounted `/api/ai-chatbot/*` endpoint.

**The EasyModerator AI assistant must never be assumed capable of...** knowing a product, price, stock level, variant, material, policy, delivery fact, payment fact, or order state merely because a model, prior assistant message, vector similarity result, UI label, installed dependency, backend service, stale documentation page, or quarantined test mentions it. Only the reachable execution paths and the evidence boundaries documented above establish capability.
