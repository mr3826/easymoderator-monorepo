# RAW DISCOVERY NOTE — Customer Intelligence & Knowledge (explore agent B, 2026-10-24)

(Saved verbatim for Phase-1 reconciliation; will be synthesized into 02-current-state-and-reuse-inventory.md.)

## A. Customer Intelligence

1. `EasyMod-backend/src/modules/customer-intelligence/opportunity-signals.js`
   - Pure deterministic extraction, no LLM, no numeric score; reason codes per ADR-0006. `DETECTOR_VERSION='opportunity-detector/1.0.0'` (L14).
   - Strengths STRONG/MEDIUM/WEAK (L16). INTENT_SIGNALS (L18-29): STRONG=PURCHASE_INTENT, CHECKOUT_CONFIRM_ATTEMPT, CART_ACTIVITY; MEDIUM=ASKED_AVAILABILITY/VARIANT/DELIVERY_CHARGE/DELIVERY/PAYMENT_METHOD; WEAK=PRODUCT_QUESTION, SENT_PRODUCT_PHOTO.
   - SUPPRESSING_INTENTS={ORDER_SESSION_CANCEL, STOP_OPT_OUT} (L32); negation via stage2-rules v1.1.0 (`isNegatedPurchase` L190, `isNegatedMutation` L198; negated purchase -> GENERAL_CHAT_OR_UNKNOWN).
   - `classifyMessage` (L51-81) runs stage2 with activeSession:false; stores ids only, no text.
   - `sessionSignal` (L84-108): abandoned checkout (no created_order_id, ACTIVE|ABANDONED, non-empty cart) -> CHECKOUT_STARTED STRONG, <=5 product refs.
   - `assess` (L117-125): HIGH=any STRONG; MEDIUM= >=2 distinct codes incl one MEDIUM; else not qualified ("a single price question is not an opportunity").
   - `collectSignals` (L132-160): cursors; declined=lastSuppressMs>=lastPositiveMs (L157). `mergeSignals` (L163-170) dedupe key, MAX_STORED_SIGNALS=10 (L34). Quiet period in service.

2. `opportunity.service.js`
   - Lifecycle OPEN -> ACTIONED (markContacted L415-421) -> CONVERTED|DISMISSED|EXPIRED (L27-28). Dismiss reasons NOT_INTERESTED/ALREADY_HANDLED/NOT_A_REAL_REQUEST/OTHER (L29).
   - CONFIG (L31-39): LOOKBACK 72h, QUIET_MS 30min, OPEN expiry 7d, ACTIONED 14d, caps 200 conv/5000 msg/500 live per run.
   - Concurrency: per-shop pg_try_advisory_xact_lock (L51-58), lockSkipped (L71-74); all transitions conditional UPDATEs (transitionForMerchant L398-413 -> 409 OPPORTUNITY_STATE_CONFLICT).
   - Dedup: one live row per (shop, customer) partial unique index; merge into live row (L212-232); unique-violation -> skip (L269-271).
   - evaluateCustomer (L191-278): skip OPTED_OUT (L196); skip if last activity < QUIET_MS (L199-205); cursor = max(lookback, lastOrderAt, last_signal_at of ANY prior opportunity incl terminal) (L150-159, 208); skip declined/no-signal (L210); resolved-during-run guard (L239-248).
   - Conversion: convertLiveOpportunities (L284-311) matches orders after first_signal_at via customer_id or normalized phone (customer-orders.js); markConverted sets converted_order_id + reason ORDER_CREATED (L313-329). Real-time hook convertForOrder (L336-366) post-commit from order/order.service.js:420; flag-gated; never throws.
   - expireStale (L368-394): OPEN->EXPIRED/NO_ACTIVITY; ACTIONED->EXPIRED/NO_ORDER_AFTER_FOLLOW_UP.
   - recommendedAction (L474-483): REPLY_IN_INBOX / DO_NOT_CONTACT / WAIT_FOR_CUSTOMER_MESSAGE / CONTACT_BY_PHONE (advisory, no sends). listOpportunities (L485-503); summary pilot metrics (L512-547).

