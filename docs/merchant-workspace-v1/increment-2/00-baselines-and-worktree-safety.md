# 00 — Baselines & Worktree Safety

**Milestone:** Merchant Workspace V1 Increment 2
**Date (UTC):** 2026-10-25
**Author:** coding agent (root Goal worker)
**Status gate:** BASELINE_VERIFIED = PASS

## Fresh verification of the starting candidate (not the reported history)

Run read-only from `D:\easymod\_wt-merchant-workspace-v1-increment1`
(`feat/merchant-workspace-v1-increment1`).

| Claim | Command | Observed | Verdict |
|---|---|---|---|
| Increment 1 HEAD | `git rev-parse HEAD` | `3d1bc0eb4988ce52fda9fcde9191c7d87e645139` | matches task STARTING_SHA |
| Increment 1 tree clean | `git status --porcelain` (wc -l) | 0 lines | CLEAN |
| production `2a8c1e2d` is ancestor | `git merge-base --is-ancestor 2a8c1e2d HEAD` | exit 0 | ANCESTOR |
| main `07168f49` is ancestor | `git merge-base --is-ancestor 07168f49 HEAD` | exit 0 | ANCESTOR |
| Pilot+ `9f562aaf` is ancestor | `git merge-base --is-ancestor 9f562aaf HEAD` | exit 0 | ANCESTOR |
| Pilot+ worktree untouched | `git -C _wt-pilotplus-v1 rev-parse HEAD` | `9f562aaf…` (clean) | PRESERVED |
| Product V1.3 worktree | `git -C _wt-product-engine-v1-3 rev-parse HEAD` | `f0f04e4e…` (dirty=3, checkpoint docs + V1.3 pause patch) | ACTIVE-OWNED — do not touch |

Lineage (source-verified):

```
2a8c1e2d  Production baseline
07168f49  Reviewed main (origin/main == 07168f49 after read-only `git fetch --prune`)
9f562aaf  Pilot+ V1
3d1bc0eb  Merchant Workspace Increment 1   ← STARTING_SHA
```

`git rev-list --count 9f562aaf..3d1bc0eb` = **7** = exactly the Increment 1 set:
`aefa429f` FE-03, `3425a6d6` FE-01, `cbc3407a` FE-08, `01a622d0` E2E,
`3c8d28a7` review-fixes, `d46cb6b1` handoff, `3d1bc0eb` screenshots.

## Increment 1 fixes re-verified in the SOURCE (Phase 0)

**FE-01 (claim-free macros):** `UnifiedInbox.tsx` `buildFallbackTemplates` now emits 5
entries; each content string is a promise-to-check or information request — no order/stock/
payment/courier/charge/return facts. Composer insert path
`inbox/InboxComposer.tsx handleTemplateInsert → setEditingMessage` only; no auto-send;
`approveAiDraft` remains a separate code path (grep-confirmed). **CONFIRMED.**

**FE-08 (verified order→inbox link):** `src/api/domains/order.ts normalizeOrder` sets
`customerId: raw.customerId ?? raw.customer_id ?? raw.customer?.id ?? undefined`;
`Orders.tsx` effect queries `getConversations({ customer_id, limit: 1 })` with a client-side
`String(c.customer_id ?? '') === String(customerId)` re-check before any message fetch,
AbortController cleanup, and canonical `/inbox?conversation=<id>` deep link. Backend
`conversation.service.js getConversations` applies `whereClause { shop_id, customer_id }`.
`src/api/types/order.ts Order` has `customerId?`. **CONFIRMED.**

**FE-03 (dead helpers gone):** `assignConversation`/`closeConversation`/`reopenConversation`
absent from `src/api/domains/conversation.ts` (verified by read). **CONFIRMED.**

## CRITICAL live-contract verification (closes Increment 1 reviewer finding F)

Increment 1 reviewer flagged (correctly, as an inference) that `GET /api/conversation`'s Joi
validator `getConversations.query` lists only `page|limit|status|channel` — NOT `customer_id`
— and asked whether FE-08's live request would 400. **Verified at source in this phase:**

`src/middleware/validate.middleware.js:17-21`:
```js
const { error, value } = schema.validate(req[key], {
    abortEarly: false,
    stripUnknown: key === 'body',
    allowUnknown: key !== 'body'   // query & params ALLOW unknown keys
});
```

For `key === 'query'`, `allowUnknown: true` and `stripUnknown: false`, so `customer_id` is
NOT rejected and NOT stripped; `req.query = value` (unchanged) then flows to
`conversation.service.js`, whose `if (customer_id) whereClause.customer_id = customer_id`
applies it inside `whereClause = { shop_id: req.user.shopId }`. **The FE-08 contract is sound
at the HTTP layer.** Runtime confirmation on a live backend is still pending (Docker down —
see below) and will be exercised in Phase 8 real-stack integration before any
`customer_id`-based external contract is announced.

This is load-bearing for Phase 3 (customer context reuses the SAME authoritative
`customer_id`-within-shop filter; no alternate unguarded endpoint, per mission §7.3).

## Worktree design (two logically separate areas)

1. **Integration rehearsal (disposable):**
   `D:\easymod\_rehearsal-mw-v1-integration`, branch `rehearsal/mw-v1-integration`,
   from `3d1bc0eb`. Used only to merge/collide-test frozen workstreams. Never pushed.
2. **Increment 2 implementation (protected):**
   `D:\easymod\_wt-merchant-workspace-v1-increment2`, branch
   `feat/merchant-workspace-v1-increment2`, from `3d1bc0eb` (INC2_DIRTY=0 at creation).

Per mission §2.3, Increment 2 starts from the frozen Increment 1 tip. It will NOT be
re-based onto a rehearsal commit unless the rehearsal reaches PASS with frozen inputs AND
the merged content is required for a merchant job — otherwise external workstream drift
orders-v2/v6/mobile remain recorded as dependencies (Phase 1 decides).

## Isolation constraints in force

- Dedicated ports/DB/Redis namespace for any preview: reuse of the Pilot+ lab namespace is
  only permitted because those servers are DOWN (host Docker Desktop Linux engine is not
  running; `dockerDesktopLinuxEngine` pipe absent; `Test-NetConnection` 3000/5173/5432 all
  False). No other agent workload is stopped to make anything pass.
- Product V1.3, Pilot+ V1, Increment 1 worktrees are read-only to this agent.
- No reset/clean/cherry-pick into, or commit inside, any protected worktree.

## Docker / real-stack readiness state (honest)

Host Docker Desktop engine is unavailable this session (repeatedly probed; never came up
after the machine reboot). Real-stack Postgres/Redis integration and browser E2E against a
LIVE backend are therefore BLOCKED until the engine recovers. Mocked-route Playwright and
unit suites still run. `INTEGRATION_REHEARSAL`, `POSTGRES_REDIS_INTEGRATION`, and live
`FOUNDER_PREVIEW` will be reported PARTIAL/BLOCKED, never PASS-by-inference.
