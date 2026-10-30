# Pilot+ V1 — 02. Current-State and Reuse Inventory (Phase 1)

Evidence base: five read-only discovery maps (`_raw-discovery-a..f` in this folder, 2026-10-24) against `f0f04e4e`; every claim is source-cited. Classification vocabulary: REUSE_UNCHANGED / CONNECT_EXISTING / ADAPT / EXTEND / NEW_MINIMAL_COMPONENT / DEFER / REJECT.

## 0. Integration surface inventory (§1.3)

**Changed AI contracts between production `2a8c1e2d` and this tree** (git diff surface, agent E): ~40 runtime source files — `intent-router.service.js` (1.5/1.7/1.8/2/3 stages, deterministic product reply), `message-worker.js` (turn recovery, grounding verdicts, revalidation), `ai/grounding/*` (V1.3 product-evidence + outbound gate), `product-search.service.js`, `MetaMessengerProvider.js`/`MetaPortfolioMessengerProvider.js` (v22.0, appsecret_proof), `meta-oauth.service.js`+Page grants (8140efb8..febfc0d8 already in ancestry), `shop-operating-context.service.js` (strict/hash), `ai-chatbot.controller.js` routing test, webhook durability integration test. Orders/Payment/Delivery/Inbox/Knowledge/migrations = ZERO changes vs production ⇒ production compatibility requirements for those engines are unchanged and inherited.

**Concurrent/other-agent ahead-of-base work touching adjacent files (integration dependencies, NOT conflicts at build time):**
- `feature/orders-execution-workspace-v2` @3b68c699 — `order.service.js`, `order-idempotency.service.js`, order controller/validator + FE workspace.
- `feature/merchant-first-v4-v6`/`merchant-journey-v6-action-first`/`integrate/v6-public-merchant-unified` @f6c55d70 — action-first V6 journey touching `order.service.js`, `InboxThreadList.tsx`, `UnifiedInbox.test.tsx`. **P+01/P+03 Inbox frontend edits must be additive & surgical; record merge-order dependency.**
- `feature/mobile-app` @ba09a80c/35d81d16/939de5dc — `order.service.js`, mobile inbox; mobile ADR M-008 defines `/api/mobile/attention` contract (docs/mobile) — P+03 read model must be compatible/sibling, not competing.
- `feat/pilot-customer-rto-completion` @41e5d49f — order-customer integrity (its CustomerOpportunity lineage already in base via migration 20260927_001).
No live processes/Agent Manager sessions exist; all above are static worktrees. Pilot+ will not touch those worktrees; future merge coordination is an explicit handoff item.

**Ownership check for P0 remediation (§4.3):** branch-wide commit scan (2026-10-24) shows NO other branch contains commits modifying the retired-tag policy rules, self-mfs OCR path, or dual payment-source files — remediation is unowned and in-scope for Pilot+ as isolated prerequisite commits (V-1/V-5/V-6 verified below).

## 1. P+01 Inbox Lead Intelligence

