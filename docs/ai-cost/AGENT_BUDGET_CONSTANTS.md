# Agent Budget Constants

Version: 1.0.0<br>
Last updated: 2026-08-22<br>
Owner: Engineering + Finance<br>
Supersedes: Cost and budget portions of `EASYMODERATOR_DOMAIN_AGENT_RUNTIME_VISION.md`<br>
Status: Normative; launch commitments

MUST / MUST NOT / REQUIRED are binding: violating one blocks merge. SHOULD / RECOMMENDED may be deviated from with a recorded ADR. MAY is optional. Any rule affecting authorization, tenant isolation, idempotency, or material mutation MUST be written as MUST.

This document owns agent budget ceilings. The measured cost model remains authoritative in [`AI_COST_MODEL.json`](./AI_COST_MODEL.json), with assumptions and evidence in [`AI_COST_ASSUMPTIONS.md`](./AI_COST_ASSUMPTIONS.md) and the audit in [`AI_COST_AUDIT.md`](./AI_COST_AUDIT.md). This document does not replace those measured artefacts or restate their scenario tables.

## 1. Budget Authority

- These values are launch commitments. Breaching a ceiling blocks launch or disables the affected action.
- `AI_COST_MODEL.json` is the source for measured provider costs; this document contains enforcement ceilings only.
- All model calls, including Draft, shadow, fallback, sentiment, image extraction, OCR, and recovery turns, consume the global turn and conversation budget unless the call is explicitly classified as deterministic with zero provider usage.
- Per-agent `maxModelCallsPerTurn` values are sub-allocations. They cannot exceed the remaining global turn budget.
- A budget decision records the constant version, current usage, remaining usage, and trace ID.

## 2. Cost Ceilings

The ceiling formulas use the measured expected-conversation JSON pointer below. The multiple is part of the commitment and MUST be changed through an ADR.

| Constant | Value | Derivation or enforcement |
|---|---:|---|
| `MAX_COST_PER_CONVERSATION_USD` | `0.012286` | `2.0 x AI_COST_MODEL.json#/scenarios/conversations/B_expected/costPerBillableConversationUsd` |
| `MAX_COST_PER_ORDER_CREATED_USD` | `0.024572` | `4.0 x the same measured baseline; includes confirmation, fallback, recovery, and provider headroom for a high-impact action |
| `MAX_MODEL_CALLS_PER_TURN` | `2` | Authoritative global ceiling for every agent turn |
| `MAX_MODEL_CALLS_PER_24H_CONVERSATION` | `28` | `2.0 x the measured expected request count of 14; applies across all turns and providers |
| `MAX_MEDIA_ANALYSIS_CALLS_PER_TURN` | `1` | Image extraction or OCR consumes one of the two global turn slots |
| `MAX_DOMAIN_HOPS_PER_TURN` | `2` | Exceeding this is a routing defect and triggers safe fallback plus alert |
| `ACTION_AUTHORIZATION_TTL_SECONDS` | `30` | Authorization cannot be replayed into a later turn |

There is no unbounded image/OCR exemption. A future exception requires an ADR, is capped at one media call per turn, and remains inside the global two-call ceiling. A media call that cannot fit in the remaining budget is skipped and the turn resolves with deterministic copy or human handoff.

## 3. Latency Constants

| Constant | Value | Enforcement |
|---|---:|---|
| `P50_TURN_LATENCY_MS` | `1200` | Target from worker turn start to provider result, excluding burst debounce |
| `P95_TURN_LATENCY_MS` | `4000` | Launch ceiling from worker turn start to provider result, excluding burst debounce |
| `ACTION_GATE_P95_MS` | `150` | Gate ceiling across all 16 checks |
| `CUSTOMER_HARD_TIMEOUT_MS` | `8000` | Deterministic holding message is sent regardless of internal state |

The per-stage measurement table and trace field contract are owned by [`BD_AI_EVALUATION.md`](../ai/BD_AI_EVALUATION.md). A latency breach never authorizes skipping evidence, Action Gate, Response Grounding Verifier, or Outbound Policy.

## 4. Quality And Safety Constants

