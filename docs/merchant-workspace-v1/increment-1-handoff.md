# Merchant Workspace V1 — Increment 1 (Founder Handoff)

**Date:** 2026-10-25
**Branch:** `feat/merchant-workspace-v1-increment1` (worktree `D:\easymod\_wt-merchant-workspace-v1-increment1`)
**Initial SHA:** `9f562aaf1559171c97902838a9bc5408283e2881` (Pilot+ V1 verified candidate — untouched, its worktree remains intact)
**Final SHA:** see `git log --oneline 9f562aaf..HEAD` tip (docs commit below)
**Scope authorization:** Gate-0 reconciliation items FE-01 (P0), FE-08 (P1), FE-03 (P1) from `D:\easymod\EasyModerator_Frontend_Backend_CRM_Gap_Audit_2026-10-25.md`.

## Commits

| SHA | Scope | Purpose |
|---|---|---|
| `aefa429f` | FE-03 | Remove three dead conversation API helpers targeting unmounted routes |
| `3425a6d6` | FE-01 (P0) | Claim-free quick-reply fallbacks in the inbox composer |
| `cbc3407a` | FE-08 (P1) | Verified `customer_id` order→conversation link + canonical deep link |
| `01a622d0` | E2E | Playwright journeys ×3 + screenshots (chromium AND firefox 10/10) |

Changed files (all in `EasyMod-frontend/`, plus `docs/` evidence; **ZERO backend files** —
`git diff --name-only 9f562aaf..HEAD -- EasyMod-backend` is empty):
`src/app/components/UnifiedInbox.tsx`, `src/app/components/Orders.tsx`,
`src/api/domains/{conversation,order}.ts`, `src/api/types/order.ts`,
`src/i18n/locales/{en,bn}.json`, tests (`QuickReplySafety.test.ts` new;
`UnifiedInbox/Orders/order.test` extended; `pilot-plus.spec.ts` +3 journeys).

## Before → after behavior

### FE-01 — composer quick-reply fallbacks (P0 customer-truth)
- **Before:** with no merchant templates — *including when the templates API simply failed to load* — the composer offered ten hard-coded replies asserting business facts ("আপনার অর্ডার confirm হয়েছে ✅", "Stock আছে", "Advance ৳[Amount] bKash করুন", "পার্সেল courier এ দেওয়া হয়েছে", "৳60/৳120 charges", "3 দিনের মধ্যে return", "COD available", "আজকেই dispatch"). Any of these could reach a customer containing an unverified truth even after merchant review, because the text implied verified status.
- **After:** fallbacks contain only (a) promises to check and follow up and (b) requests for information — zero business facts. Merchant-authored templates remain the only source of shop-specific wording (shown instead of fallbacks whenever at least one active template exists). Insert is still text-into-editable-composer only: no auto-send, no AI-grounding-approval inheritance (asserted by tests).
- **Files:** `UnifiedInbox.tsx:201-214` (new builder + invariant comment), locales `inbox.templates` block (8 orphaned claim-labels removed, 3 neutral added).

### FE-08 — Order detail "Customer Chat" (P1 cross-customer data exposure)
- **Before:** `Orders.tsx` queried `getConversations({ search: customerName, limit: 1 })`. The list endpoint **ignores unknown query keys**, so this actually returned the shop's most recently updated conversation — the detail modal could display a DIFFERENT CUSTOMER's messages under this order's name (a truth AND privacy bug, worse than the audit's duplicate-name framing).
- **After:** only the order's verified, shop-scoped `customerId` (now normalized through from `customer_id` / `customer.id`) queries the **existing** `GET /api/conversation?customer_id=` filter (enforced inside `whereClause { shop_id: req.user.shopId, customer_id }` server-side); the client re-checks the returned row's `customer_id` before touching messages; unlinked orders (manual/`customer_id` NULL) render the honest "No chat snippet found." and issue NO lookup; a verified association gains the canonical `/inbox?conversation=<id>` deep link (identical contract to the P+03 action queue). In-flight lookups abort when the merchant switches orders or closes the modal.
- **No new authority invented:** zero backend change; no cross-channel identity merge — the link is the shop's own order.customer_id ↔ conversation.customer_id relation.
- **Files:** `src/api/types/order.ts` (+customerId), `src/api/domains/order.ts` (mapper), `src/api/domains/conversation.ts` (optional AbortSignal, backwards-compatible), `Orders.tsx` (effect + unavailable state + link button), locales (+1 key).

### FE-03 — dead API helpers
- **Before:** `assignConversation`/`closeConversation`/`reopenConversation` existed in `src/api/domains/conversation.ts:91-118`, aimed at routes the backend does not mount (`/assign`, `/close`, `/reopen`), reachable only by a future mistaken import — while the REAL, integration-tested flow is the canonical PATCH (`updateConversation`) with 409 conflict ownership.
- **After:** removed; zero references repo-wide (barrel `src/api/index.ts` never re-exported them), tsc clean, conversation domain suite unaffected (29/29).

