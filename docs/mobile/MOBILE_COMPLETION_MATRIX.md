# Mobile Product Completion Matrix

Status: Active implementation baseline
Date: 2026-09-29
Source of truth: current `origin/main` source plus accepted mobile product/architecture records.

## Product Decision

EasyModerator Web configures the business; Mobile runs the business. Mobile work is prioritized by
the merchant funnel and must reuse backend authority rather than reproduce business rules locally.

The implementation order is:

1. Inbox and Needs Me
2. Orders and customer quick view
3. Courier actions and tracking where provider contracts support them
4. Products and stock/price operations
5. Push notifications and notification routing
6. Settings, shop switching, and permission-complete account surfaces
7. Subscription/usage and analytics only where current product evidence makes them mobile scope

## Feature Matrix

| Domain | Feature | Web/backend capability | Mobile implementation | API support | Access control | Offline behavior | Test/proof | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | Sign-in, native 2FA, refresh, logout | Native auth contract exists | Complete in `EasyMod-mobile/src/auth` | Native auth routes | Native session, `sid`, token version, shop membership | Read-only offline session; no writes | Unit, integration, signed device proof | COMPLETE | P0 |
| Auth | Session expiry/revocation | Native session routes exist | Complete | Native refresh/session routes | Server revocation authoritative | Purges after refusal | Unit/integration/device proof | COMPLETE | P0 |
| Shop | Shop switching | Native switch route exists | No UI or state-transition surface | Native switch route | Membership checked server-side | Purge and re-key cached state required | Native auth tests only | PARTIAL | P0 |
| Home | Today summary | `/api/mobile/today` | Complete | Mobile route | Current shop scope | Cached/stale read-only | Component/integration/device proof | COMPLETE | P1 |
| Home | Needs Attention | `/api/mobile/attention` | Complete | Mobile route | Current shop scope | Cached/stale read-only | Component/integration/device proof | COMPLETE | P1 |
| Inbox | Needs Me list | Web conversation list/projection | Paginated native list with Needs Me/unread filters and loaded-page search | `/api/mobile/inbox/conversations` | Native shop membership via existing middleware | Online-only with explicit offline state | Mobile component/backend tests; CI pass | PARTIAL | P1 |
| Inbox | Conversation detail/messages | Web detail/messages | Read-only native transcript route; existing deep links remain safe resolver | `/api/mobile/inbox/conversations/:id` and `/messages` | Current-shop entity access | Online-only until safe transcript cache defined | Mobile component/backend tests; CI pass | PARTIAL | P1 |
| Inbox | Read/unread and filters | Web read/status/filter behavior | Missing | Existing read/status APIs; native route blocked | Role/membership required | No offline mutation | No mobile feature tests | MISSING | P1 |
| Inbox | Human reply / AI draft action | Web idempotent reply and HITL policy | Missing | Existing write endpoints; native write policy blocks them | Explicit mobile capability and role matrix required | Online-only; no blind queue | Backend contract tests only | MISSING | P1 |
| Inbox | Attachments/media | Web signed attachment pipeline | Missing | Existing attachment preparation/delivery | Shop-bound signed keys | Online-only; compress before upload | Web-only tests | MISSING | P2 |
| Orders | List/search/filter | Web order list | Paginated native list with status/search filters and explicit empty/offline/error states | `/api/mobile/orders` | Native shop membership via existing middleware | Online-only with explicit offline state | Mobile/backend contract tests; CI pass | PARTIAL | P1 |
| Orders | Detail/customer/timeline | Web order detail | Read-only native order detail with customer, payment, fulfillment, and line items | `/api/mobile/orders/:id` | Shop-scoped order read | Online-only until safe detail cache defined | Mobile route pending device proof | PARTIAL | P1 |
| Orders | Confirm/cancel/status | Web mutations | Missing | Existing endpoints; status side effects require M-012 review | Role and state machine required | Online-only, idempotent | Backend tests, no mobile proof | PARTIAL | P1 |
| Orders | Manual order creation | Web/manual endpoint | Missing | Existing endpoint; idempotency contract exists | Role/permission required | Online-only | Backend contract only | PARTIAL | P2 |
| Courier | Book/retry | Web courier endpoint | Missing | Existing provider abstraction | Role plus order state | Online-only; no direct provider calls | Backend/provider tests only | PARTIAL | P1 |
| Courier | Tracking/problem parcel | Provider webhook/status only | Missing | No authoritative tracking history endpoint | N/A until backend contract exists | Online-only | No test surface | DEFERRED | P1 |
| Courier | Cancel | Provider capability absent | Missing | No supported provider contract | N/A | N/A | No provider proof | FUTURE_SCOPE | P2 |
| Products | Paginated catalog | Web catalog currently unpaginated | Missing | Needs additive pagination | Read role required | Cacheable/stale | No mobile tests | PARTIAL | P1 |
| Products | Stock/price update | Existing product update | Missing | Existing update; cross-tenant mass-assignment risk must be closed | Role and product scope | Online-only/idempotent | Backend security tests required | PARTIAL | P1 |
| Products | Photo to Draft | Existing AI extraction | Missing | Existing extraction endpoint | Explicit confirmation; never auto-publish | Online-only | Web/backend only | PARTIAL | P2 |
| Customers | Quick view from Inbox/Orders | Customer/order history exists | Read-only quick view linked from Inbox/Orders with recent orders | `/api/mobile/customers/:id` | Native shop membership plus customer/order shop checks | Online-only until safe detail cache defined | Mobile/backend contract tests; device proof pending | PARTIAL | P1 |
| Customers | Customer notes/tags/segmentation | Web/CRM capability varies | Missing | Contract must be checked per action | Role-specific | Online-only | No mobile tests | FUTURE_SCOPE | P2 |
| Notifications | FCM registration/routing | Existing subscription endpoint | No registration/tap handler | Existing notifications subscription API | Membership/shop scoped | Token cleanup on logout/revocation | Backend partial; no current mobile proof | PARTIAL | P1 |
| Settings | Profile/shop/membership | Web settings and native auth identity | Missing mobile screens | Existing shop/member APIs vary | Role-specific | Online-only | No mobile tests | PARTIAL | P2 |
| Settings | Sessions/devices/2FA | Native session APIs | No management UI | Native session list/revoke; 2FA verify | Account owner | Online-only | Backend tests only | PARTIAL | P2 |
| Billing | Plan/usage/quota | Web subscription | No mobile scope decision in current product records | Existing web billing API | Billing/admin roles | Online-only | No mobile proof | NOT_MOBILE_SCOPE | P2 |
| Analytics | Merchant KPIs | Web dashboard/Growth analytics | No mobile scope decision in current product records | Existing web analytics | Merchant/admin roles | Online-only | No mobile proof | FUTURE_SCOPE | P3 |
| AI | Mode/HITL visibility | Web Inbox/AI settings | Home reasons only; no action surface | Existing AI mode/settings | Role/entitlement | Read-only when offline | Home proof | PARTIAL | P2 |
| Platform | Customer 360/Sales Opportunities/RTO v2 | Web pilot | Explicitly not in current native scope | Web pilot APIs | Web/platform flags | N/A | Web pilot proof | NOT_MOBILE_SCOPE | P1 |

