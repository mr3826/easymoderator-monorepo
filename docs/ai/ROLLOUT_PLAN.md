# Domain Agent Runtime Rollout Plan

Version: 1.0.0<br>
Last updated: 2026-08-22<br>
Owner: Engineering + Operations<br>
Supersedes: Rollout portions of `EASYMODERATOR_DOMAIN_AGENT_RUNTIME_VISION.md`<br>
Status: Normative; launch gate sequence

MUST / MUST NOT / REQUIRED are binding: violating one blocks merge. SHOULD / RECOMMENDED may be deviated from with a recorded ADR. MAY is optional. Any rule affecting authorization, tenant isolation, idempotency, or material mutation MUST be written as MUST.

This plan sequences implementation and launch evidence. The runtime architecture is owned by [the vision](./DOMAIN_AGENT_RUNTIME_VISION.md), contracts by [Agent Contracts](./AGENT_CONTRACTS.md), policy by [Agent Action Policy](./AGENT_ACTION_POLICY.md), and evaluation by [BD AI Evaluation](./BD_AI_EVALUATION.md).

## 1. Rollout Rules

- A phase cannot be marked complete without a signed evidence receipt.
- A failed hard gate stops the phase and disables the affected flag.
- A later phase cannot begin automatically after an earlier phase fails.
- Production mode names are `DRAFT`, `AI_ACTIVE`, `HUMAN_ACTIVE`, and `MANUAL`; behavior is defined here and in the Action Policy. `HUMAN_ACTIVE` MUST be non-delivering for automated customer sends.
- The live repository is currently Level 4 and Facebook Messenger-only. No rollout step expands channel or autonomy scope without a new contract and review.

## 2. Phase Map

| Phase | Scope | Exit evidence | Owner |
|---|---|---|---|
| 0. Documentation freeze | Adopt the split document set, authority table, RFC language, and traceability map | All 36 findings dispositioned; links resolve; no unfilled budget constants | Architecture |
| A. Runtime foundation | Contracts, versioning, Evidence Retrieval, Response Grounding Verifier, Action Gate, audit record | Contract suite green; dependency rule green; message-worker mutation traversal proves gate audit | Engineering + Security |
| B. Read-only shadow | Intent registry, tenant-bound reads, recovery states, corpus harness | Signed evaluation receipt; zero unsafe shadow actions; handoff and tenant tests green | Product + QA |
| C. Merchant readiness | Catalog, policy, payment, delivery, FAQ completeness scoring | Every pilot shop has readiness receipt and merchant checklist | Product |
| D. Customer reply active | Grounded read-only replies and deterministic handoff | Quality and latency floors met for 14 consecutive days | Operations |
| E. Order session active | Purchase start, cart, checkout, strict confirmation, price/stock revalidation | Order-session safety suite and merchant undo flow pass | Order Engineering |
| F. Courier shadow | Provider adapter, durable idempotency, reconciliation, no external booking | Shadow provider references reconcile with zero unsafe actions | CommerceOps Engineering |
| G. Order mutation active | AI order creation under Action Gate | Action Gate foundation hard gate plus zero-false-creation evidence | Order Engineering + Security |
| H. Courier booking active | AI courier booking with separate namespace and kill switch | Courier durable idempotency hard gate plus provider reconciliation receipt | CommerceOps Engineering |
| I. Sustained operations | Metrics, Meta-policy rechecks, corpus refresh, incident drills | Monthly operating review and no expired owner assignments | Operations |

Action Gate foundation and courier durable idempotency are hard gates for Phases G and H. Phase G MUST NOT activate order mutations because Phase E passed; it requires every Phase A, C, D, and E receipt.

## 3. Phase A Safety Defect Order

The first implementation sequence is:

1. Add contract versions and discriminated action types.
2. Add deterministic idempotency derivation and persistence.
3. Add Evidence Retrieval and snapshot hashing.
4. Add Action Gate authorization, 30-second expiry, failure semantics, and audit record.
5. Add Response Grounding Verifier after mutation/result and before confidence.
6. Add dependency-cruiser CI enforcement and worker traversal integration tests.
7. Add durable courier idempotency and reconciliation before any courier AI flag can be true.
8. Fix strict confirmation and summary revalidation before OrderAgent can reach `AI_ACTIVE`.

The existing audit's live defects, including mutation-before-outbound policy, broad `extractConfirmation()` matching, unbound order status, early dedup claims, and courier retry uncertainty, are Phase A implementation work. This document set specifies them; it does not claim they are fixed by documentation alone.

## 4. Merchant Readiness Gate

An unprepared shop starts in `DRAFT`. `AI_ACTIVE` requires a readiness receipt with all mandatory checks:

| Check | Launch threshold | Evidence |
|---|---:|---|
| Active products with price and stock | `>=95%` of active catalog rows | Live catalog scan |
| Product attribute coverage | `>=80%` for attributes used by the shop's corpus | Catalog coverage report |
| Inside-Dhaka delivery configuration | `100%` | Merchant settings snapshot |
| Outside-Dhaka delivery configuration | `100%` or explicit unavailable state | Merchant settings snapshot |
| Payment methods | At least one enabled method | Payment configuration snapshot |
| Return policy | One reviewed policy entry | FAQ/knowledge record |
| FAQ coverage | At least five reviewed entries or an explicit knowledge-gap plan | FAQ review receipt |