| Constant | Value | Enforcement |
|---|---:|---|
| `DOMAIN_ACCURACY_MIN` | `0.95` | Exact domain accuracy over the signed evaluation receipt |
| `INTENT_ACCURACY_MACRO_MIN` | `0.90` | Macro accuracy across active registry intents |
| `INTENT_ACCURACY_PER_CLASS_FLOOR` | `0.80` | Minimum for each active intent class |
| `FALSE_PURCHASE_START_MAX` | `0.005` | Maximum 0.5% false starts |
| `FALSE_ORDER_CREATION_MAX` | `0` | Any confirmed false creation disables order mutations |
| `HANDOFF_RECALL_MIN` | `0.95` | Minimum recall for human-required turns |

Confirmation parsing MUST include the Bangla near miss `হ্যাঁ না`, Banglish `na hoile`, one-character `y`, and negation-adjacent phrases. Passing aggregate intent accuracy cannot waive these safety assertions.

## 5. Draft And Shadow Accounting

| Constant | Value | Rule |
|---|---|---|
| `DRAFT_COUNTS_TOWARD_24H_CONVERSATION_BUDGET` | `true` | Draft performs reads and model calls, so it consumes the same model budget as active mode |
| `SHADOW_COUNTS_TOWARD_24H_CONVERSATION_BUDGET` | `true` | Shadow must not create a hidden cost path |
| `DETERMINISTIC_ZERO_CALL_PATH_COUNTS` | `false` | Greeting, order-step, lookup, and safe templates consume no model-call slot when no provider call occurs |
| `BUDGET_ALERT_PERCENT` | `80` | Alert at 80% of any per-turn or 24-hour ceiling |
| `BUDGET_BLOCK_PERCENT` | `100` | Deny new model calls at the ceiling and resolve safely |

The global `MAX_MODEL_CALLS_PER_TURN` is authoritative. An agent sub-allocation cannot reset, borrow, or exceed the remaining global value during a domain transition.

## 6. Commercial Assumptions

These values make the pricing boundary explicit. They are planning assumptions with named owners, not hidden inputs to the measured provider model.

| Assumption | Value | Evidence or owner | Launch treatment |
|---|---:|---|---|
| Assumed average order value | `BDT 1,500` | Finance planning assumption; no direct production evidence in this checkout | Used for action-risk review; validate before Phase H |
| GROWTH merchant plan price | `BDT 999/month` | [`AI_COST_AUDIT.md`](./AI_COST_AUDIT.md), §0 and §8 | Current planning price |
| AI share of gross margin ceiling | `35%` | Finance launch policy proposal | AI variable spend plus its allocated recovery overhead must remain below this share |
| Foreign-exchange source | `AI_COST_MODEL.json` `fx` object | Measured cost-model artefact | Provider billing remains USD; BDT is reporting only |
| Paid-tier economics | `100% paid-tier planning basis` | [`AI_COST_ASSUMPTIONS.md`](./AI_COST_ASSUMPTIONS.md), §2 | Promotional credits cannot satisfy a launch budget |

The assumed AOV does not authorize an order and does not replace the live order total. The merchant plan price and AI gross-margin share require Finance sign-off in the launch receipt; until then the ceilings above remain active and no higher ceiling may be used.

## 7. Budget Events

Every budget decision emits:

```text
budgetVersion, traceId, shopId, conversationId, turnId,
actionType, provider, modelCallsBefore, modelCallsAfter,
conversationCallsBefore, conversationCallsAfter,
estimatedCostUsd, ceilingUsd, decision, reasonCode, createdAt
```

Budget events MUST omit prompt bodies, generated response bodies, credentials, access tokens, and customer PII. A cost breach is an operational event and an action-policy denial, not a warning that can be ignored.

## 8. Launch Acceptance

- No constant in this document is unfilled.
- The measured baseline JSON pointer resolves to a numeric value in the checked-in model.
- A turn with two prior model calls cannot start a third provider call.
- A 24-hour conversation at 28 calls is denied additional provider calls with deterministic recovery.
- Draft and shadow usage appears in the same usage ledger as active usage.
- Order creation cannot use the conversation ceiling as permission to exceed the separate order ceiling.
- Budget breach and quality-floor breach both block the corresponding rollout phase.
