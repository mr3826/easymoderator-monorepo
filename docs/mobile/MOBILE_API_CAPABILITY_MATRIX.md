# Mobile API Capability Matrix

Status: Living document (Wave 2 checkpoint)<br>
Date: 2026-09-16

Legend: **PASS** = exists today and mobile can use it as-is · **PARTIAL** = exists but needs an
additive backend change before mobile can rely on it safely · **NEW** = does not exist, mobile
introduces it (additive, flag-gated) · **DEFERRED** = not available from any provider/source yet;
mobile must not fake it.

| Capability | Mobile phase | Status | Notes / evidence |
|---|---|---|---|
| Bearer token auth (read) | P1 | PASS | `authenticate` already accepts `Authorization: Bearer` (`auth.middleware.js:18-19`) |
| Bearer token issuance (signin/refresh in body) | P1 | PASS | Native `/api/auth/native` envelope/refresh-token contract is implemented and fixture-tested (ADR M-004/M-003) |
| Per-device session list/revoke | P1 | PASS | Native session list/revoke routes use the active `user_sessions` row and expiry checks (ADR M-004) |
| Shop switch | P1 (if multi-shop staff exist) | PARTIAL | `/api/shop/switch` called by web, does not exist server-side (`CURRENT_STATE.md` §4) — mobile's native auth adds `switch-shop` under the new native namespace; the pre-existing web gap is reported, not fixed by this program |
| Idempotent mutation support | P1 foundation, used P4/P5 | PASS (reuse) | `audit/idempotency.middleware.js` already correct; manual-order gap closed as part of applying it (ADR M-006) |
| Native read-only mutation policy | P2 | PASS | Native `sid` sessions are server-denied on non-auth mutations; web tokens retain existing behavior |
| Native cookie/CSRF transport | P1 | PASS | Mobile omits browser credentials; flag-off native routes resolve to 404 before CSRF |
| Attention feed | P2 | PASS | `GET /api/mobile/attention` is implemented, flag-gated, tenant-scoped, terminal-safe, reason-coded, and consumed by Home (ADR M-008) |
| Today summary (Dhaka-correct) | P2 | PASS | `GET /api/mobile/today` returns expected order value semantics and is consumed by Home (ADR M-008) |
| Native 2FA verification | P1 | PASS (Wave 2.5) | Dedicated mobile verify UI uses the existing `requires2fa/tempToken` contract; native route is one-use/TTL-bound and rate-limited to five attempts per five minutes per IP; resend is not supported |
| Push registration (FCM) | P2 | PASS (reuse) | `POST /api/notifications/subscriptions` already accepts the native FCM token shape (`CURRENT_STATE.md` §8) |
| Push send correctness (membership-scoped) | P2 | PARTIAL → fixed by Track D #4 | must land before Phase 2 real-device testing (ADR M-007) |
| Conversation list + needs-reply projection | P3 | PASS | `needs_merchant_reply`, `hitl`, `ai_is_replying` already projected (`CURRENT_STATE.md` §7) |
| Conversation needs-reply/unread server-side filter | P3 | PARTIAL | no filter param today; P3 ADR decides additive query param vs. client-side filter |
| Reply send (idempotent, 24h-window enforced) | P3 | PASS | `Idempotency-Key` + server-enforced window already correct (`CURRENT_STATE.md` §7) |
| SSE live updates | P3 | PARTIAL | endpoint exists; RN needs an `EventSource` polyfill supporting `Last-Event-ID` (`CURRENT_STATE.md` §7) |
| Order list with status filter + total count | P4 | PARTIAL | list exists, no filter/total today (`CURRENT_STATE.md` §5) — additive query params |
| Order status vocabulary mobile can trust | P4 | PARTIAL → M-012 | read-only projection now; write-path ADR required before Phase 4 mutation UI (ADR M-012) |
| Order create (idempotent, manual path) | P4 | PARTIAL | endpoint exists; idempotency key population is the gap, closed by ADR M-006 |
| Order confirm/cancel | P4 | PARTIAL | endpoints exist; confirm's implicit courier-booking side effect and cancel-after-delivery need the M-012 follow-up before mobile exposes them as one-tap actions |
| Customer verification evidence (RTO-shield, history) | P4 | PASS | `rto-shield POST /check` and customer/order history endpoints already exist (`CURRENT_STATE.md` §7 discovery) |
| Courier book/retry | P5 | PASS (reuse), double-booking fixed by Track D #3 | `POST /api/order/:orderId/courier` exists; per-provider claim scoping bug fixed on `main` first (`CURRENT_STATE.md` §6) |
| Courier cancel | P5 | DEFERRED | no cancel capability exists on any provider integration today (`CURRENT_STATE.md` §6) |
| Courier tracking / problem-parcel query | P5 | DEFERRED | no tracking-history or problem-parcel surface exists today; webhook-only status (`CURRENT_STATE.md` §6) |
| COD collection amount (correct for prepaid) | P5 | PARTIAL → fixed by Track D #2 | must land before Phase 5 shows any COD figure |
| COD settlement (actual cash collected, reconciled) | P5 | DEFERRED | Steadfast PARTIAL, Pathao/RedX not implemented (`CURRENT_STATE.md` §6) — mobile shows order-derived expected COD only, never presented as settlement |
| Product list (paginated) | P6 | PARTIAL | unpaginated today (`CURRENT_STATE.md` §9) — additive pagination params |
| Product stock/price update | P6 | PASS | existing update endpoint, reused with idempotency (ADR M-006) |
| Per-variant write | P6 | DEFERRED | no per-variant update endpoint exists today (`CURRENT_STATE.md` §9) |
| Photo → Draft extraction | P6 | PASS (reuse) | `POST /api/product/ai-extract` already exists (`CURRENT_STATE.md` §9) |
| Low-stock signal | P6 (surfaced earlier in P2 attention feed) | PASS | `low_stock_threshold` is consumed by the flag-gated P2 attention feed with active/tracked filtering |
| Cross-tenant write protection on products | all phases touching products | PARTIAL → fixed by Track D #1 | mass-assignment gap (`CURRENT_STATE.md` §9) must land before any phase's product mutation tests are considered trustworthy |

No capability in this matrix is marked PASS without a specific file/line citation in
`CURRENT_STATE.md`; no capability is marked DEFERRED without a specific reason mobile cannot work
around it (never a provider mobile can call directly, per the program's constraints).
