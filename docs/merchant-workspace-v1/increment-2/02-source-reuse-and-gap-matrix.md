# 02 — Source Reuse & Capability Gap Matrix

Every row verified at source in `feat/merchant-workspace-v1-increment2` (explore session
`ses_e8b83f6a9ffem2sDI8Lc1fZwVk`); classifications per mission §4. **No new business
authority is created where a row says REUSE/CONNECT.**

| CAPABILITY | SOURCE_OWNER | CURRENT_ROUTE | CURRENT_FRONTEND | CURRENT_BUSINESS_AUTHORITY | FEATURE_FLAG | IMPLEMENTATION_STATUS | EVIDENCE | REQUIRED_CHANGE | CLASS |
|---|---|---|---|---|---|---|---|---|---|
| Customer identity | customer module | `GET /api/customer-intelligence/customers/:id` (full 360) + conversation row `customer` include | CustomerDetailPage.tsx; thread header | Customer entity (+ JWT shop scope) | customer_intelligence | exists, inbox never uses it | routes.js:21; ctrl:49-56 gated; mapConversation:549 | inbox context panel consumes it; basic fields when flag off | **REUSE** |
| Order history / repeat buyer | customer-intelligence | `customer-orders.js` (customer_id link or labeled PHONE_MATCH) inside 360 | CustomerDetailPage orders section | Order (+ create-time shop guard `57c5ada3`) | customer_intelligence | exists | service:45-88, caps 50/500 | compact recent-orders read (params or client slice) | **EXTEND(read params only)** |
| Opportunity in conversation | customer-intelligence | projected `open_opportunity` on conversation + contacted/dismiss CAS | OpportunityCard ALREADY in InboxThreadDetail (`inbox-lead-insight`) | CustomerOpportunity | customer_intelligence | DONE (Pilot+ P+01) | pilot docs 03/07 | none | **REUSE** |
| RTO signal | rto-shield | `rto_signal` inside 360 detail (neutral, tier+facts) | CustomerDetailPage:183-201 | RtoShield + network settings | order_confidence_mode adjacent | exists | customer-360.service:156-178 | surface in panel with neutral copy, never "fraud" | **CONNECT** |
| Contactability / reply window | customer-intelligence | `contactability{platform,window_open,reason}` in 360; thread already shows 24h banner | InboxThreadDetail:640-651 | messaging_consent + Meta clock | — | exists | contactability.js:21-42 | don't duplicate; panel links to it | **REUSE** |
| Conversation ownership core | conversation module | PATCH `/api/conversation/:id` (claim-on-takeover, privileged force, 409 CAS, close fence) | UnifiedInbox takeover/resolve flows | Conversation.assignee_id/status/hitl + FOR UPDATE | inherited | exists, P+03 tested | service:1373-1603 | see DEFECTS below | **EXTEND** |
| **DEFECT D1** force unreachable | conversation | validator omits `force` → HTTP force 400s | n/a | — | — | broken privileged path | validator.js:84-95 + validate.middleware (body allowUnknown:false) | add `force: Joi.boolean()` | **EXTEND fix** |
| **DEFECT D2** assignee membership unenforced | conversation | any UUID accepted | n/a | assignee_id raw | — | trust hole | service:1487 stores raw | server check assignee ∈ active UserShop(shopId) | **EXTEND fix** |
| **DEFECT D3** ownership invisible | conversation | `mapConversation` omits assignee_id/resolution_note/resolved_at; hitl_changed SSE has no owner | FE type fields dead (types/conversation.ts:188-191); no name display | DB has them | — | merchant can't see who owns work | service:549-599 | emit assignee {id,name} on list/detail + `owner_changed` SSE field | **EXTEND fix** |
| **DEFECT D4** audit trail holes | audit | NO `POST /api/audit` route — FE takeover/resolve audit calls silently 404; conversation PATCH has no server audit | — | audit_logs exists | — | ownership changes unaudited | audit.routes.js:11-18; UnifiedInbox:920,973 | server-side `logOperation` on ownership changes; delete dead FE audit calls | **EXTEND fix** |
| Queue buckets | modules/inbox | `GET /api/inbox/actions` (6 risk buckets, fail-closed partial, cap 50) | ActionQueuePanel strip | read model over authorities | action_queue | DONE (Pilot+ P+03) | inbox-actions.service.js:29-251 | + per-bucket counts, + view facets (Phase 6) | **EXTEND** |
| Notes | (none) | — | — | — | — | MISSING | GAPS #1: `customer_preferences.notes` is a dead single TEXT, no write route | MINIMAL_NEW: `customer_notes` table + CRUD + audit + staff-private contract | **MINIMAL_NEW** |
| Tags | (none) | — | — | — | — | MISSING | GAPS #2: tags JSONB exists only on products/templates | MINIMAL_NEW: shop-scoped tag vocab + assignment, bounded naming | **MINIMAL_NEW** |
| Work views | inbox | tabs all/needs_review/closed client-side over loaded 50 | InboxThreadList:92-130 | conversation status/hitl | — | partial | UnifiedInbox:231,1127-1140 | server-backed counts + named built-in views (mission §10.2) — extend `/inbox/actions` counts, NOT a new engine | **EXTEND** |
| AI diagnostics | shop module | `GET /api/shop/ai-diagnostics` exists, FE never calls it | — | queue/denial facts | — | hidden | audit doc 09 gap list | unobtrusive explanation for failed AI reply in existing state banners (Phase 7) | **CONNECT** |
| Staff list for assignment | shop | `GET /api/shop/agents` (JWT-scoped id/name/role) | NO consumer today | UserShop roles | — | ready | shop.controller:578-602 | assignment dropdown | **REUSE** |
| Dead blacklist surface | customers | `/api/customer/:id/blacklist` does NOT exist | Customers.tsx:203-221,400,510,628-645 + api/domains/customer.ts:120-137 | — | — | permanently-false UI | GAPS #15 | remove dead helpers+UI (FE-03 precedent); opt-out truth already lives in messaging_consent | **REJECT** |
| SupportTicket | support module | entity+table only, ZERO routes | — | — | — | inert | GAPS #12 | DEFER post-purchase issue cases (not this increment's jobs; §16 out of scope: no refund/return automation) | **DEFER** |
| Storefront compatibility | conversation/Customer | channel-scoped identity already enforced | — | Customer.channel_type+meta_channel unique | — | contract holds | unique idx (shop,channel,channel_user_id)+meta partial | keep new reads/writes channel-aware; document adapter needs | **REUSE + doc** |

## Rejected-as-unnecessary (record)
- New CRM database/service, deal pipeline, saved-custom-view builder, generic workflow
  engine, auto-tagging from messages, scheduled outreach (mission §16; CRM patterns
  benchmarked but refused on evidence).
- Second task store for ownership (Pilot+ ADR: queue stays a read model).