```text
CAPABILITY_ID: P+01
CUSTOMER_OR_MERCHANT_PROBLEM: merchant must jump across Customers/Opportunity pages to know
  which inbox conversation is a real buying opportunity and what to do next.
CURRENT_SOURCE_IMPLEMENTATION: complete deterministic engine — opportunity-signals.js
  (reason codes, strengths, negation/suppression), opportunity.service.js (OPEN->ACTIONED->
  CONVERTED/DISMISSED/EXPIRED, advisory locks, merge dedup, expiry, recommendedAction),
  opportunity-detector.job.js (*/10min, per-shop flags, cap 200), CustomerOpportunity model
  (partial unique live index), contactability.js, pilot-features (fail-closed flags),
  /api/customer-intelligence routes (JWT tenant, audited actions), Customer360Page/
  OpportunityCard frontend (deep-link ?conversation= already exists).
CURRENT_REACHABLE_WORKFLOW: merchant opens Customers -> opportunities tab -> card -> Inbox link.
EXISTING_FRONTEND: OpportunityCard.tsx, Customer360Page.tsx; Inbox shows NO opportunity signal.
EXISTING_DATABASE: customer_opportunities + shop_pilot_features (migration 20260927_001).
EXISTING_TESTS: opportunity-signals.test.js (25), customer-intelligence.integration.test.js,
  boundary security test, migration test, frontend Customer360 tests.
WHAT_ALREADY_WORKS: detection, qualification (single price question NOT enough), suppression
  (negation/STOP/opt-out), dedupe/concurrency, conversion only from real committed order,
  lifecycle API, per-shop flags, manual follow-up discipline (ADR-0008).
WHAT_IS_MISSING: (a) opportunity presence inside Inbox thread list/detail; (b) inbox-side API
  returning the live opportunity for a conversation without competing scoring; (c) compact
  merchant action (mark contacted / dismiss w/ reason) surfaced in Inbox.
WHAT_SHOULD_BE_REUSED: entire engine; conversation->customer linkage (Conversation has
  customer_id); existing contacted/dismiss endpoints + TS types; SSE conversation_updated/
  customer_updated pattern.
MINIMUM_REQUIRED_CHANGE: EXTEND server read: conversation list/detail payload gains
  `open_opportunity` projection {id, strength, reasons[], status, recommended_action,
  contactable} sourced from the SAME CustomerOpportunity rows (single join, no new engine,
  no new score). ADAPT InboxThreadList chip + InboxThreadDetail compact "why flagged" strip
  with the two existing merchant actions calling existing endpoints. Server-side 409
  conflict + reason-code display reused verbatim.
DEPENDENCIES: conversation.service.deriveWorkflowProjection area; v6-action-first overlap
  noted; no DB migration needed.
SECURITY_IMPLICATIONS: none new if projection is shop-scoped by JWT and read-only; actions
  keep existing audited endpoints; never expose raw signals (ids only already).
STOREFRONT_REUSE_IMPLICATIONS: projection is channel-agnostic (conversation+customer keyed);
  storefront future surface reads same opportunity API — no Messenger payload in it.
CLASSIFICATION: CONNECT_EXISTING (backend read) + ADAPT (frontend). REJECT: any second
  lead-score service, any Inbox-side detector, any auto-outreach (meta-safe + ADR-0008).
```

## 2. P+02 Structured Customer Choices

```text
CAPABILITY_ID: P+02
CUSTOMER_OR_MERCHANT_PROBLEM: customers type long answers for simple decisions; merchants lose
  sales to friction; typed answers are ambiguous (esp. mid-checkout).
CURRENT_SOURCE_IMPLEMENTATION: NONE for interactive choices. Verified: outbound supports only
  text/image/file (MetaMessengerProvider.sendMessage L1036-63); inbound quick_reply payload is
  captured into Message.metadata (meta-webhook-events.handler L1079-83) but has ZERO consumers;
  messaging_postbacks not subscribed. Generic interaction record does not exist.
CURRENT_REACHABLE_WORKFLOW: text-only conversation; step machine free-text capture.
EXISTING_FRONTEND: composer quick-reply popover is MERCHANT canned replies only (InboxComposer
  L316-520) — unrelated.
EXISTING_DATABASE: nothing to reuse for choices; Message metadata can carry send-side record.
EXISTING_TESTS: meta-webhook.routes.test.js asserts payload capture only.
WHAT_ALREADY_WORKS: ingress persistence of tapped payload (durable receipts + dedup already
  protect replay); outbound policy chain; Action Gate with deterministic idempotency keys;
  draft/HITL lifecycle.
WHAT_IS_MISSING: (a) channel-neutral interaction proposal contract; (b) server-issued
  opaque choice token + validation; (c) provider quick_replies outbound construction;
  (d) payload->intent executor wiring with authz/reload; (e) lifecycle states
  (generated/eligible/sent/selected/expired/superseded/rejected/completed); (f) text fallback.
WHAT_SHOULD_BE_REUSED: policy engine (no exemption for interactive sends); Action Gate;
  message-lifecycle states; stage2 classifier for typed equivalence; ai contracts pattern
  (action.contract deriveIdempotencyKey) for token design.
MINIMUM_REQUIRED_COMPONENT: NEW_MINIMAL_COMPONENT `modules/interactions/` —
  InteractionProposal {id(opaque), shop_id, customer_id(+channel scope), conversation_id,
  kind(clarify|checkout_decision|human_support), options[{id,title,payload_ref}], bound
  context {session_id/step, version}, expires_at, status, created_by, send_id} persisted
  rows (small table), token payload = `p+<opaqueId>` (<1000ch, title<=20ch display from
  option); resolver: webhook payload -> load row FOR UPDATE -> verify shop/customer/channel/
  conversation + expiry + not-superseded -> dispatch to ALLOWED_OPERATION handlers which
  RELOAD business state then call existing services (order-flow processStep-equivalent,
  handoff, FAQ answer) under Action Gate when mutating. Messenger adapter builds
  quick_replies; free-text path untouched — typed replies keep working (existing stage2);
  future storefront adapter = same proposal+resolve contract over REST (documented, not built).
DEPENDENCIES: outbound Grounding/policy integration; Meta-shaped tests; P+04 session binding.
SECURITY_IMPLICATIONS: token must be tamper-resistant server-side reference (NOT self-encoded
  claims); replay -> row already SELECTED/terminal => no-op; forged/other-shop/customer/
  channel/expired/superseded -> reject + metric; choice tap NEVER stands for payment/stock/
  price truth — confirmation requires summary hash + Gate revalidation (existing).
STOREFRONT_REUSE_IMPLICATIONS: proposal/resolve API is channel-keyed; Messenger-specific
  serialization confined to provider adapter.
CLASSIFICATION: NEW_MINIMAL_COMPONENT + EXTEND provider sendMessage with quick_replies only
  (single new body field). REJECT: button/generic templates for pilot (postback subscription +
  more surface); per-visual-element rows; LLM-chosen actions.
```

