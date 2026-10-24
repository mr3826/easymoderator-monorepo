# RAW DISCOVERY NOTE — Conversation/Channel transport (explore agent A, 2026-10-24)

Paths relative to `EasyMod-backend/src/`.

## 1. message-worker.js (jobs/message-worker.js, 3529 lines)
Guard chain order (processMessageJob @1898): canary @1904-07; burst-flush @1939-53 (dedup anchor burst:<lastMessageId>); channel resolve @1959-65 (@342);
G1 idempotency @1967-2005 Redis NX `msg:dedup:{shopId}:{scope}:{externalId}` 24h (claimDedupKey @497-507; releaseStaleProviderClaim @516-544 10min);
G2 HITL @2059-79 (conversation.hitl skip; closed/archived skip; invalid Resume boundary retryable);
G3 ai:pause @2081-83 (Redis `ai:pause:{conversationId}`, 30-min mute on merchant send);
G4 automation mode @2085-2116 (getEffectiveAiReplyMode; MANUAL→notify+skip; candidate reuse @2119-69 DRAFT never upgrades to AUTO);
G4b channel CONNECTED @2171-76; G4c billing pause @2178-2203 (signalBillingPause @1761, SSE ai_paused); G4d allowance @2205-23 (signalUsageExhausted @1822);
G5 sentiment escalation @2225-59 fail-safe;
policy outbound gate @2876-2955 (deny→held/draft candidate; RATE_LIMIT moveToDelayed + DelayedError @2921-27);
final reversible-boundary re-read getAutomaticSendGuard @193-263 (mode, HITL, closed, ai:pause, opt-out re-read @232-53, latest-business-after-latest-customer @255-60) → claimAutomaticCandidate @546 / claimProviderSendBoundary @662 → provider send @3213-34 → finalizeAiMessage @1397.
Queue `message-processing`; worker @3444-49 concurrency 10, BullMQ v5 group {concurrency:1} per shopId; enqueued group.id=shopId (burst-coalescer.js @200-204).
Retry attempts 3 exp 2/4/8s (message-queue.js @37-45); exhaustion → message-dlq + ops alert @3461-91; receipts settle DEAD_LETTERED @3396-442; 429 retryAfterMs re-delay releases candidate @3249-60; UnrecoverableError only META_AUTHORIZATION_REQUIRED @3262-90.
Delivery lock per conversation (conversationLockService.acquireForDelivery 300s/10s @72-73,3073-86); recovery timers 5s/8s (createRecoveryControl @1265-72, suppressed pre-boundary @2045); drainChannelJobs on disconnect (message-queue.js @67-108).

