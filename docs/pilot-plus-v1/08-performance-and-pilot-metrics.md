# Pilot+ V1 — 08. Performance and Pilot Measurement Plan

## 1. Measured performance (real Postgres 16 + Redis 7 in disposable Docker; Node 20.20.2; Windows host)

Fixtures: 2 shops × 200 customers × 200 conversations × 10 messages (4,000 messages/shop),
10 live opportunities, 10 sessions (5 SUSPENDED / 5 deferred-ACTIVE), 1,000 knowledge gaps,
4 reconciliation outbox rows, 8 FAILED-after-mutation AI messages. Script:
`EasyMod-backend/scripts/pilotplus-perf.js` (offline; no LLM; median of N; cleanup after run).
Raw log: `D:\easymod\_tmp\pilotplus-perf.log`.

| Measurement | Median | p95 | Notes |
|---|---|---|---|
| Inbox list, flag OFF (baseline) | 11.9 ms | 18.5 ms | 200 conversations, page 50 |
| Inbox list, flag ON (P+01 projection) | 17.9 ms | 80.6 ms | +6.0 ms median for the opportunity join; p95 includes cold first sample |
| Action queue aggregate (P+03) | 22.3 ms | 40.7 ms | 36 items across 5 buckets, request-time read model |
| Interaction create (P+02) | 7.4 ms | 16.3 ms | incl. supersede + insert in one tx |
| Interaction render quick replies | 2.4 ms | 5.4 ms | at send time only |
| Interaction resolve (tap) | 9.7 ms | 22.8 ms | scope checks + conditional claim + dispatch (delivery.info) |
| Per-inbound message metadata read (P+02 tap detection) | 1.67 ms | 2.54 ms | one indexed PK read added per inbound turn |
| stage2 classify ×5,000 (P+04) | 251 ms total | — | ≈50 µs/call — deterministic, zero model cost |
| isQuestionShaped ×5,000 (P+04 belt) | 2.7 ms total | — | ≈0.5 µs/call |
| Gap sweep, 1,000 gaps, first pass (P+05) | 247.8 ms | — | created 41 suggestions (daily job, per flagged shop) |
| Gap sweep, idempotent re-run | 97.7 ms | 98.7 ms | no duplicate writes |

EXPLAIN (ANALYZE, BUFFERS) — all hot new queries use indexes, sub-millisecond:
- P+01 projection: `idx_customer_opportunities_live` index scan, 10 rows, 0.10 ms exec.
- P+03 conversation scan: capped LIMIT 200 index-ordered scan.
- P+02 interaction lookup: PK index scan, 0.07 ms.
- P+05 live suggestions: `idx_gap_suggestions_live` partial index, 0.07 ms.

Verdicts vs §13.7: no synchronous LLM in lead qualification or choice validation (classify is
regex/BERT-local; interactions are pure DB); worker per-turn overhead ≈ one PK read (1.7 ms) +
rule classification (µs); queue/projection costs are request-time and bounded by caps.

## 2. Pilot measurement instruments (§16) — definitions only; NO invented ROI

All instruments read from existing authoritative rows (no new tracking surface). Pilot flags
default OFF, SUPER_ADMIN-controlled (ADR-0009 discipline); nothing enables automated outreach.

| Metric | Numerator / Denominator | Source of truth |
|---|---|---|
| Qualified-opportunity precision | opportunities ACTIONED+CONVERTED / opportunities created (window) | customer_opportunities |
| Time qualifying-event → merchant attention | actioned_at − detected_at (median, per shop) | customer_opportunities |
| Opportunity → real order conversion | CONVERTED with converted_order_id / resolved opportunities | customer_opportunities + orders |
| Unfinished-checkout recovery | sessions resumed after SUSPENDED/awaiting_resume → COMPLETED / suspended count | order_sessions step_data + status history |
| Choice acceptance | CONSUMED interactions / SENT interactions, per kind/option | customer_interactions |
| Choice rejection/expiry | EXPIRED+VOID / SENT | customer_interactions |
| Handoff acknowledgment | time hitl=true → assignee_id set | conversations (handoff_at metadata) |
| Handoff resolution | time assignee → resolved_at | conversations |
| Failed-send recovery | FAILED/HELD-after-mutation messages later SENT|DELIVERED / total flagged | messages + inbox_delivery_outbox |
| Knowledge-gap resolution | PUBLISHED suggestions / (PUBLISHED+DISMISSED); time open→published | knowledge_gap_suggestions |
| Post-publish answerability | gap rows for norm_question AFTER published_at vs before (rate change) | knowledge_gaps + suggestions cursor |
| Merchant actions per resolved issue | interaction+inbox mutations per CONVERTED opportunity / resolved handoff | audit_logs + above |
| Infra/inference cost per resolved conversation | LLM call counts + tokens (existing llm metrics) per resolved conv | ai metrics (existing instrumentation) |
| Delivered-order outcomes | orders delivered within observation window (where window permits) | orders.delivery_status |

Baseline procedure: 2-week pre-period per cohort shop with flags OFF (same instruments, same
queries), then enable per shop; compare within-shop, not across shops. Cohort + rollback
strategy required before any production enablement (separate authorization; §16/§17).