## 3. P+03 Merchant Action Queue

```text
CAPABILITY_ID: P+03
CUSTOMER_OR_MERCHANT_PROBLEM: merchant does not know which conversation/issue needs attention
  next across HITL, drafts, failed sends, opportunities, unfinished checkouts.
CURRENT_SOURCE_IMPLEMENTATION: needs-attention is DERIVED in conversation.service
  .deriveWorkflowProjection L275-356 with reasons HITL_REQUIRED/DRAFT_REVIEW_REQUIRED/
  CUSTOMER_UNANSWERED/AI_FAILED/PROVIDER_SEND_FAILED (already the authoritative fact set);
  UnifiedInbox consumes it (tabs needs_review, badges); Dashboard /api/dashboard/queue exists
  but M-008 ADR documents it as unreliable ("counts statuses nothing writes"); mobile ADR
  M-008 designs ranked /api/mobile/attention merging draft orders/inbox/courier/stock/RTO.
  HITL fields exist on Conversation (hitl, assignee_id, resolved_at, resolution_note) +
  handoff service emits SSE (hitl_changed); human-handoff test suite exists.
CURRENT_REACHABLE_WORKFLOW: Inbox needs_review tab; no global ranked action list; no
  handoff ownership claim UI beyond take-over/resume; held/failed messages visible per thread.
EXISTING_FRONTEND: InboxThreadList tabs+badges; InAppNotificationCenter (owner actions);
  Dashboard pulse cards.
EXISTING_DATABASE: conversations, messages (delivery_state HELD/FAILED), order_sessions
  (ACTIVE/expired), customer_opportunities — all sufficient sources; NO task table exists.
EXISTING_TESTS: conversation.service tests, human-handoff.test.js, UnifiedInbox.test.tsx.
WHAT_ALREADY_WORKS: per-thread attention reasons; HITL take-over/resume with audit
  (HUMAN_TAKEOVER); resume boundary; outbox reconciler keeps provider truth; delivery-failed
  surfaces.
WHAT_IS_MISSING: (a) one ranked, cross-thread aggregation read model for the merchant web
  inbox; (b) handoff ownership semantics sufficient for "a person took responsibility"
  (assignee exists but resolution outcome recording + re-enable automation flow partial);
  (c) stale-read protection (completed item resurfacing).
WHAT_SHOULD_BE_REUSED: deriveWorkflowProjection reasons as THE vocabulary; Conversation.hitl/
  assignee/resolved_* as handoff record (it is sufficient — REJECT separate case table);
  opportunity live rows (P+01); order_sessions ACTIVE+expired as "customer blocked";
  messages delivery_state FAILED/HELD as "action committed but acknowledgment failed"
  (worker already sets executed_mutation_without_outbound_send metadata — the strongest
  reconciliation reason); SSE sse-bus fan-out + Last-Event-ID replay.
MINIMUM_REQUIRED_CHANGE: EXTEND backend: GET /api/inbox/actions (read-only aggregate, per
  request, deterministic rank: 1 needs-human(HITL/explicit handoff) 2 committed-without-
  ack(PROVIDER_SEND_FAILED/held-after-mutation) 3 customer blocked in checkout 4 failed/
  held draft recovery 5 qualified opportunity needing review 6 knowledge gap (P+05 phase,
  gated); each item = {reason, source_type+source_id (authoritative), conversation id,
  status as-of, next_action token}. Server recomputes from live rows — NEVER persists task
  copies (stale-proof; idempotent by construction; dismiss not needed beyond resolving the
  source state). Frontend: ADAPT UnifiedInbox needs_review to surface ranked list panel
  (no new dashboard route), mobile M-008 compatible ranking constants shared server-side.
DEPENDENCIES: P+05 gap item arrives in its phase; v6-action-first overlap on InboxThreadList.
SECURITY_IMPLICATIONS: shop-scoped by JWT; role: owner/staff see actions per existing
  conversation access; resolution endpoints must enforce server-side role (existing pattern
  OrderConfidence owner-only approve to copy).
STOREFRONT_REUSE_IMPLICATIONS: items keyed by domain entities not channel payloads.
CLASSIFICATION: EXTEND + CONNECT_EXISTING. REJECT: task database, notification stream
  duplication, AI-ranked feed (M-008 already rejects), separate Support dashboard (HITL
  record sufficient per §9.4).
```

