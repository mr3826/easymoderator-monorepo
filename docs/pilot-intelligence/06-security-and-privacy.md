# Pilot Intelligence — Security and Privacy

Scope: Customer 360 Lite, Sales Opportunities, Order Confidence, pilot flags.
Method: threat model on the assets below, verified by tests named in the table.

## Assets

- Customer PII: name, phone, email, Page-scoped id.
- Commerce history.
- The courier-booking decision, including the ability to release a parcel.
- Opportunity follow-up, which could become a messaging abuse channel.
- Pilot flags, which switch enforcement on and off.

## Threats and controls

| # | Threat | Control | Evidence |
| --- | --- | --- | --- |
| T1 | Cross-shop leakage through a customer, opportunity or order id (IDOR/BOLA) | Every query carries the JWT `shopId`. A lookup miss is 404, identical to not-found. Phone association never leaves the shop. | `customer-intelligence.integration.test.js` "another shop's customer and opportunity ids return 404"; `order-confidence.integration.test.js` "another shop cannot read, verify or approve" |
| T2 | Tenant spoofing through body, query or header | Controllers read only `req.user.shopId`. The boundary test forbids `req.body.shop_id`, `x-shop-id` and similar. | `pilot-intelligence-boundary.security.test.js` |
| T3 | Stale authorization: removed staff keep access | `authenticate` re-checks active membership on every request, and `verifyShopAccess` re-reads the role | Existing auth tests plus route-level `router.use(authenticate, verifyShopAccess)`, which the boundary test pins |
| T4 | Privilege escalation: staff approve a MANUAL_REVIEW order | `requireOwnerOrAdmin` on the route **and** a service check `kind==='APPROVED' && !OWNER_OR_ADMIN.has(role)`. A verification cannot cover MANUAL_REVIEW (resolution levels). | Integration: staff approve gives 403, and staff verify gives 409 `APPROVAL_REQUIRED` |
| T5 | Merchant self-enables or disables enforcement through `PATCH /shop/:id` settings | Flags live in `shop_pilot_features`, written only by SUPER_ADMIN. `shops.settings.pilot_features` is not read anywhere. | Integration: "a shop member cannot enable or change pilot flags through shop settings"; boundary test |
| T6 | Mass assignment on resolution or opportunity endpoints | Joi schemas reject unknown keys, for example `resolution_level` in a verify body gives 400 | Integration: "unauthenticated and malformed requests are refused" |
| T7 | RTO Shield bypass through the direct `book-courier` route | The gate is inside `bookForOrder`, which every booking path uses (manual route, confirm, chatbot, payment webhook). It runs before the claim. | `order-confidence.gate.test.js` (call order), the boundary test (source order), and the integration 409 on the manual route |
| T8 | Replaying a stale approval after changing the address | The resolution is bound to the fingerprint of phone, address, total, payment and items; a change voids it | Integration: "a material edit after approval voids it" |
| T9 | Duplicate parcels through concurrent or retried booking | The unchanged `courier_dispatch` UNIQUE claim with owner-token CAS; the gate runs before it and never replaces it | Integration: "books exactly once under concurrent booking requests" and "provider timeout … never books a second parcel" |
| T10 | Race between two approvers, or an approver and automatic re-evaluation | CAS on `version`, `decision_version` required, one transaction for resolution and audit | Integration: "two concurrent approvals … exactly one wins" |
| T11 | Identity poisoning: a customer claims a trusted buyer's phone to skip verification | Rules are monotonic: history never removes a reason. Phone association never merges records. | `order-confidence.rules.test.js` "rules are monotonic" |
| T12 | Duplicate or replayed Meta webhook creates duplicate customers or opportunities | Existing receipt claim plus `external_id` dedupe, the Page-scoped unique customer index, the partial unique live-opportunity index, and the advisory lock | Meta E2E "one customer under webhook replay"; integration "idempotently" and "the database refuses a second live opportunity" |
| T13 | Prompt injection through message text | Detection is regex-only (`stage2-rules`). No LLM is called and no text is echoed into any prompt. | Code review; `opportunity-signals.test.js` |
| T14 | Follow-up used to spam or bypass Meta policy | **No new send path.** The feature cannot import a Meta send, provider or webhook-send module. Follow-up is a link to the Inbox, whose manual send runs the central policy engine. Opted-out customers are never flagged. | Boundary test; Meta E2E "a follow-up to a customer who opted out is denied by the central policy engine and never sent" |
| T15 | Stored XSS through customer names, notes or messages in the new UI | React escaping only. No `dangerouslySetInnerHTML`. Opportunity signals store no text. Notes render as text. | Code review (grep); component tests |
| T16 | Filter or query injection through search | Sequelize-parameterised `iLike` with `%` and `_` escaped; length ≤ 100 | Code review; Joi schema |
| T17 | PII in logs or metric labels | Structured logs carry ids and reason codes only. Counter names are a fixed allowlist, and a dynamic label is dropped. Confidence evidence excludes phone, address and name. | `pilot-features.service.test.js` "only known counter names"; `order-confidence.rules.test.js` "evidence carries no phone, address or name" |
| T18 | Admin endpoint abuse | `requirePlatformAdmin()` for reads; `SUPER_ADMIN` for writes; audited in the same transaction (`required: true`) | Integration: "only a SUPER_ADMIN can change them, and every change is audited" |
| T19 | Event tampering: forged `decision_version` | The version is only a precondition. The server re-evaluates and can only refuse (409); it cannot grant. | Integration: stale version gives 409 |
| T20 | Deleted customer keeps derived data | Opportunities CASCADE on customer delete. `order_confidence.customer_id` becomes NULL on delete and holds no PII. | Schema: FKs in the migration |

