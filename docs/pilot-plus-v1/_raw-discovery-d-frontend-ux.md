# RAW DISCOVERY NOTE — Merchant frontend/UX (explore agent D, 2026-10-24)

FE root: `EasyMod-frontend`.

## 1. Unified Inbox
- `src/app/components/UnifiedInbox.tsx` (1204 ln) container/orchestration: getDeliveryState L34-46 (synthesizes HELD when SENT/DELIVERED lacks provider id), isProviderConfirmed L48-55, deliveryStateRank L57-65, mergeMessageLifecycle L112-137; getAiReplyStatus L145-192; needsMerchantReply L194-197 (needs_merchant_reply ?? hitl||hasAiSuggestion); tabs all|needs_review|closed L229; SSE wiring L507-876 (onNewMessage 508-608, onHitlChanged 610-638, onAiPaused 640-662, onMessageDeliveryUpdated 664-780 drives needs_merchant_reply_reason HITL_REQUIRED/PROVIDER_SEND_FAILED L736-778, onDeliveryFailed 782-809, onAiReplyModeChanged 811-820, read projection 839-861); dismiss suggestion handler L1032-1072; HITL toggle L880-919 audit HUMAN_TAKEOVER; resolve dialog L921-960; deep link ?conversation= L421-443; ?tab=needs_review L416-419; 24h flags L1091-1101; offline SSE banner L1131-1137; header pills L1115-25.
- `inbox/InboxThreadList.tsx`: search L81-90, tabs+count chips L91-129, HITL left border L163 + UserCheck L182-186, "Needs reply" destructive badge L212-216, unread badge L217-221, channel icons L27-35, rel time L39-51.
- `inbox/InboxThreadDetail.tsx` (825 ln): isReviewableSuggestion L82-111 (visibility VISIBLE_DRAFT_REVIEW|VISIBLE_HITL_REVIEW|VISIBLE_MERCHANT_REQUESTED, DRAFT_READY, or HELD w/ held_reason list L92-100); MessageItem L141-347 (colors L170-178, pending/sent text L323-324, failed+Retry L326-343 incl "Provider result pending reconciliation" L161-163,328-330); transcript filter L463-466 (only provider-confirmed AI in transcript; held drafts = panel only); AI Suggestion Panel L689-763 ("DRAFT — NOT SENT" L711-713, confidence dot L468-474, "Use this"/"Send edited" L737-744 -> approveAiDraft w/ optional content, edit textarea L714-721, low-conf warning L725-729, provider-blocked L731-734, Ignore dismiss L755-760); HITL amber banner L629-634; 24h banners L635-646; AI-active pill L579-589; Take over/Resume AI L590-602; live bar L618-626; upgrade lock L604-613; resolve dialog L779-822.
- `inbox/InboxComposer.tsx` (523 ln): agent send idempotency L159-167; attachments ≤25MB L32-45,109-123; QUICK-REPLY POPOVER + template manager CRUD L316-520 (merchant canned replies — NOT customer interactive choices); 24h disabled input L385-396.
- API `src/api/domains/conversation.ts`: approveAiDraft L152-162 POST /api/conversation/:id/messages/:mid/approve {content?}; dismissAiDraft L164-170; markConversationRead L172-181; getMessages returns {messages, suggestions} L121-130; updateConversation (hitl/status/resolution_note) L183-198.
- Tests: `src/test/UnifiedInbox.test.tsx` mocks useInboxSSE via InboxSSECallbacks L77-92.

## 2. Inline-draft docs
- NO "inline draft"/"draft approve"/"inbox redesign" doc exists in docs/. De-facto contract = ADR-0004 (one Message row per candidate; approve same row DRAFT_READY->SEND_PENDING->SENT only after provider ack; dismiss persists DISMISSED; separate Draft entity REJECTED; frontend-only filtering REJECTED) + ADR-0003 (AUTO|DRAFT|MANUAL canonical from shops.settings.ai, fail-closed) + ADR-0008 L44-45 (queued follow-up drafts deferred — would create second candidate lifecycle) + docs/pilot-intelligence/01-plan.md L120/L320 (?conversation deep link + confidence panel).
- No competing inline-draft work from other agents in this tree — no merge dependency.

