# 04 — Customer-Context Contract (Inbox panel, Phase 3)

## Data composition (every read is authoritative, channel-aware, JWT-scoped)

| Panel section | Source when CI flag ON | Source when CI flag OFF | Association rule | Truth rules |
|---|---|---|---|---|
| Identity | `conversation.customer` (already on the thread) + reply-window banner | same | conversation row (server-joined) | name may be channel fallback; Page chip from `metaChannel` |
| Relationship (state badge, delivered counts/value, RTO) | `GET /api/customer-intelligence/customers/:id` (360 detail) | **not rendered** (no alternate unguarded path — §7.3) | `conversation.customer_id` | value labeled "delivered value", never cash-received; RTO neutral-fact copy only |
| Operations (recent orders) | `GET /api/order?customer_id=&limit=3` (`2dc0563a`) | same (order_management is a subscription feature, not CI-gated) | `conversation.customer_id` | status strings verbatim from order authority; deep link `/orders?orderId=` |
| Ownership | PATCH response + list `assignee` fields (`21ebf39f`) | same | conversation | 409 texts shown as-is; optimistic state rolls back on conflict |
| Opportunity | existing `inbox-lead-insight` strip (P+01) | same | conversation projection | panel links, never duplicates actions |
| Notes / Tags | new endpoints (doc 05) | same (notes/tags are basic-authorized staff CRM, not insights) | `conversation.customer_id` | private; never in prompts/outbound; §9.3 |

## Rules pinned by tests (feeds Phase 8 journeys J1/J2/J9 + units)

1. **No name-based association anywhere.** Same display-name customers on different
   Pages/rows have distinct `customer_id`s (unique `(shop,channel,channel_user_id)`);
   the panel only ever queries by id. PHONE_MATCH orders, when present in 360 data,
   carry the service's existing label — shown labeled or not shown (panel uses
   `customer_orders.link === 'PHONE_MATCH'` → "phone-matched" tag).
2. **Cross-shop/cross-tenant:** every endpoint scopes `shop_id` from JWT (verified
   `whereClause { shop_id, customer_id }` in conversations `:605`, orders `:622-630`;
   360 rejects foreign customers → honest unavailable).
3. **Flag semantics:** `customer_intelligence=false` → panel renders WITHOUT
   Relationship/RTO/Opportunity; zero requests sent to `/api/customer-intelligence/*`
   (test asserts the fetch itself doesn't happen — mirrors FE-08's zero-lookup pattern).
4. **Failure degradation:** any panel request failing → that section shows an accurate
   "unavailable" line; conversation workflow (timeline/composer/SSE) unaffected;
   stale-per-conversation responses are dropped (per-conversation AbortController +
   requestId guard, FE-08 pattern reused).
5. **No fabricated cache:** switching conversations resets panel state before load
   (never last-known data of another customer).
6. **Storefront compatibility:** all reads keyed by shop-scoped internal ids;
   `channel`/`page` shown as attributes of the CONVERSATION context, not of the
   customer's identity; no Meta PSID surfaced to UI.

## Component contract (doc 03 selected layout B)

`inbox/CustomerContextPanel.tsx` — props `{ conversation, onClose }` (mobile sheet on
<xl, persistent column on xl+), sections collapsed per doc 03. Registered in the
split row of `UnifiedInbox.tsx` + thread-header toggle button + `mobilePanel` third
state. Every string through i18n (en+bn) — translation-coverage guard will enforce.
Panel is READ-ONLY except: ownership actions (canonical PATCH), notes/tags composer
(doc 05 endpoints), view jumps. No new backend call leaves the shop+conversation
authority chain.