## 4. P+04 Context-Preserving Checkout

```text
CAPABILITY_ID: P+04
CUSTOMER_OR_MERCHANT_PROBLEM: verified F1/F2 — "delivery charge koto?" mid-checkout becomes the
  customer's NAME (COLLECTING_NAME stores ANY 2-50ch L752-54); "where is my order 12345?"
  DESTROYS the new checkout (terminal-intent cancelSession L169-73); no PAUSED state exists.
CURRENT_SOURCE_IMPLEMENTATION: order-flow.service.js bridge (5 terminal intents only escape);
  order-session-standalone.service.js machine (12 steps; 24h expiry; resume re-asks current
  step; revalidation + materialStateRevalidated + summary hash at confirm L956-978,L1065-87);
  stage2-rules can already classify informational intents; confidence gate exempts order-flow
  turns; Action Gate guards mutations; worker mutationsAllowed = AUTO && allow_order_creation.
CURRENT_REACHABLE_WORKFLOW: capture-everything; cancel-on-terminal.
EXISTING_FRONTEND: none needed for state machine; InboxThreadDetail shows order_flow meta.
EXISTING_DATABASE: order_sessions.step_data JSON already snapshots everything.
EXISTING_TESTS: order-flow.service.test.js LOCKS current cancel behavior (L136-53) —
  intentionally rewritten with evidence; steps/freetext-edit/createorder suites.
WHAT_ALREADY_WORKS: confirmation revalidation (stock+price+summary hash+re-confirm),
  idempotent CREATE_ORDER key incl. summary hash, negation guards, courier-fail-after-commit
  reconciliation, send-fail-after-commit HELD template, zone keywords, BN digits quantity.
WHAT_IS_MISSING: (a) safe-informational interruption class: route DELIVERY_CHARGE/
  PAYMENT_METHODS/POLICY/PRODUCT clarification to authoritative engines WITHOUT writing to
  the field, then RESUME exact prior step; (b) PAUSED/suspended session status with resume;
  (c) human-support interruption -> durable handoff WITHOUT cart destruction;
  (d) ORDER_STATUS_LOOKUP/POST_PURCHASE must NOT cancel a NEW checkout; (e) question-shape
  guard inside field steps (belt: '?'+ki/koto or stage2 non-terminal informational intent =>
  answer, don't capture).
MINIMUM_REQUIRED_CHANGE: ADAPT bridge: classify() for every active-session turn; terminal set
  split — STOP_OPT_OUT + explicit ORDER_SESSION_CANCEL keep existing cancel path (verified
  command targets current session); HUMAN_HANDOFF/SENTIMENT => pause+handoff (session
  SUSPENDED, step preserved, resume boundary); ORDER_STATUS_LOOKUP/POST_PURCHASE => answer
  via existing order lookup, session stays ACTIVE-paused; informational intents =>
  passthrough to normal AI pipeline (grounded answer) then deterministic "resume?" re-prompt
  of current step; field steps get question guard. EXTEND status enum + transition tests.
  NO model call added to deterministic enforcement (classification already rule/BERT local).
DEPENDENCIES: P+02 interaction tokens optional for resume/confirm choices; V-2 'confirmed'
  coercion must be fixed first (committed order truth); P+03 surfaces blocked-customer items.
SECURITY_IMPLICATIONS: pause must not bypass opt-out/STOP terminal authority; cancel still
  requires explicit non-negated command; resume only same shop/customer/channel/session.
STOREFRONT_REUSE_IMPLICATIONS: interruption classes are session-level, channel-neutral;
  storefront checkout can reuse the same state machine rules.
CLASSIFICATION: ADAPT (bridge) + EXTEND (session status enum, minimal migration: status
  VARCHAR/ENUM add value + tests). REJECT: rewriting order machine; LLM for state safety.
```

