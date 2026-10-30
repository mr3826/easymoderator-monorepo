# EASYMODERATOR — PILOT+ V1 MASTER DECISION RECORD

**Milestone:** Pilot+ V1 (Merchant Momentum) · **Architecture:** MODULAR_MONOLITH (unchanged)
**Source baseline:** Product Engine V1.3 `f0f04e4ebc7af9771fdb433419d1f6340c5da156` (verified descendant of production `2a8c1e2d`)
**Branch:** `feat/pilotplus-v1-merchant-momentum` · **Worktree:** `D:\easymod\_wt-pilotplus-v1`
**Date:** 2026-10-24→25 · **Mode:** autonomous goal-based execution; zero production mutation; zero other-agent worktree/process touched.

## 1. One-paragraph decision

Pilot+ V1 turns customer conversations into verified commercial progress by reusing the existing
Sales Opportunities engine, conversation delivery truth, Action Gate, and knowledge authority — and
adding exactly one new mechanism (a server-side opaque interaction-proposal kernel) plus one read model
(risk-ranked action queue), one state addition (SUSPENDED checkout), one lifecycle module (knowledge-gap
suggestions), and one provider capability (quick replies). The loop is closed end-to-end: customer
intent → verified context → useful interaction → operational state → merchant action → truthful outcome
→ measurable result. All five capabilities are flag-gated off by default, channel-scoped, storefront-
compatible, and grounded in the P0 safety corrections (retired Meta tags, OCR-payment myth, dual
payment authority, committed-order status truth).

## 2. The five capabilities (see doc 02 for full inventories, doc 03 for contracts)

| ID | Delivered | Key evidence |
|---|---|---|
| P+01 Inbox Lead Intelligence | Existing opportunity engine surfaced in Inbox list/detail via one LEFT-JOIN projection; merchant acts through the SAME audited endpoints; one row = one truth everywhere | 07 §2; integration test 1 |
| P+02 Structured Customer Choices | `customer_interactions` kernel: registry-only options, opaque payloads, scope+expiry+version+single-use enforcement, quick replies ≤13/20/1000, text fallback, typed-equivalence execution, storefront adapter contract (unmounted) | 17 kernel + 12 worker + provider tests; integration concurrent-tap exactly-once |
| P+03 Merchant Action Queue | Request-time ranked read model (6 risk buckets) over authoritative rows; no task store; handoff claim/ownership conflicts (409), reason recorded on the conversation | 13 queue+ownership tests; Playwright journeys; live lab: 13 items buckets 1-6 |
| P+04 Context-Preserving Checkout | Interruption classes (terminal/pause/defer/belt); SUSPENDED status; questions answered by their own engines; deterministic resume hint; cancellation semantics preserved | 24 bridge + 11 belt + 2 worker tests; 15-step acceptance matrix §11 |
| P+05 Actionable Knowledge Gaps | Deterministic clustering (threshold+cursor), domain routing to authoritative config, merchant-authored answers published via existing FAQ authority, dismissal suppresses until NEW evidence, PII redaction at capture | 13 + 4 redaction tests; live lab: 3 suggestions incl. PAYMENT→settings |

## 3. Safety prerequisites (P0 reconciliation — all shipped as isolated commits)

P0-1 retired-tag shutdown + HOLD-not-tag (HUMAN_AGENT flag-gated behind real permission + 7-day
evidence clock); P0-2 OCR-payment path neutralized (it was dead code that would have re-litigated a
false claim; invariant test added); P0-3 enabled-payment single authority — mechanism corrected after
A/B perf evidence to WRITE-time enforcement (disable/delete clears settings.bd; AI hot path unchanged
latency; guard test); F3 committed conversational orders no longer silently renamed to 'draft'.
Stale `.easymod` tag guidance corrected. Full ledger + amendment log: doc 06.

## 4. What was explicitly rejected/deferred (scope discipline)

Rejected: second lead engine or AI scores (ADR-0006 upheld), persisted task tables (stale-truth class),
buttons/postbacks (extra subscription), LLM-authored options, auto-published answers, automated
outreach, microservices/event-bus/flow-builder, storefront implementation (contract only). Deferred:
CLARIFY trigger breadth beyond SAFE_FALLBACK, embedding clustering (only if deterministic quality bar
fails in-pilot), Utility-Message migration (needs App Review), merchant-configurable labels,
interaction retention job (90d cleanup — documented backlog), legacy coerced-'draft' row repair script
(needs explicit authorization).

## 5. Verification posture

Automated: units 4163/4169 (3 red = V1.3 tooling flakes proven baseline-worse, 06/A2), integration
29 suites/206 real-stack tests (both new migrations, concurrent tap exactly-once, gap cursors),
Meta-shaped E2E 48 (no live sends), security 802, FE 628 + tsc clean + vite build + Playwright
chromium/firefox 7/7 each (WebKit pre-existing harness limitation). Independent review + re-run by a
second agent: doc 09. Founder lab one command: doc 10. Release posture: **no push, no merge, no
deploy** — PRODUCTION_RELEASE_AUTHORIZED=NO.

## 6. Document map

01 baselines/skills · 02 inventory · 03 architecture/contracts (FROZEN) · 04 UX/journeys ·
05 security/Meta/authority · 06 implementation ledger + amendments · 07 test/runtime evidence ·
08 performance/pilot instruments · 09 independent verification · 10 founder handoff ·
pilot-plus-v1-proof.json (machine gates).
