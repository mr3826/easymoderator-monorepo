# IC-V1 01 — V6 Action-First Reconciliation (contract ported; owner-rebase package)

**Source reviewed:** `feature/merchant-journey-v6-action-first` @ `50b52e86…` (clean, 15 commits
above merge-base `71603e9f`). **Rehearsal:** disposable worktree
`D:\easymod\_rehearsal-mw-v1-integration`, merge commit `f32de36b` (T ⊕ v6).
The v6 worktree itself was NEVER touched.

## What the rehearsal proved

| Layer | Result | Decision |
|---|---|---|
| Backend service/API layer | auto-merged, **496/496** order+conversation unit tests green; tsc 0; vite build green | safe subset → ported (below) |
| FE `src/api` + `src/shared` contract plumbing | auto-merged clean and coherent | ported (below) |
| FE UX shell (Dashboard action-first, layouts, http-client ordering, new screens) | **merged WITHOUT conflicts yet broke 30 named behaviors (27 UnifiedInbox + 1 Dashboard + 2 i18n-coverage guards)** | NOT ported — owner rebase required |

## Ported into IC at `65c99f43` (contract-only, each with its v6 tests)

1. Draft-order courier-booking gate (`DRAFT_ORDER_NOT_BOOKABLE`, 409) + 18-spec — verified
   genuinely absent at 434a8cfc; placed after the already-booked idempotent return.
2. `order_status` list-filter enum (service application already existed at base, line 650) + 13-spec.
3. Dev-environment CSRF cookie naming (prod keeps `__Host-` security contract) + 13-spec —
   this also removes the per-context CSRF friction observed in live-browser testing.
4. `__skipGlobalErrorToast` client config + CSRF-failure detection widened to the top-level
   `message` error shape + 17-spec; `createMessage` opts into both.
Re-gated in IC: backend order+csrf 323/323, FE toast+conversation-domain 37/37, tsc 0,
full combined battery per doc 03.

## Owner-rebase acceptance package (v6 owner)

Rebase `feature/merchant-journey-v6-action-first` **onto** the IC branch and make ALL of the
following green without editing the assertions (they encode Pilot+/increment guarantees).
Captured from the rehearsal merge (vitest, canonical file list). **Base caveat (review F3):** the rehearsal was T=increment-1 (3d1bc0eb) + v6; the owner now rebases onto the IC, so the failure set is expected to shift (increment-2 features like the context panel add new guarantees to keep). Counts verified independently by the adversarial reviewer: 30 failed / 43 passed on the three files:

**i18n coverage guard (2):** `defines every t() key used in source in en.json`, `… in bn.json`
— v6 components added keys; union both locale files.

**Dashboard (1):** `renders the business overview and labels order totals accurately`.

**UnifiedInbox (27):** URL-selected-conversation return from customer profile; paging beyond
50; SSE-reconnect page preservation; out-of-range page clamp; failed-page retry (not
previously-accepted reload); filter/search resets to page 1; no duplicate pending page-one
request; filter-tab deep-link restore; empty-search+filter announcement; empty-filter
current-page wording; accessible retry state on load failure; 24h warning banner ~23h;
send disabled on expired window (legacy tags unavailable); no manual send with deprecated
tag after window; quick-reply insert-not-send; image attachment as upload metadata; AUTO-mode
processing claim; AUTO sent terminal state; reply status survives language change; no status
copy across conversations on page change; current AI mode wins over older refresh result;
tablet one-pane mode; reply stays open until provider confirms; next-exact-task after
confirmed delivery; mobile context exact-linked customer, no inferred order link; claim
cleared + failed terminal on delivery failure; no blind retry after provider call started.
(Names as printed above; full list reproducible by re-running
`npx vitest run src/test/UnifiedInbox.test.tsx src/test/Dashboard.test.tsx src/i18n/__tests__/translation-coverage.test.ts`
on merge `f32de36b`.)

**Root cause to design around:** v6's `DashboardLayout.tsx` / `shared/lib/http/client.ts`
/ workspace-nav changes shift request ORDERING and arg shapes the inbox relies on
(e.g. `expected 1st getConversations call with { page: 99, limit: 50 }`). The rebase must
port v6's UX onto the CURRENT inbox data-flow contracts (or adapt contracts with matching
test updates justified to the reviewer), not vice versa.

**Also deferred (catalogued, not silently dropped):**
- orders-v2 unique commit `3b68c699`: `Idempotency-Key` on `POST /api/order`, `delivered`
  in list-filter enum, `/mobile/orders` + delivery-status changes — evaluate at
  order-execution resumption (overlaps the v6 order.validator port above).
- v6 growth-os route touch (1 line) — Growth OS workstream owns it; out of merchant scope.
- v6 test-file rewrites for Orders.test.tsx etc. — owner rebases them with their UI.