## 5. P+05 Actionable Knowledge Gaps

```text
CAPABILITY_ID: P+05
CUSTOMER_OR_MERCHANT_PROBLEM: unanswered questions recur; merchant has read-only gap table in
  Reports and no path from gap -> approved answer.
CURRENT_SOURCE_IMPLEMENTATION: gap capture (knowledge-gap-capture.service.js recordKnowledgeGap;
  triggers low_confidence_handoff + ai_unknown_response in worker L2649-98; REST /api/analytics/
  knowledge-gap cross-shop 403 + transactional audit); knowledge_gaps entity (question text,
  platform, language, source); GET /api/knowledge/gaps aggregation L316-351 (normalized
  frequency top-200); FAQ CRUD w/ is_active + RAG sync (faq-<id> doc id, deactivate->delete);
  FaqSettings.tsx; orphan KnowledgeExtraction type (status review/approved/rejected) in
  knowledgeTypes.ts unused.
CURRENT_REACHABLE_WORKFLOW: merchant sees gap list in Reports (read-only) -> manually authors
  FAQ in FaqSettings.
EXISTING_FRONTEND: FaqSettings.tsx (authoring), Reports.tsx (read-only gaps).
EXISTING_DATABASE: knowledge_gaps (SERIAL id, no shop-level dedup beyond text normalization);
  faq_responses; retrieval via Qdrant rag.service + knowledge snapshot hashing.
EXISTING_TESTS: knowledge.test.js (43), gap-capture unit, auto-index contract, analytics gap
  security, FE Reports/domain tests.
WHAT_ALREADY_WORKS: capture with shop scoping + audit; normalized aggregation exists; active/
  inactive lifecycle + RAG sync already the approval mechanism (is_active=true == published).
WHAT_IS_MISSING: (a) persistent GAP-SUGGESTION lifecycle (open -> in_review -> published/
  dismissed) linking aggregated gaps to an authored FAQ with dedupe so dismissed gaps don't
  reappear without NEW evidence; (b) authoritative-owner routing (payment/delivery/product
  attribute => link to settings not FAQ prose); (c) merchant workflow in FAQ Settings page;
  (d) post-publish answerability confirmation (did future questions get answered).
MINIMUM_REQUIRED_CHANGE: NEW_MINIMAL_COMPONENT knowledge_gap_suggestions table (shop_id,
  normalized_question, evidence_count, first/last_seen, sample question ids NOT raw bursts,
  status OPEN/DISMISSED/PUBLISHED, resolved_faq_id, owner_domain enum PAYMENT|DELIVERY|
  PRODUCT|POLICY|OTHER, dismissed_reason; partial unique live per shop+norm key) + detection
  job reusing existing listGaps normalization (deterministic; NO model call); EXTEND
  FaqSettings.tsx with suggestions panel (review questions, author draft -> approve publishes
  via EXISTING FAQ create/update + RAG lifecycle; link-to-settings action for structured
  owners; dismiss w/ reason + evidence-reset cursor); FAQ gets suggestion provenance meta
  only. Truth priority: existing getKnowledgeForAI already excludes inactive; payment/delivery
  claims STILL pass outbound grounding gate which validates against enabled config — FAQ
  text can never override PaymentConfig/Delivery settings truth (already enforced; test it).
DEPENDENCIES: burst-flush gap rows store mini-transcripts possibly with PII — EXTEND capture
  to redact phone/TrxID patterns + cap to single utterance (small safety commit, in scope).
SECURITY_IMPLICATIONS: merchant-authored content only reaches customers after is_active +
  index; suggestions must not contain customer PII; per-shop isolation on list/dismiss.
STOREFRONT_REUSE_IMPLICATIONS: suggestions are channel-tagged but keyed by shop+normalized
  question; storefront Q&A misses feed the same capture path later.
CLASSIFICATION: EXTEND (capture hygiene) + NEW_MINIMAL_COMPONENT (suggestion lifecycle) +
  ADAPT (FaqSettings panel). REJECT: auto-publishing AI answers, new CMS, embeddings-based
  clustering in v1 (deterministic first per §11.1).
```