## Tenant isolation

- **Queries.** Isolation is enforced in each query, not by convention: every
  `findAll`, `findOne` and `update` on a pilot table includes `shop_id`.
  Order history, phone association and conversation reads include
  `shop_id` too.
- **The one cross-shop read** is the pre-existing RTO Shield network signal.
  It is consumed through `checkPhone` exactly as the order flow already does,
  and honours the shop's `rto_network.enforce` choice. The network is not
  expanded.

## RBAC matrix

| Action | owner | admin | staff | platform SUPPORT_ADMIN | platform SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- |
| View Customer 360, opportunities, decisions | ✓ | ✓ | ✓ | — | — |
| Mark contacted / dismiss opportunity | ✓ | ✓ | ✓ | — | — |
| Verify a VERIFY order | ✓ | ✓ | ✓ | — | — |
| Approve a MANUAL_REVIEW order | ✓ | ✓ | ✗ (403) | — | — |
| Order-confidence summary | ✓ | ✓ | ✗ (403) | — | — |
| Read pilot flags | — | — | — | ✓ | ✓ |
| Change pilot flags / disable-all | — | — | — | ✗ (403) | ✓ |

## PII handling

- **New stored PII: none.**
  - Opportunities store message ids and intent ids, not text.
  - Confidence evidence stores counts and order numbers, not phone, address
    or name.
  - The fingerprint is a one-way hash of order facts that already exist in
    `orders`.
- **API responses.** They return phone and email, which merchants already see
  in Orders and Customers. The profile picture is rendered with
  `referrerPolicy="no-referrer"`.
- **Retention and deletion.**
  - The Meta data-deletion path destroys `customers` rows, which cascades to
    opportunities.
  - `order_confidence` survives with `customer_id = NULL`. It has no PII left
    and keeps the business outcome.
  - An order delete cascades both `order_confidence` and the opportunity's
    `converted_order_id` (set NULL).

## Audit

| Event | Action | Written |
| --- | --- | --- |
| Verification | `ORDER_CONFIDENCE_VERIFIED` | Same transaction as the change; a failure aborts the change |
| Approval (override) | `ORDER_CONFIDENCE_APPROVED` | Same, with old decision, note, fingerprint and versions |
| System decision change (level changed, or first non-READY) | `ORDER_CONFIDENCE_EVALUATED` / `ORDER_CONFIDENCE_CHANGED` | Best effort |
| Opportunity contacted / dismissed | `OPPORTUNITY_CONTACTED` / `OPPORTUNITY_DISMISSED` | After the change |
| Pilot flag change | `admin:pilot_features_update` | Same transaction |
| Kill switch | `admin:pilot_features_disable_all` | Same transaction |

## Meta messaging policy constraints

- There is no automated outbound message of any kind.
- The reply-window indicator is advisory. The policy engine still decides
  every send:
  - `twentyFourHourWindow`, `messengerOptedOut`, `consentRequired`,
    `templateRequired` and `rateLimit`;
  - plus the existing HITL, AI-pause and business reply-mode guards on the
    Inbox path.
- Sales follow-up **outside** the 24-hour window is not offered. Meta message
  tags are not valid for sales, so the UI says to wait for the customer.

## Residual risks (accepted for the pilot)

- **Shared phones.** Phone association can show a relative's unlinked orders on
  a customer. The orders are labelled "Matched by phone" and are never merged.
  Rules are monotonic, so it can only add caution.
- **Pre-existing RBAC gap.** Staff can edit any `shops.settings` key through
  `PATCH /shop/:id`. This feature is not affected (ADR-0009). It is recorded
  as technical debt, not fixed here.
- **Pre-existing integrity gap.** `_createOrderCore` accepts a `customer_id`
  without checking that it belongs to the shop. Reads here filter by
  `orders.shop_id`, so nothing leaks. It is recorded as debt.
