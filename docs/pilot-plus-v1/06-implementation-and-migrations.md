# Pilot+ V1 — 06. Implementation and Migrations (running commit ledger)

Baseline `f0f04e4e`; branch `feat/pilotplus-v1-merchant-momentum`. Every entry = scoped commit,
tests-first per tdd-rules, focused suites recorded.

## Phase 2/1 docs
| SHA | Content |
|---|---|
| c6721377 | 01 baselines/skill provenance + phase-zero gate |
| 59092b25 | 02 current-state inventory + P0 verification + integration surface |
| f7c0b8d5 | 03 architecture/interaction contracts, 04 UX/journeys, 05 threat model + Fool log |

## Phase 3 — prerequisite safety commits (ALL DONE, tests-first)
| SHA | Change | RED->GREEN evidence (focused commands) |
|---|---|---|
| 6b9dcfbd | P0-1 retired-tag shutdown + HOLD outside window; HUMAN_AGENT flag-gated w/ 7-day evidence clock; provider wire defense; mobile tag validation | 16 RED (rules/provider/mobile) -> 523 GREEN: `npm test --workspace=easymod-backend -- src/modules/policy src/modules/channel-providers src/modules/mobile` + worker reply-mode/grounding/resume 70 GREEN |
| 6788813a | P0-2 OCR never claims payment confirmation; legacy screenshot step recovers to payment question; source invariant | 2 RED demonstrated (stash/replay) -> 364 GREEN: `… src/modules/order src/modules/payment src/modules/conversation/__tests__/order-flow.service.test.js` |
| 6f8e177b | P0-3 single enabled-payment authority (PaymentConfig ∩ settings.bd, fail-CLOSED); clearSelfMfs on disable/delete | 4+2 RED -> 21 GREEN + 649 regression (shop/payment/ai/security incl. pilot-intelligence boundary) |
| 128eb934 | F3 committed conversational orders keep live vocabulary status (no confirmed->draft coercion) | deterministic pre-fix failure; 8 new tests; 58 GREEN order service/validator/api |
| 3265cead | repo-hygiene: .easymod Meta tag guidance corrected to 2026 reality | docs only |

### Phase-3 proof checklist (master §6) status
1. V1.3 shop-scoped/evidence-grounded — REUSED UNCHANGED; grounding-boundary suites GREEN (included in 649). ✔
2. Order sole authority for session/order state — ✔ (F3; no new writers)
3. Identity/consent/opt-out authoritative — ✔ unchanged (consent rules; boundary tests)
4. Payment state never from screenshot OCR alone — ✔ (P0-2 + invariant source test)
5. Messages use enabled current merchant settings — ✔ (P0-3; grounding gate already enforced)
6. Every outbound passes policy — ✔ (interactive path will too — P+02 AC)
7. Committed action vs provider ack separate facts — ✔ existing (delivery_state; executed_mutation_without_outbound_send)
8. Failed send does not undo/duplicate committed order — ✔ existing message-worker.grounding/action-gate suites GREEN
9. Eligibility from verified event evidence — ✔ (P0-1: hold-not-tag; HUMAN_AGENT 7-day clock)

## Migrations plan (additive only; applied at first integration run)
| Migration | Tables/changes | Reversal |
|---|---|---|
| 20261025_001_pilotplus_interactions | customer_interactions + indexes | drop table |
| 20261025_002_pilotplus_session_status | order_sessions status CHECK extended (+SUSPENDED) | re-apply prior CHECK |
| 20261025_003_pilotplus_gap_suggestions | knowledge_gap_suggestions + unique live partial index | drop table |
| 20261025_004_pilotplus_flags | shop_pilot_features +3 BOOLEAN default false columns | drop columns |

No destructive migration; no data rewrites. F3-affected historical rows (conversational orders that
had been coerced to 'draft') are NOT auto-repaired — correction only on next legitimate touch by their
own flows; a one-off repair script is documented but NOT written or run (production mutation
unauthorized; local lab seeds are fresh anyway).

## Feature commits (append per increment)
| Phase | Workstream | SHA(s) |
|---|---|---|
| 4 | P+01 backend projection | 73cb406e |
| 4 | P+01 inbox UI (chip + strip via OpportunityCard reuse) | 6a5b9b20 |
| 7 | P+04 interruption classes (bridge v2, SUSPENDED status, belt, resume hint, meta session_id) | 1ac2b92c |
| 5 | P+02 interactions kernel + provider + worker wiring + flags + migration | b2a6c8f4 |
| 6 | P+03 action-queue read model + ownership conflicts + handoff reason (backend) | 24a7f565 |
| 8 | P+05 gap-suggestions pipeline + capture hygiene + daily job + API (backend) | a29a5701 |
| 9 | P+03 ActionQueuePanel FE (SSE conversation_updated wiring, i18n en/bn) | cab30997 |
| 9 | P+05 FaqSettings suggestions FE (i18n en/bn) | 1cbc90a4 |
| — | Pilot+ real-stack integration suite (10/10 real PG+Redis, both migrations) | in cab30997 (+f32a3c5a import fix) |
| — | P0-3 mechanism correction: write-time enforcement; AI hot path restored to baseline | 3421678b |

### AMENDMENT LOG (recorded, not hidden)
- **A1 (P0-3 hot path):** per-reply PaymentConfig read inside getOperatingContext was
  reverted after A/B evidence — it made V1.3 grounding timing suites flake on-branch, and
  the same two grounding-boundary tests also flake under parallel load at pristine
  f0f04e4e (V1.3's own proof already recorded Automated QA = FAIL). Both pass 52/52 with
  `--runInBand --testTimeout=30000` at baseline AND on this branch: load/ordering, not
  behavior. Final mechanism: enable/disable/delete self-mfs synchronizes shop.settings.bd
  (clearSelfMfs on disable/delete); AI reads the settings.bd block (single hot-path read,
  baseline latency); checkout gates on PaymentConfig.is_enabled; outbound grounding gate
  unchanged. Guard test asserts NO PaymentConfig access on the reply hot path.
- **A2:** full unit gate convention = `npx jest --coverage=false --runInBand
  --testTimeout=30000`; nothing quarantined or weakened.
- **A3:** grounding/privacy unit tests write run artifacts under
  docs/ai/product-experience-v1*/artifacts/ — generated, deliberately uncommitted
  (reproducible from proof commands).

### Corrections to earlier plans (recorded, not hidden)
- order_sessions.status is VARCHAR (no DB CHECK) -> the "20261025_002_pilotplus_session_status"
  migration is NOT needed; JS-side ENUM extension only (entity + inline model). No DB migration for P+04.
- Messages delivery_state has no INDETERMINATE value; reconciliation class uses FAILED +
  executed_mutation_without_outbound_send metadata + outbox NEEDS_RECONCILIATION (verified).
- Migrations shipped: 20261025_001 (customer_interactions + 3 flag columns), 20261025_002
  (knowledge_gap_suggestions). Both fully additive/reversible as planned.

### Evidence (unit) running totals
- P+01: 10 backend + 5 FE component tests; i18n coverage guard green.
- P+02: 17 kernel + 7 provider + 12 worker + pilot-features tests.
- P+03: 8 queue read-model + 5 ownership + controller-boundary updated.
- P+04: 24 bridge (classes incl. resume) + 11 steps-belt + 2 worker-hint + stage2.
- P+05: 13 grouping/lifecycle + 4 redaction matrix.
- Phase-3 P0 suites: see table above (523+364+21+8+... per commit).