## 3. Customers
- `Customers.tsx` L777-800: getPilotStatus -> Customer360Page vs LegacyCustomers (table L64+, channel badges L30-36, rto_risk/blacklisted types L16-18).
- `customers/Customer360Page.tsx`: StateBadge L57-68; columns incl opportunity w/ open_opportunity chip L147-149,204-210; tabs all|opportunities URL-driven L294-346; OpportunityList LIVE L227-231, removes non-live L275-283.
- `customers/OpportunityCard.tsx`: contacted L38-39; deep link /inbox?conversation= L114-123; dismiss reason select L13,148-171; strength badge+ACTIONED chip L72-85; recommended action L104-110; contract "nothing here sends a message" L21-25.
- `customers/CustomerDetailPage.tsx`: reply-window L94-100, commerce summary L169-181, RTO signal L183-201, embedded OpportunityCards L203-213, orders L215-251, timeline L253-270.
- Types `src/api/types/customer-intelligence.ts` (CustomerState L7, OpportunityStatus L8, Contactability L49-54, RecommendedAction L66-70, TimelineEvent L126-140, OrderConfidenceDecision L186-211); domain `api/domains/customer-intelligence.ts` L22-71.
- `customers/customerDisplay.ts` L8-27 semantic tone ("colours signal needs attention, never blame"); BDT money bn-BD L29-56.

## 4. Orders
- `Orders.tsx` (1271 ln): taxonomy draft|pending|confirmed|processing|completed|delivered|cancelled (types/order.ts L48); statusColors L18-26; summary cards L460-493; filter mapping L178-184; high-RTO confirm guard L236-257; OrderConfidencePanel mount L1178; status update L1180-1185.
- `orders/OrderRow.tsx` token pills L15-22, high-RTO badge L68-72, dispatch/track L75-108.
- `orders/OrderConfidencePanel.tsx`: READY|VERIFY|MANUAL_REVIEW L17-21; hidden when mode off L75; shadow badge L122; bookable===false block L127-129; enforce held msg L130-132; stale warning L133; VERIFY method select vs owner APPROVE >=5-char note L164-203; conflict re-read L96.

## 5. FAQ/knowledge surfaces
- `FaqSettings.tsx` (342 ln, /manage-shop/faqs, redirect /knowledge routes.ts L198): CRUD + activate toggle L56-67, delete L69-82, inline editor L84-117,191-310. NO gap/suggestion approve-dismiss UI.
- Gaps read-only: api/domains/knowledge.ts listKnowledgeGaps L158-161 (GET /api/knowledge/gaps); dashboard.ts getKnowledgeGaps L57-58; Reports.tsx L72,81-88 table L278, CSV L121.
- ORPHAN type hinting intended review flow, unused: `src/app/lib/knowledgeTypes.ts` KnowledgeExtraction L51-64 status processing|review|approved|rejected.
- ChatSettings.tsx = AI reply mode control (/manage-shop/chat-settings).

## 6. Action-first patterns
- `Dashboard.tsx`: PulseData.needsAttention L24 from GET /api/dashboard/queue L120-165 = unread+pending_payment L161, missedReplies L159, atRisk L162; cards L200-223.
- `InAppNotificationCenter.tsx` (149 ln): bell/dot L74-84; requiresOwnerAction (payment confirm approve/reject, not mark-read) L17-28; deep-link Review L130-137; optimistic mark-read L61-70; types notification.ts OwnerNotification L30-45 (pending|completed|expired, customer_data.deepLink).
- Inbox reasons enum in code: HITL_REQUIRED, CUSTOMER_UNANSWERED, PROVIDER_SEND_FAILED, AI_PAUSED.
- `ConversationAlertBanner.tsx` quota tiers L49-67.
- NO generic task/queue component exists.
- **`docs/mobile/adr/M-008-attention-and-today.md`**: single deterministic ranked /api/mobile/attention merging draft orders, inbox needs-reply (hitl/needs_merchant_reply), courier failures/setup, low stock, RTO-verify (L9-28); ranking per docs/mobile/MOBILE_PRODUCT_SPEC.md L21,45; AI-ranked feed REJECTED L68-71. NOTE M-008 calls /dashboard/queue unreliable ("counts statuses nothing writes"). -> P+03 read model must align with/extend THIS contract, not /dashboard/queue.