## Verification evidence

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| Vitest full frontend suite | **644/644** (628 baseline + 16 new) |
| New unit specs | QuickReplySafety 5 (claim-free invariants); UnifiedInbox wiring +5 (empty/API-failure/merchant-present/inactive/insert-not-send); Orders component +5 (verified link, unlinked unavailable, wrong-customer refusal, empty list, stale-request discard); order mapper +1 (flat/nested/null) |
| Playwright `pilot-plus` | **10/10 chromium AND 10/10 firefox** (7 pre-existing Pilot+ journeys as regression gate + 3 new increment journeys with request-level assertions: no `search=` param ever sent, `customer_id=` used, URL lands on `/inbox?conversation=conv-1`, no lookup for unlinked orders) |
| Vite build | success |
| Backend suites | NOT re-run — diff proves zero backend changes; the reused `customer_id` list filter's tenant scoping was source-verified (`conversation.service.js` whereClause built from JWT shopId) |
| Storefront-contract check | all changes channel-neutral (ids/refs only, no Meta-specific semantics added) |
| Draft/Manual/Auto + choices + handoff recheck | P+01/P+03/P+05 journeys pass unchanged in the same run; interaction kernel untouched; takeover-conflict journey (409 honesty) still green |
| Screenshots | `screenshots/fe01-quick-replies-claim-free.png`, `fe08-order-detail-linked.png`, `fe08-order-detail-unlinked.png` |

## Independent review
Fresh-context adversarial reviewer (`ses_e8ccd8420…`, full diff read + commands re-run):
**APPROVED_WITH_FINDINGS — no blockers, no majors.** It independently confirmed the two
dangerous premises of this increment: (1) the backend list endpoint DOES ignore `search`
(making the old name lookup actually return the shop's most recently active conversation —
a cross-customer display bug, worse than the audit framed it), and (2) `handleTemplateInsert`
is provably insert-only — the AI-approval path (`approveAiDraft`) is entirely separate and
untouched. Tenant scoping verified at source: JWT-only shopId through `authenticate` +
`verifyShopAccess`, `whereClause { shop_id, customer_id }`. Reviewer's own run: tsc 0, its
5-suite focused subset 117/117.
Four minor findings; ALL ADDRESSED the same session (see fix commit):
1. deep link now uses `encodeURIComponent` matching the two existing producers;
2. domain-level unit tests added for the new `signal` plumbing (present AND omitted-when-absent axios config);
3. linked-but-empty conversation now reads "The linked conversation has no recent messages." instead of contradicting itself with "No chat snippet found." while also offering the open button (component test added);
4. docs/memory committed alongside the increment (this file).
Post-fix re-gates: tsc 0, vitest **647/647**, Playwright **10/10**.

## Security / tenant-scope notes (FlowGuard pass)
- FE-01 surface strictly SHRANK: static neutral strings into a textarea (React-escaped, plain-text send path); removed attack-of-misleading-content, added none.
- FE-08 access path narrowed from "arbitrary conversation by shop recency" to "conversation filtered by server-side shop scope + client identity recheck". `customerId` values originate from the shop's own order DTO (already JWT-scoped); no new endpoint, no new parameter accepted by the backend, no name/phone-based matching anywhere.
- FE-03 deletion removes two route-shaped failure modes; auth model untouched.
- i18n: removed keys have zero remaining references; no key used from untrusted data.

## Known limitations / not done (honest ledger)
- Live full-stack founder preview could not be restarted this session: the machine's Docker Desktop Linux engine failed to come up after an OS reboot (`dockerDesktopLinuxEngine` pipe never created; WSL distros stopped). The increment is FE-only and its Playwright gate uses the repo-conventional route-mocked stack; the real-stack lab (identical backend bytes, seeded DB volume survives) will serve the new UI as soon as Docker Desktop is healthy: `powershell -File scripts\pilotplus-lab.ps1`.
- WebKit remains a pre-existing harness limitation (unchanged from Pilot+ gates).
- Playwright cold-start flake observed on the brand-new worktree's first parallel batch (vite transform timeout); sequential runs 10/10 twice. CI's `retries: 2` already covers this class.
- Template variables (`{{...}}` capability gap FE-10) and remaining CRM rows: NOT in this increment's authorized scope.

## Safe integration
1. Review: open `http://localhost:5173` after `powershell -File scripts\pilotplus-lab.ps1` (creds in `docs/pilot-plus-v1/10-founder-handoff.md`), or just read the three screenshots + this file.
2. Merge order: this branch is a linear child of Pilot+ V1 (`9f562aaf`). If Pilot+ merges to main first, this needs no rebase. If another workstream (orders-v2/v6/mobile) merges first, expect at most trivial conflicts in `Orders.tsx` / `conversation.ts` (file-ownership notes: doc 02 §0 of Pilot+).
3. Kill switch: none needed — these are contract fixes, no new feature flags; merchant-visible behavior only becomes safer.
4. Do NOT deploy from this worktree without the standing production-authorization gate.