Below the bar, the merchant sees a completeness checklist with missing records and a Draft-mode explanation. Product owns the readiness score. Operations tracks the score, “I do not know” rate, conversion, and churn correlation weekly.

## 5. Shadow Promotion Gate

The read-only shadow runtime can classify and propose actions, but it cannot mutate or send a customer-facing generated response. Promotion to customer reply active requires:

- at least `95%` domain agreement;
- at least `90%` macro intent agreement;
- every active intent at or above the per-class floor;
- at least `2,000` turns across at least `10` shops;
- at least `500` Bangla, `750` Banglish, `350` English, and `400` mixed-language turns;
- zero unsafe shadow-proposed actions;
- 14 consecutive days meeting all thresholds;
- signed Product, QA, Security, and Operations receipts.

Promotion is rolled back when a threshold fails or when any hard safety incident occurs.

## 6. Merchant Surface And Undo

For every AI-created order or courier booking, the merchant sees an inbox event and dashboard activity row containing the customer conversation, action type, evidence references, gate decision, confirmation hash, provider reference, and outbound result.

The merchant surface MUST provide:

- one-click **Undo AI Order** while fulfillment is reversible;
- automatic stock restoration and courier-cancellation request using durable idempotency;
- an explicit result when a provider or fulfillment state prevents automatic undo;
- an audit-preserved “What AI said yesterday” view with date, shop, conversation, evidence, grounding decision, policy decision, and action references;
- a `HUMAN_REQUIRED` queue with reason, age, owner, acknowledgement, and SLA countdown.

Merchant acknowledgement target is 5 minutes. An unanswered handoff escalates to the configured owner at 15 minutes. Product owns surface copy; Operations owns the notification escalation; Engineering owns action consistency.

## 7. Customer Failure And Latency Gate

The state-to-customer map and hard 8-second timeout are owned by [Conversation Recovery Policy](./CONVERSATION_RECOVERY_POLICY.md). Phase D cannot launch until tests prove:

- a typing indicator or holding message starts within the state contract;
- a deterministic holding message sends by the hard timeout;
- every gate failure names the failed check and is not silent;
- `HUMAN_REQUIRED` creates a durable notification;
- recovery messages do not promise unsupported discounts, urgency, scarcity, or delivery times;
- a committed mutation always produces a post-mutation template or an incident alert.

## 8. Zero-False-Order Operational Gate

`false_order_creation_rate` is measured as confirmed order creations that the customer did not explicitly authorize or that differ from the fresh summary. The launch ceiling is zero.

| Metric | Alert | Owner | Action |
|---|---|---|---|
| False order creation | Any confirmed incident | Order Engineering + Security | Disable `AI_ORDER_MUTATIONS_ENABLED`, notify merchant, preserve audit, investigate |
| Order-create error rate | >2% over 15 minutes and 100 attempts | Order Engineering | Disable flag, inspect gate and database, replay only after review |
| Gate denial upstream-routing signal | >10% over 15 minutes and 100 attempts | Agent Engineering | Disable affected intent/action, inspect registry and evidence freshness |
| Executed mutation without send | Any occurrence | Operations | Page immediately; use merchant audit and deterministic recovery |

The merchant undo path is the operational counterpart to the zero metric. It is not a substitute for preventing false creation.

## 9. Shadow And Active Promotion Record

Each promotion receipt names:

```text
phase, release, contractVersion, registryVersion, corpusVersion,
shops, turns, durationDays, domainAgreement, intentAgreement,
perClassFloors, falsePurchaseStarts, falseOrderCreations,
handoffRecall, p50LatencyMs, p95LatencyMs, unsafeShadowActions,
killSwitchState, merchantReadiness, signedOwners, measuredAt
```

The Phase G receipt MUST include an order confirmation near-miss report and a price/stock revalidation report. The Phase H receipt MUST include provider duplicate and timeout reconciliation evidence.

## 10. Rollback And Incident Handling

- Disable the narrowest affected flag first.
- Keep read-only evidence, audit, reconciliation, and human handoff available.
- Do not delete action records, orders, provider references, or customer messages during rollback.
- Re-enable only after the owning team records root cause, test coverage, remediation, and a new signed phase receipt.
- A cross-tenant exposure disables `DOMAIN_AGENT_RUNTIME_ENABLED` immediately with no threshold.

## 11. Meta Policy Recheck

Platform Compliance owns the Meta messaging-window, tag, consent, and provider-policy recheck. It runs:

- at the Phase I checkpoint before sustained operations;
- monthly for the first 90 days after Phase D;
- quarterly thereafter;
- immediately after a Meta policy or provider API change.

Each recheck records policy version, channel behavior, template/tag evidence, consent behavior, owner, and expiry date. An expired recheck blocks new channel or outbound-policy changes.

## 12. Operating Review

Operations runs a weekly review through Phase H and a monthly review in Phase I. The review includes budget breaches, fallback rate, latency, grounding failures, handoff SLA, readiness and “I do not know” rate, false starts, false orders, courier duplicates, cross-tenant alerts, and unresolved owner assignments.