## 2. Meta webhook ingress
Mount app.js @118 /api/webhooks/meta (public https://api.easymod.tech/webhooks/meta via Caddy).
Routes modules/integration/meta-webhook.routes.js: rate limit 120/min Redis @45-53; GET challenge @122-60 (global token constant-time then per-channel webhook_verify_token); POST @164-236.
Signature: inline HMAC-SHA256 X-Hub-Signature-256 vs META_APP_SECRET on RAW bytes before JSON parse, timingSafeEqual @57-65,169-76.
Malformed envelope codes @67-118; malformed → metric + ack 200 @182-98.
Durable receipts: handlePageWebhook writes receipt per event BEFORE business work @1491-1500; meta_webhook_receipts entity (unique page_id+dedupe_key @133-37; PSID as SHA-256 sender_ref; body AES-256-GCM payload_encrypted; statuses RECEIVED/PROCESSING/QUEUED/PROCESSED/SKIPPED/IDENTITY_NOT_RESOLVED/MESSAGE_STORE_FAILED/RETRY_PENDING/DEAD_LETTERED @77-88). Service retry ladders @30-36; stale claim 15min @39; retention 7d terminal /30d DLQ @44-45; WebhookReceiptPersistenceError → 503 so Meta redelivers (routes @216-21).
Replay dedup layers: receipt dedupe_key (recordReceipt service @95-186 duplicate:true); claimProcessing fence (events handler @1336-55); Message external_id (mid) dup in storeIncomingMessage @881-944; worker Redis dedup.
Reconciler jobs/webhook-receipt-reconciler.job.js cron */2 min (queue-manager @189-93) replays via same processMessagingEvent.
GDPR/deauth meta-webhook-gdpr.handler.js @routes 240.

## 3. Conversation/Message entities (modules/conversation/conversation.entity.js)
Conversation @4-113: status active|closed|archived (validator @8,57,90,102); role user|assistant|system @45-48; hitl bool @73-77; assignee_id/resolution_note/resolved_at @78-90; metadata JSONB ai_resume_boundary_at/unreadCount/last_read_message_at/within_allowance/last_message_at/source.
NO needs_merchant_reply column — derived projection deriveWorkflowProjection (conversation.service.js @275-356): reasons HITL_REQUIRED, DRAFT_REVIEW_REQUIRED, CUSTOMER_UNANSWERED, AI_FAILED, PROVIDER_SEND_FAILED; ai_is_replying @351-55. "needs-merchant-reply" only as SSE payload fields (controller @1241-43,1295-97).
Message @115-218: sender customer|ai|business; ai_suggestion/ai_confidence @143-49; first-class delivery_state/provider_message_id/delivery_source/send_idempotency_key @153-68 (migration 20260904_001); source_references JSONB @169-75; message_tag @176-80; partial unique (conversation_id, send_idempotency_key) @212-16; external_id unique index now Page-scoped.
Delivery-state enum message-lifecycle.js @5-14: GENERATING, DRAFT_READY, SEND_PENDING, SENT, DELIVERED, FAILED, HELD, DISMISSED. Suggestion visibility @16-23: HIDDEN_AUTO_PROCESSING/VISIBLE_DRAFT_REVIEW/VISIBLE_HITL_REVIEW/VISIBLE_MERCHANT_REQUESTED/HIDDEN_SENT/HIDDEN_DISMISSED. Reviewable logic @162-88 (HELD reasons low_confidence/human_active/ai_paused/channel_disconnected/mode_changed/policy_blocked).
AI metadata fields (storeAiResponse conversation-state-standalone.service.js @224-333 + worker @2503-551): type ai_response, delivered, delivery_status, delivery_state, delivery_source AUTO|AI_DRAFT|HITL_ESCALATION|DRAFT_APPROVAL, suggestion_visibility, held_reason, provider_message_id(s), provider_send_claimed/claimed_at/claim_token/attempted/confirmed, confidence, automation_mode, ai_disclosure_applied, order_flow, sourceReferences, product_presentation, grounding_*, human_required, logical_turn_id, turn_started_at, dismissed_at/dismissed_by_resume.
Inbound metadata: attachments, message_type/image_url/file_url/file_name (handler @1053-67), reply_to @831-44, quick_reply.payload, logical_turn_id, ai_skipped_reason/subscription_status.
conversation-turn.entity.js + migration 20260823_001; turn-recovery.service.js states RECEIVED/CONTEXT_BUILDING/AGENT_RUNNING/RETRY_PENDING/INDETERMINATE/SENT.

## 4. Draft lifecycle
Modes modules/shop/ai-reply-mode.js @3-20 AUTO|DRAFT|MANUAL default MANUAL (legacy mappings @; business-level only, getEffectiveAiReplyMode @39-49; page-level legacy; worker @2085-87). Migrations 20260902_001 (+test), archive 20260320_004 (hitl+message_tag).
AI reply persisted before send (worker storeAiResponse @2503-551); DRAFT → DRAFT_READY+VISIBLE_DRAFT_REVIEW; held → HELD+VISIBLE_HITL_REVIEW held_reason (finalizeAiMessage @1570-98).
Approve: routes @72-77 → controller approveAiDraft @1037-1122 → service @994-1106 (transactional claim, edit ≤4000 chars, SEND_PENDING, source DRAFT_APPROVAL, NEW send_idempotency_key, InboxDeliveryOutbox row @1089-98) → deliverViaMetaIfApplicable(...,'agent'), failure→HELD; 409s DRAFT_SEND_IN_PROGRESS/PROVIDER_SEND_ALREADY_ATTEMPTED/DRAFT_DISMISSED/DRAFT_NOT_APPROVABLE.
Dismiss: routes @79-84 → controller @1124-82 → service dismissAiDraft @1130-1212 (DISMISSED+HIDDEN_DISMISSED, sibling terminalization @261-73, per-sibling SSE).
Manual send: POST /:conversationId/messages (routes @99-104 idempotency middleware) → controller createMessage @946-1035: Redis ai:pause TTL 1800 (@46,@1006), holdPendingAiCandidates @1276-1333 (cancelled_by_human), deliverViaMetaIfApplicable @591-813 under delivery lock.
Mobile twin mobile-inbox.controller.js @116-50 + ai-mode pause/resume @178-219 (conversation_updated SSE carries ai_paused).
Outbox recovery: jobs/inbox-delivery-reconciler.job.js cron */2; inbox-delivery-outbox.entity statuses PENDING/PROCESSING/COMPLETED/NEEDS_RECONCILIATION (5-rung backoff @11).
Resume boundary: stamps ai_resume_boundary_at (conversation.service @1416/@1430); worker enforces via claims + finalize (dismiss as resume_obsolete).

## 5. Outbound policy + transport
meta-send.service.js REMOVED — transport in modules/channel-providers/providers/MetaMessengerProvider.js (+MetaPortfolioMessengerProvider.js); routing-boundary cutover (webhook.service.js @11 comment; pilot-intelligence-boundary.security.test.js @44 asserts no re-import).
Policy engine modules/policy/policy.engine.js: evaluateOutbound @67-151 first-deny short-circuit, persists ALL decisions to policy_decisions (sha256 text only); evaluatePreFlight @160-62 defense-in-depth. Rule order policy.rules.js @20-29: consentRequired, messengerOptedOut, twentyFourHourWindow, templateRequired, contentSanitizer, businessHours, rateLimit, draftMode.
Message tags: templateRequired.rule.js @26-36 ALLOWED_TAGS = CONFIRMED_EVENT_UPDATE|POST_PURCHASE_UPDATE|ACCOUNT_UPDATE|HUMAN_AGENT, DEFAULT POST_PURCHASE_UPDATE. twentyFourHourWindow.rule.js @23-27 attaches augment.message_tag outside window; caller may request via message.policy.messageTag. Wire: MetaMessengerProvider.sendMessage @1064-71 → messaging_type MESSAGE_TAG+tag else RESPONSE.
24h: window rule @32-47 vs consentService.getLastInboundAt; agent-role outside window hard block HUMAN_AGENT_OUTSIDE_WINDOW_BLOCKED @46-48 (permission not held, comment @13-18). Mobile enforces OUTSIDE_24H unless explicit tag (mobile-inbox @91-112).
Opted-out: messengerOptedOut.rule.js @29-57 per-channel messaging_consent[platform] opted_out_at→OPTED_OUT, missing opt-in→NO_CONSENT, fail-closed; transactional legacy exception @49-51. Worker re-reads at irreversible boundary (claimProviderSendBoundary @720-30); STOP opt-out recorded at ingest (meta-webhook-events.handler.js processInboundConsent @453-92, cancels pending burst).
Rate limit: rateLimit.rule.js META_SEND_LIMIT=170/h per Page ZSET meta:sends:{pageId}; Lua atomic reserve @35-49; peek @91-113; provider reserveSendSlot/releaseSendSlot per POST @1096,@1129.
QUICK REPLIES/BUTTONS: OUTBOUND ABSENT. sendMessage builds only message.text + attachment image|file @1036-63; no quick_replies/button/generic/postback anywhere in src.
Graph API v22.0 default env META_GRAPH_API_VERSION (MetaMessengerProvider.js @41-42; Portfolio @35; meta-oauth-exchange @21; customer-profile @37; voice-processing @106,114). appsecret_proof @79-89. parseWebhookEnvelope @989-1027 drops echoes, ignores comments/feed.

## 6. SSE
utils/sse-bus.js Redis pub/sub per shop channel `sse:shop:{shopId}` @42,117-33; monotonic seq; replay buffer 50/600s @43-44; in-process fallback @24-27; no-double-emit @28-31.
utils/sse-manager.js register/unregister/emit/attachToRequest (Last-Event-ID replay @247-76); disconnectUser @195-205.
Endpoint GET /api/conversations/events (conversation.routes.js @32-35 → controller getEventStream @1374-1416, rejects client shop override @1375-83, 25s heartbeat; conversation-sse.security.test.js).
Events: new_message, message_delivery_updated, delivery_failed, hitl_changed, conversation_read, conversation_updated, ai_paused (worker @1808,@1863), ai_reply_mode_changed (shop.service @732), channel_error (events handler @1292), customer_updated (@146).

## 7. Quick-reply/postback INBOUND
Quick reply payload CAPTURED not consumed: handler @1079-83 stores metadata.quick_reply.payload (merge @1120); test meta-webhook.routes.test.js @266-78. Reply pipeline reads only text/attachments (normalizedEvent.message = messaging.message?.text @1396; burst folds m.content only @255-78). NO consumer of metadata.quick_reply exists.
Postback NOT handled: subscribed fields only `messages` (@63-65; MetaMessengerProvider.test.js @494 asserts messaging_postbacks NOT subscribed); processMessagingEvent @1396-1402 no postback branch → receipt SKIPPED/NON_MESSAGE_EVENT. "postback" only allowed envelope key @routes 76.

## 8. Tests (key paths)
message-worker.{resume-boundary,reply-mode,recovery.integration,intent-shadow,grounding,greeting,billing-pause,action-gate(+integration)}; burst-coalescer; drain-channel-jobs; pipeline-canary; inbox-delivery-reconciler; meta-webhook.{routes,durability(+integration),metrics,events.handler.phase2}; meta-gdpr-security; meta-channel-resolver; webhook-payload-cipher; health-meta-webhook-metrics; meta-compliance.migration.
conversation: conversation.delivery-state, message-attributes, draft-send.controller, message-lifecycle, human-handoff, manual-send-policy, deliver-via-meta.senderRole, conversation-state.resume-boundary, conversation-state-routing, conversation-sse.security, attachment-durability(+integration), escalation-auto-reply.resume-boundary, order-flow.service, conversation.service, conversation.routes; migrations 20260904_001, conversation-turns, 20260902_001, 20260927_001_meta_webhook_queue_recovery.
policy.{engine,rules,businessHours}; MetaMessengerProvider(+canary), MetaPortfolioMessengerProvider, meta-channel.serializer; sse-bus; mobile-inbox.controller; pilot-intelligence-boundary.security; E2E harness EasyMod-backend/tests/meta-e2e/ (real HMAC/rate-limit/dispatcher).

## FLAGS
1. No retired tags emitted (2020-consolidation four only). HUMAN_AGENT latent inconsistency: in ALLOWED_TAGS + window rule honors caller-requested tag for non-agent senderRoles; app lacks permission so Meta would reject; no code path requests it today. LOW-risk latent.
2. OCR-as-payment: order-session-standalone.service.js AWAITING_MFS_SCREENSHOT @868-904 — verifyPaymentScreenshot (Gemini Vision OCR, payment/self-mfs-handler.service.js @126-365: trx-id, amount±5%, receiver/MFS-type match, fraud heuristic) sets mfs_payment_verified=true and CUSTOMER IS TOLD "Payment confirmed ✅ (TrxID …)" @897-99 — NO gateway/TrxID verification. Mitigation: created order payment_status 'pending' for self-mfs @230-33,@1681. Dead path: ai-chatbot.controller.js handleSelfMfsPayment @756-803 calls non-existent OrderSessionService.handleSelfMfsPayment, no mounted route.
3. Payment options sources: live reply path uses ai/shop-operating-context.service.js — truth = owner's PERSONAL self-MFS number (shop-bd-settings @19-25); header @10-16 documents override of hardcoded persona + seeded "pay via bKash/Nagad" FAQ + shop/shop-defaults.js @49 payment_methods ['COD']. Order session gates on PaymentConfig.is_enabled (order-session-standalone getEnabledPaymentGateways @1546-59, fallback ['cod']). THREE coexisting sources; operating-context override degrades to '' un-grounded prompt on failure @27-28 → stale FAQ could leak payment claims (worker revalidateKnowledgeEvidenceBeforeSend @92-132 covers FAQ drift, not payment gating).