3. `customer-360.service.js` — read-only per-read aggregation, shop-scoped (ADR-0005). listCustomers (L89-154, view=opportunities join-filter L100-106, open_opportunity badge); getCustomerDetail (L232-337: identity, contactability, state+rules_version, commerce summary, RTO shield L156-178, last 50 orders + OrderConfidence, conversations, all opportunities serialized, merged timeline L186-229 newest-60).

4. `contactability.js` — advisory 24h window read (L13); opt-out first (L27-29), then last_inbound vs window (L30-41). Never authorizes a send; policy/policy.engine.js gates outbound.

5. `src/jobs/opportunity-detector.job.js` — sweep (ADR-0006); BullMQ cron */10 min via queue-manager.js:204-208; CLI job-runner.js:26; shops selected via ShopPilotFeatures.customer_intelligence (L30-34), cap OPPORTUNITY_DETECTOR_MAX_SHOPS=200 (L22-24); dry-run counts (L36); per-shop isolation (L46-51); advisory lock prevents races.

6. CustomerOpportunity — entity customer-opportunity.entity.js (L13-92) + migration 20260927_001_pilot_customer_rto_intelligence.js. Fields: shop/customer/conversation/order_session ids, status, strength, JSONB reasons/signals/product_refs, first/last_signal_at, detected_at, detector_version, actioned_at/by, converted_order_id, resolved_at/by/reason. CHECKs status/strength; UNIQUE partial (shop_id,customer_id) WHERE status IN (OPEN,ACTIONED) (migration L63-67); indexes L68-75. Signals never store text (entity L11).

7. Pilot flags — table shop_pilot_features (migration L19-29; entity pilot-features/shop-pilot-features.entity.js): customer_intelligence bool, order_confidence_mode off|shadow|enforce, sanitized JSONB config, updated_by (ADR-0009, NOT in shops.settings). Service pilot-features.service.js: fail-closed defaults (L59-78); requireCustomerIntelligence middleware 409 FEATURE_DISABLED (customer-intelligence.controller.js:13-23, routes.js:18); setPilotFeatures SUPER_ADMIN-only + audited (admin.routes.js:24,36-37; admin.controller.js:173-201); disableAll kill switch (service L140-146).

8. API+frontend — routes /api/customer-intelligence (routes.js:59): status/customers/opportunities GETs; POST :id/contacted, :id/dismiss; Joi validators; tenant from JWT only; audits OPPORTUNITY_CONTACTED|DISMISSED. Frontend: api/domains/customer-intelligence.ts; types api/types/customer-intelligence.ts; Customers.tsx L776-800 (pilot vs legacy); customers/Customer360Page.tsx; OpportunityCard.tsx (reasons chips L89-95, recommended action L104-110, deep-link /inbox?conversation=<id> L117); customerDisplay.ts. No sends (ADR-0008).

9. Tests+ADRs — __tests__/opportunity-signals.test.js (real stage2 incl Bangla/Banglish, negation, suppressors, assess, cursor/declined/renew, session signals, merge idempotence + no-text/phone assert, contactability). customer-intelligence.integration.test.js (idempotency, live-merge, opt-out never task, DB unique, conversion once/phone-match/post-commit, dismissed-not-return L184, 409 conflicts, expiry, cross-shop 404, flag gating, admin-only, kill switch). order-outcome.test.js; migration test asserts unique index regex; pilot-features.service.test.js; security/pilot-intelligence-boundary.security.test.js (no send-path imports, tenant-from-token, router auth, flags not in settings, no raw text). Frontend Customer360.test.tsx, Customers.test.tsx. ADRs 0005/0006/0008/0009; docs/pilot-intelligence/00-08*.

## B. Knowledge