## 6. P0 safety reconciliation (§4.3) — verified status in this tree

| ID | Defect (as audited in decision doc) | Verified state at f0f04e4e | Owner / disposition |
|---|---|---|---|
| P0-1 | Retired Meta message tags emitted | STILL_PRESENT (V-5): ALLOWED_TAGS incl 3 tags retired 2026-04-27 (error 100; deprecated 2026-02-09); twentyFourHourWindow ALWAYS augments outside-window sends with DEFAULT_TAG=POST_PURCHASE_UPDATE -> such sends now FAIL at Meta (held/failed states). HUMAN_AGENT allow-list latent (permission not held; rule already blocks agent role). | NO other workstream owns it (branch scan). PREREQUISITE commit in Pilot+: outside-window sends without verified eligible-event evidence must HOLD (never blindly tag); remove retired tags from emit path; tests assert zero retired-tag wire bodies; decision doc + Meta sources 2026-10 (monocon/conferbot/unlockdm + provider comment). |
| P0-2 | Screenshot OCR treated as payment confirmation | LATENT, UNREACHABLE dead branch (V-1): gateway id never matches screenshot test; session.order_id nonexistent; controller path unmounted. Order payment truth itself preserved (self-mfs->pending; paid only via merchant confirm or verified webhook). | PREREQUISITE commit: delete/neutralize OCR->"Payment confirmed ✅" branch + executable invariant test (no payment-confirmation language from OCR alone). Not imported from elsewhere (scan: none exists). |
| P0-3 | Conflicting enabled-payment sources | STILL_PRESENT (V-6): PaymentConfig.is_enabled vs shop.settings.bd vs legacy defaults; disable/delete sync gaps; operating-context fails open to ''. Outbound gate already validates method claims vs enabled set (strength). | PREREQUISITE commit: single-authority adapter for AI payment context from PaymentConfig(+settings.bd number only as detail), fail-closed; disable/delete keep settings consistent; tests: disabled gateway never advertised in checkout or AI. |
| Adjacent | F3 committed order coerced confirmed->draft (V-2) | CONFIRMED at creation (order.service L22/L262-65/L423). | Prerequisite (in-scope: conversation checkout surface). Fix vocabulary coercion w/ regression tests incl. createOrderFromSession. |
| Adjacent | burst gap capture stores mini-transcripts (§11.1) | CONFIRMED (worker L1933/1946). | Fold into P+05 hygiene commit. |
| Adjacent | stale .easymod guidance still recommends retired tags | meta-safe-rules L19-23, meta-policy-skill L49-58 | Documentation correction commit (repo guidance integrity), citing Meta retirement + decision doc. |

## 7. Coherent-loop mapping (§0)

intent (stage2 + P+04 classes) -> verified context (receipts, dedup, tenant, contactability, enabled config) -> customer interaction (P+02 choices over text-equality) -> operational state (sessions, draft/HITL lifecycle, F3 fix) -> merchant action (P+01 projection + P+03 ranked read model) -> truthful outcome (P0 gates, invariants, groundings) -> measurable result (§16 instruments in doc 08).
