# Pilot+ V1 — 07. Test and Runtime Evidence

All runs on Windows host, portable Node v20.20.2 (`D:\easymod\_local-runtimes\node-v20.20.2`),
disposable Docker stacks on loopback (postgres:16-alpine, redis:7-alpine; unique project names;
torn down after each run). Logs preserved under `D:\easymod\_tmp\pilotplus-*.log`. No live Meta
calls anywhere; no paid provider campaigns; fake transports only.

## 1. Gate summary (as of this document's commit)

| Gate | Command | Result |
|---|---|---|
| Backend units | `npx jest --coverage=false --testTimeout=30000` (EasyMod-backend) | 305/308 suites, 4163/4169 tests (3 red suites = V1.3 tooling flakes, baseline-worse; see 06/A2) |
| Backend units (deterministic recheck) | grounding-boundary `--runInBand --testTimeout=30000` | 52/52 |
| Real-stack integration | `npm run test:backend:integration:docker` | **29/29 suites, 206/206 tests** (incl. new pilotplus-v1.integration 10/10; both new migrations applied; clean teardown) |
| Meta-shaped E2E | `npm run test:backend:meta:e2e:docker` | **2/2 suites, 48/48 tests** (signed webhooks, fake Graph transport, receipts, dedupe) |
| Security suites | `npm run test:security` (runInBand) | **58/58 suites, 802/802 tests** (route perimeter incl. new /api/inbox + gap-suggestions; ai-mutation-boundary; pilot-intelligence-boundary; payment callback auth; tenant scope) |
| Test discovery/debt | `npm run test:discovery` | 341/341 tracked files homed; quarantine 2/2 unchanged (nothing hidden) |
| Frontend units | `npx vitest run` (EasyMod-frontend) | **75/75 files, 628/628 tests** (incl. i18n coverage guard) |
| Frontend typecheck | `npx tsc --noEmit` | 0 errors |
| Frontend production build | `npm run build` (vite) | success (pre-existing chunk-size warning only) |
| Playwright journeys | `npx playwright test pilot-plus` (chromium, mocked API per repo convention) | **7/7** (lead lifecycle, queue ranking/deadlines, takeover-conflict honesty, gap publish, 375px overflow, axe scan of Pilot+ surfaces) |
| Targeted integration recheck | fixed-port compose + `jest.integration.config.js pilotplus-v1.integration` | 10/10 (P+01..P+05 real DB semantics) |

## 2. Per-workstream acceptance mapping (§11 contracts -> where proven)

- **P+01** (AC §7.4): appear-once/qualify/negation/suppression/conversion/concurrency/flag-gating —
  pre-existing `customer-intelligence.integration.test.js` (real PG, unchanged engine) +
  `opportunity-signals.test.js` (25); Inbox≡Customer360 same-serializer proof —
  `opportunity-live-projection.test.js` + `conversation.inbox-opportunity.test.js` (7) +
  integration test 1 (contacted flow through API keeps one live row); expired-permission no
  follow-up — contactability advisory + recommended_action DO_NOT_CONTACT (existing suites) +
  strip renders server action verbatim (FE tests).
- **P+02** (AC §8.5): exactly-once under concurrent double delivery, replay no-op, forged/foreign
  shop/customer/page/conversation rejection, expiry, supersession, stale-summary refusal after
  repricing, DRAFT-mode mutation block, transport limits (13/20/1000) + invalid-entry drop,
  retired-tag-free wire, text fallback + numbered equivalence with capture-step collision guard —
  `interactions.service.test.js` (18), `MetaMessengerProvider.test.js` (+2), worker reply-mode
  (+6: tap/replay/draft/summary-attach/flag-off/numbered/forged), integration (concurrent
  Promise.all exactly-once on REAL Postgres conditional update).
- **P+03** (AC §9.5): one item per fact, removal on authoritative resolution, ranked buckets,
  grounded deadlines only, owner-as-state, cross-shop isolation, partial fail-closed, cap,
  webhook-idempotence (source rows are the deduped facts), SSE+reload convergence (FE refetch on
  hitl_changed/message_delivery_updated/delivery_failed/conversation_updated), takeover/resolution
  409 matrix incl. force/privileged, AI-resume-only-by-boundary (unchanged mechanism, tested by
  existing resume-boundary suites) — `inbox-actions.service.test.js` (8), conversation.service
  ownership (5), draft-send controller boundary (updated), integration tests 6-7, Playwright
  queue + conflict journeys.
- **P+04** (AC §10.4): question-during-checkout per class (informational/handoff/other-order/
  terminal/negated), no field capture (belt, 10 step tests), suspend preserves cart+fields on REAL
  rows, resume returns exact step, STOP still terminal from suspension, picker-step ownership
  preserved, worker resume-hint append (2), duplicate/out-of-order (existing dedupe + receipt
  layers, meta-e2e 48), worker restart durability (DB-only state; existing recovery suites),
  reprice→re-confirm (existing summary-hash + material revalidation + new interaction stale
  refusal) — `order-flow.service.test.js` (rewritten terminal semantics, 24), steps (73),
  reply-mode (15), integration test 9.
- **P+05** (AC §11.4): deterministic grouping ≥3, single suggestion per normalized question,
  dismiss cursor (no reappearance without NEW evidence ≥ threshold), reopen on new evidence,
  publish only via existing FAQ authority (is_active + RAG sync), unapproved never served
  (inactive FAQs excluded from prompts — existing knowledge.test), config-truth priority
  (authoritative_action routing + outbound grounding gate on payment claims — existing),
  multi-shop isolation (shop_id on every query + integration), PII never persisted (redaction
  matrix 4 + integration hygiene test), answerability hook (published_at/resolved_faq_id) —
  `gap-suggestions.service.test.js` (14), capture redaction (+4), integration tests 10-11.

## 3. Business-outcome invariants (§14) — executable witnesses

| Invariant | Test |
|---|---|
| Qualified interest ≠ completed order | opportunity status OPEN/ACTIONED until real order (integration, existing conversion tests) |
| Choice selected ≠ authorized mutation | resolveInteraction confirm with mutationsAllowed=false → mutation_blocked (unit + integration) |
| Order committed ≠ message delivered | delivery_state separate column + executed_mutation_without_outbound_send HELD template (message-worker.grounding) |
| Screenshot ≠ payment verified | P0-2 source-invariant test + no reachable OCR-confirmation path |
| Courier requested ≠ courier booked | courier-dispatch-idempotency + claim tests (existing, green) |
| Handoff requested ≠ assigned/resolved | owner null until claim; 409 matrix; resolved_at only via resolution (ownership tests) |
| FAQ suggestion ≠ approved/published | publish only via merchant endpoint → createFaq; unapproved never in prompt (knowledge.test) |
| AI response generated ≠ customer received | SENT only after provider ack; DRAFT_READY/HELD otherwise (delivery-state suites) |

## 4. Known inherited defects (recorded, NOT fixed here — outside authorized scope)

- grounding-boundary 2 tests are load-sensitive at baseline (06/A2); deterministic under stated convention.
- scripts/product-experience lab-tooling suites flake at baseline (7 fails pristine vs 4 on branch).
- V1.3 photo-gate category failures per its own proof doc (product-experience scope, not Pilot+).
- Pre-existing app-wide a11y: thread scroll container not focusable (ec382e31) — Playwright scan
  scoped to Pilot+ surfaces; the queue panel's own region WAS fixed (tabIndex+aria-label).