10. Routes knowledge.routes.js (/api/knowledge, routes.js:54): GET / bundle, PUT /branding, POST /faq/search, GET /shop-settings/:shopId/policies, POST /query (RAG), FAQ CRUD L22-25, GET /gaps L27, documents. authenticate; per-shop verifyShopAccess in service (L22-30).
    Service knowledge.service.js: getKnowledge cached 5min (L16-17,165-194); FAQ CRUD L251-312 each write re-syncs RAG + invalidates cache; **no approval-status field** — only is_active (faq-response.entity.js:39-42); inactive FAQ never in AI prompts (getKnowledgeForAI L557-587; searchFaq L457). Documents status processing|indexed|failed (L385,412,424), 100KB cap.
    Retrieval: syncFaqRagIndex (L61-86, doc id faq-<id>, delete on deactivate), syncBusinessInfoRagIndex (L88-121) via rag/rag.service.js (Qdrant); SQL relevance getRelevantFaqs (L589-635); incrementFaqHit from intent-router.service.js:22,638; bulk auto-index.job.js (L96-120) + index-source.contract.js; manual reindex-qdrant.js; knowledge-snapshot.js hashing for prompt-cache.
    Gap capture: entity analytics/knowledge-gap.entity.js (question TEXT, platform, language, source; migration 20260522_010). Writer knowledge/knowledge-gap-capture.service.js recordKnowledgeGap (L30-51, trim/collapse/1000 cap, requires shop+question). Triggers: message-worker.js:2649-2660 low_confidence_handoff; L2685-2698 ai_unknown_response; ai-chatbot.controller.js:278-286 legacy; REST POST /api/analytics/knowledge-gap (cross-shop body 403, gap+audit transactional, analytics.controller.js:69-118; rate-limited analytics.routes.js:44).
    Merchant UI: FaqSettings.tsx (active toggle, /manage-shop/faqs); gap visibility = Reports.tsx Knowledge Performance L250-299 (list + CSV via apiClient.getKnowledgeGaps, dashboard.ts:57-59); aggregated GET /knowledge/gaps -> listGaps (service L316-351, normalized question frequency top-200); top-unanswered SQL analytics-enhanced.service.js:17.

11. Transcript/PII — gap stores ONE question verbatim (no redaction), whitespace-normalized, 1000 cap, no customer id; BUT burst-flush turns store combinedText of several messages (message-worker L1933,1946) = mini-transcript possibly PII. Opportunities hard-sanitized (ids only). docs/pilot-intelligence/06-security-and-privacy.md.

12. Knowledge tests — modules/knowledge/__tests__/knowledge.test.js (43 cases: caches, fail-closed generation, branding schema lock, FAQ CRUD+i18n, RAG auth, confused-deputy, admin-only dict, business-info merge, seed route removed); knowledge-gap-capture.service.test.js; auto-index.job.test.js + index-source.contract.test.js; analytics/__tests__/analytics-knowledge-gap.security.test.js (401/403, transactional); frontend knowledge.test.ts, dashboard.test.ts, Reports.test.tsx.

## Flags answers (as asked)
- Competing lead score: NONE (grep empty). Numeric scores unrelated (RTO risk, OrderConfidence, AI reply confidence). ADR-0006 rejects numeric lead score. customer-waiting-notifier.js alerts HITL-unanswered threads — different trigger, no scoring.
- Second detector racing: NO — only opportunity.service writes CustomerOpportunity; detector job + convertForOrder hook only; advisory lock + partial unique + conditional updates.
- Recreation of dismissed/declined/opted-out: dismissed can't resurrect from old signals (cursor includes terminal row's last_signal_at L150-159,208 + resolved-during-run guard L237-248); genuinely NEW intent after dismissal creates new OPEN (intended, test L184). Declined suppresses until renewed intent (signals L157). Opted-out hard skip (service L196); DO_NOT_CONTACT (L480).