## 7. Design system
- `src/styles/theme.css` :root tokens L3-45: --brand #00A651, --brand-hover #008040 L14-15; shadcn semantic set destructive #d4183d; .dark L47-82; Tailwind v4 @theme inline L84-125; typography L127-186. tailwind.css L1-8 source scoping + --font-bn 'Hind Siliguri' -> font-bn utility.
- Bangla: index.html Google fonts L52-54; font-bn ad-hoc (UnifiedInbox L1109,1133; composer L303; OrderRow L44); i18n default `bn` (src/i18n/index.ts L10-23 key easymod_lang); locales en.json inbox ns L610-700 (tabNeedsReview L610, status.draftReady L626, draftNotSent L636, needsReplyBadge L697).
- shadcn/Radix ui/* cva+cn; badge variants L7-26; motion presets src/lib/motion/presets.ts; sonner toasts; lucide icons.
- Breakpoints: Tailwind defaults only; inbox master-detail swap at md(768) via mobilePanelOpen (ThreadList L76-78, ThreadDetail L537) + innerWidth guard L468 UnifiedInbox; touch min-h-10/44px (composer L369,407; suggestion buttons L740-757); viewport-fit=cover + PWA manifest (index.html L6,23).

## 8. SSE client
- LIVE: `src/app/lib/useInboxSSE.ts` (151 ln) only UnifiedInbox L507; native EventSource /api/conversation/events withCredentials L47-48; wired events L50-123 (new_message, hitl_changed, ai_paused, ai_reply_mode_changed, delivery_failed, message_delivery_updated, conversation_read, customer_updated, channel_error); backoff 1s->30s L130-140; tenant server-side. Test `app/lib/__tests__/useInboxSSE.test.ts`.
- Unused class `src/api/sse-client.ts` typed SSEClient w/ Last-Event-ID sessionStorage cursor L276-295; test only.

## 9. Playwright
- `playwright.config.ts`: testDir tests/e2e, webServer npm run dev --host localhost --port 4273 (reuses server), baseURL env; API FULLY MOCKED via page.route per spec (shared-inbox.spec.ts setupRoutes L48-70, loginAndGo L72-79); lang en storageState L18-24; trace/screenshot/video on failure L25-27.
- `playwright.lab.config.ts`: testDir tests/product-engine-lab, chromium+firefox+webkit L9-17, 1440x1000, Asia/Dhaka TZ, artifacts ../docs/ai/product-experience-v1-2/artifacts.
- Specs: shared-inbox; ai-reply-mode (Scenarios A-I: save L461, draft-visible-only-when-held L550, SSE mode change L566, terminal activity clearing L590-660, merchant-requested "explicitly unsent" L662, quoted reply L691, two-Page isolation L723); customer-intelligence (journeys 1-10 incl VERIFY-cannot-book L291, owner approve L330, mobile layout L344-347); meta-platform (24h lock L203); + oauth/order/notification/courier/payment/llm/pricing/signup/integration/core specs; chatbot-journey.test.js PRO fixtures.
- Scripts: npm run test:e2e (FE), test:all; unit stack vitest+happy-dom (vitest.config.js L8-15 excludes tests/e2e). No storybook/visual-regression; @axe-core/playwright L78 a11y dep available.
- `docs/testing/WHOLE_APP_TEST_ARCHITECTURE.md` tiers T0-T4 L23-27; FE required unit-only; real-DB Meta E2E backend-side.

## 10. API types conventions
- `src/api/types/*` barrel L5-17; domains -> httpClient `src/shared/lib/http/client.ts` unwraps {success,data} (types/common.ts ApiResponse/PaginatedResponse); facade `src/api/index.ts` L22-30 legacy apiClient; aliases @,@shared,@features.
- Conventions: server snake_case kept verbatim (delivery_state, needs_merchant_reply); UI camelCase projections on same interfaces (types/conversation.ts L150-184); union+Record style maps at boundary; fail-closed normalizeAiReplyMode L56-59; SuggestionVisibility/HeldReason enums L23-29,80-92 mirror ADR-0004. New shared types go in src/api/types/.
