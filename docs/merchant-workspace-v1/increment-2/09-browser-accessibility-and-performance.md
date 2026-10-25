# 09 — Browser, Accessibility & Performance (Increment 2)

## Playwright — deterministic journeys (repo convention: route-mocked)

`tests/e2e/mwv1-journeys.spec.ts` — 10 journeys, run on **chromium AND firefox**:

| Journey | Asserts |
|---|---|
| J1 context panel | identity + operations; order association by `customer_id` (never name); deep link |
| J4 claim | staff claim → canonical PATCH `{hitl:true}`; owner chip updates; claim hidden when mine |
| J5 conflict+force | 409 shows the SERVER reason verbatim; privileged-only force re-sends `{hitl:true,force:true}` |
| J6 note | composer → create → refetch; never touches the send path |
| J7 tag | vocabulary picker → replace-set PUT `['tag-1']`; chip persists |
| J8 views | server-count chips; switching view refetches with the view id |
| J9 flag-off | panel usable + ZERO `/api/customer-intelligence/customers/` requests |
| J11 mobile 390px | context opens as a sheet; close button reachable; composer intact |
| J12 truth | order status verbatim; never a fabricated paid/delivered/refunded |
| A11y | axe on the panel: zero critical/serious |

```
npx playwright test mwv1-journeys --workers=1               → 10 passed (chromium)
npx playwright test mwv1-journeys --workers=1 --browser=firefox → 10 passed (firefox)
```

## Playwright — Pilot+ / increment-1 regression (same run)

```
npx playwright test pilot-plus --workers=1 → 10 passed
```
The 7 Pilot+ journeys + 3 increment-1 journeys stay green after the UnifiedInbox
mount/toggle, ownership-handler, and dead-audit-removal edits — no regression.

## Live founder walkthrough (real seeded stack)

`tests/e2e/mwv1-live.spec.ts` (guarded by `MWV1_LIVE=1`, excluded from CI) — 5/5
pass, screenshots in `walkthrough/`: shop A context panel on a handoff (ownership +
relationship + notes + tags), queue view chips with live server counts, Rima
order-history panel, shop B flag-off (zero gated reads), mobile 390px sheet.
The mutation flows are proven by integration + deterministic journeys; driving
mutations through Playwright's isolated `storageState` races the per-context CSRF
handshake (a harness artifact — the header takeover uses the identical
`apiClient.updateConversation`), so the live spec captures read-only states.

## Accessibility

- axe-core: zero critical/serious on the context panel (journey A11y) and the lead
  surfaces (pre-existing Pilot+ a11y journey still green).
- Panel sections are `aria-region`/labelled; ownership controls keyboard-reachable
  from the thread header; toggle exposes `aria-expanded`; view chips are a `tablist`
  with `aria-selected`; close button labelled.
- Long Bangla content wraps (`whitespace-pre-line` on notes, `font-bn` throughout);
  375/390px layouts keep the composer unoccluded (J11).

## Performance (live authenticated stack; `scripts/mwv1-perf.mjs`, 30 samples each)

| Read | median | min | max |
|---|---|---|---|
| `GET /api/conversation` list(50) | 40.4ms | 34.3 | 364.5 (cold first hit) |
| `GET /api/conversation?customer_id` | 40.5ms | 30.2 | 61.4 |
| `GET /api/order?customer_id` (context) | 24.7ms | 20.6 | 42.4 |
| `GET /api/inbox/actions?view=attention` | 45.1ms | 38.6 | 62.6 |
| `GET /api/inbox/actions?view=unassigned` | 44.0ms | 35.5 | 61.0 |
| `GET /api/customer/:id/notes` | 22.6ms | 19.0 | 29.6 |
| `GET /api/customer/:id/tags` | 23.4ms | 19.2 | 56.9 |

Findings (no invented targets — observed):
- The `customer_id` association filter adds **~0 measurable latency** vs the plain
  list (40.5 vs 40.4ms): the lookup is indexed and single-query, no N+1.
- Server-computed queue `counts` are free (attention 45.1 vs unassigned 44.0ms —
  within noise; both scan the same bounded set once).
- Notes/tags context reads are ~23ms; the panel issues them concurrently, so the
  added client waterfall is parallel, not serial.
- The 364ms max on the first list call is a cold-connection outlier (the median and
  min show the warm path is ~35-40ms through the dev proxy, which adds browser+proxy
  overhead over the ~22ms server figure recorded in Pilot+ doc 08).

No new N+1 or repeated-query regressions introduced; the batched assignee-name lookup
is one query per page (asserted in the D3 unit test).