## Access Matrix Baseline

The current backend defines merchant membership roles in `user_shops.role` and separately defines
platform/Growth roles. Native authorization currently checks membership and a narrow route allowlist;
it does not grant web permissions merely because a user can sign in natively.

| Capability | Owner/admin | Staff/member | Platform Super Admin | Native contract today |
| --- | --- | --- | --- | --- |
| Native login/refresh/logout | Allowed if membership active | Allowed if membership active | Depends on shop membership | Implemented |
| Home read | Allowed | Allowed | Only with shop context | Implemented |
| Conversation read | Backend supports web role checks | Backend supports web role checks | Platform role is not a shop context | Native route missing except entity summary |
| Conversation reply | Web policy/role dependent | Web policy/role dependent | Not a native merchant action by default | Native denied; requires reviewed capability |
| Order read | Web role dependent | Web role dependent | Requires shop membership | Native entity read only |
| Order mutation | Web role/state dependent | Must be explicitly allowed | Requires shop membership | Native denied by policy |
| Courier booking | Web role/order state/provider dependent | Must be explicitly allowed | Requires shop membership | Native denied by policy |
| Product write | Web role dependent | Must be explicitly allowed | Requires shop membership | Native denied by policy |
| Customer read/write | Web role dependent | Must be explicitly allowed | Requires shop membership | Native route missing |
| Session revoke | Account owner/security path | Account owner/security path | N/A | Backend exists; UI missing |

Every new write capability must add a deliberate `/api/mobile/*` contract, server-side role/shop
authorization, idempotency where consequential, audit coverage, and a negative authorization test.
It must not simply remove the native read-only guard.

## Classified TODO Sources

| Source | Finding | Disposition |
| --- | --- | --- |
| `EasyMod-mobile/src/app/(tabs)/*.tsx` | Inbox, Quick Action, Orders are placeholder screens | Current missing verticals; Quick Action remains a design surface and must not invent writes |
| `docs/mobile/MOBILE_API_CAPABILITY_MATRIX.md` | P3-P6 capabilities and additive API gaps | Current implementation backlog, reconciled above |
| `docs/mobile/MOBILE_PRODUCT_SPEC.md` | SELL -> VERIFY -> DELIVER -> COLLECT priority | Product ordering adopted |
| `docs/mobile/AGENT_HANDOFF.md` | Wave 2.5 complete, future scope deferred | Historical handoff; superseded by this completion program for current scope |
| `docs/mobile/MOBILE_EXECUTION_STATE.md` | Phase 3 Inbox, Phase 4 Orders, Phase 5 Courier, Phase 6 Products | Execution sequence adopted |
| `MOBILE_*` flags in backend config | Native API, push, order, courier, AI draft controls | Extend only with additive capability flags where required |
| `EasyMod-mobile/src/app/order/[id].tsx` and `conversation/[id].tsx` | Safe placeholder deep-link detail | Replace with bounded detail views as the corresponding vertical ships |
| Push/FCM docs and backend subscription route | Partial push contract | Complete only after membership/shop targeting is proven |

## Execution Order And Exit Criteria

The first vertical is Inbox read/detail/read-state because it directly reduces merchant response delay,
reuses existing conversation services, and establishes the native contract pattern needed by Orders.
Inbox writes will not be enabled until an explicit mobile capability flag, role matrix, idempotency,
policy, and device proof are implemented.

Each vertical is complete only when its API contract, access matrix, offline state, tests, release build,
device flow, merged PR, and production compatibility evidence are present.
