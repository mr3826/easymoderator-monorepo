# IC-V1 02 — Mobile API Contract Compatibility

**Method:** entirely read-only git archaeology (`git show`/`git diff <tree-ish>`) — the
`_wt-mobile-app` worktree (dirty, active, 23-file WIP) was never touched or spawned.
Fork point: `b4995115` (merge-base of `feature/mobile-app` @ `939de5dc` and the IC line).

## Who changed what since the fork

| Side | Mobile-module changes | Character |
|---|---|---|
| IC line (our ancestors: Pilot+ → increment-2) | `mobile-inbox.controller.js` +38/-19 only | **hardened reply contract** |
| Mobile branch | `mobile-product.controller.js` (photo-draft/quick-update rework + `POST /products/images` upload), `mobile-order.controller.js` +82, `mobile-courier.controller.js` +38, `mobile.routes.js` +6 (idempotencyMiddleware on product mutations), e2e fixtures +333, `native-auth.service.js` +6 | new product/order/courier behaviour + tests |

## Contract-by-contract status on the IC candidate

| Contract (what mobile's app calls) | IC backend state | Compatibility |
|---|---|---|
| `POST /api/mobile/inbox/conversations/:id/reply` | hardened: `message_tag` honored only when `policy/rules/templateRequired.isAllowedMessageTag` passes; retired Meta tags (POST_PURCHASE_UPDATE etc.) now rejected; outside-24h needs valid tag or 422 `OUTSIDE_24H_WINDOW`; HUMAN_AGENT requires the permission flag + verified-event 7-day clock | **SUPERSET — request/response shapes unchanged; strictly safer semantics.** Mobile's current client (as present in the IC tree's own `EasyMod-mobile/`) uses no retired tags ⇒ green. Mobile branch MUST re-sync any newer client builds to send tags accordingly; a stale client sending a retired tag now gets an explicit 422 instead of a Meta 100 failure — improvement, not breakage |
| `GET /api/mobile/inbox/conversations(/:id)(/messages)`, `POST …/ai-mode` | unchanged since fork (only the reply path hardened) | compatible |
| `GET /api/mobile/attention`, `GET /api/mobile/today` | unchanged | compatible |
| `GET/POST /api/mobile/orders…`, confirm/cancel/manual/draft | IC line unchanged since fork; mobile branch has its own +82 | IC serves the fork contract; branch's additions are mobile-side contributions pending upstreaming |
| `POST /api/mobile/orders/:id/book-courier` | unchanged route + **NEW v6-port guard: a DRAFT order 409s `DRAFT_ORDER_NOT_BOOKABLE`** (and held drafts keep `ORDER_CONFIDENCE_HOLD`) | Mobile flow confirms before booking ⇒ compatible; any client offering book-on-draft now gets an explicit 409 — intended |
| `PATCH /api/mobile/products/:id/quick-update`, `POST /api/mobile/products/photo-draft` | **already present in IC routes** (L72-73) | compatible |
| `POST /api/mobile/products/images` | **absent in IC** (mobile branch only, `uploadProductImage` + idempotency middleware) | **DEFERRED to mobile owner** — IC client never calls it; when the branch lands upstream, IC gains it additively |

## Integration proof on real stack

The IC's own mobile integration suites (`mobile-inbox.controller.test.js` incl. the
+77 hardened-contract specs, `mobile-attention.integration`, `mobile-e2e-fixtures`,
`mobile-disabled`, native-auth lineage) all run green inside the 30/30 / 220-test
combined integration battery (doc 03). No mobile suite was modified to pass.

## Handoff asks (mobile owner, non-blocking)
1. Re-sync `/api/mobile/inbox` reply usage to the tag rules above (one test to add: retired tag → 422 body code).
2. Upstream `POST /products/images` (+ idempotency on product mutations) when ready; contract shape unchanged from their branch.
3. Re-run mobile E2E against the combined candidate before mobile release (its own battery, disposable ports).
