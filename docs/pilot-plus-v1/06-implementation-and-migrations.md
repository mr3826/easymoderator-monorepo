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
| 4 | P+01 backend projection | pending |
| 4 | P+01 inbox UI | pending |
| 5 | P+02 interactions module | pending |
| 5 | P+02 provider quick_replies + resolver | pending |
| 6 | P+03 action aggregate + handoff claims | pending |
| 7 | P+04 interruption classes | pending |
| 8 | P+05 suggestions module | pending |
| 9 | FE polish (all) | pending |
