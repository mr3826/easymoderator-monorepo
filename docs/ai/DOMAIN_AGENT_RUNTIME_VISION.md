# EasyModerator Domain Agent Runtime Vision

Version: 1.0.0<br>
Last updated: 2026-08-22<br>
Owner: Architecture<br>
Supersedes: `EASYMODERATOR_DOMAIN_AGENT_RUNTIME_VISION.md` (pre-split source; absent from this checkout)<br>
Status: Normative

MUST / MUST NOT / REQUIRED are binding: violating one blocks merge. SHOULD / RECOMMENDED may be deviated from with a recorded ADR. MAY is optional. Any rule affecting authorization, tenant isolation, idempotency, or material mutation MUST be written as MUST.

## 1. Purpose And Classification

EasyModerator is a bounded transactional assistant for shop-scoped Facebook Messenger conversations. It is not a general-purpose autonomous planner. The runtime may classify intent, retrieve authoritative evidence, propose a bounded action, and execute a material mutation only through the Action Gate.

The current repository classification is **Level 4 - Transactional Agent**. The evidence and the Level 0-5 scale are defined in [the capability boundary audit](./AI_ASSISTANT_INTENT_CAPABILITY_BOUNDARY_AUDIT.md), §2. This document adopts that scale and does not redefine it. The Level-4 classification is based on the reachable order and courier mutation paths; no Level-5 planner, arbitrary model tool dispatcher, or autonomous workflow loop is approved.

The runtime has four enduring properties:

1. **Evidence before language.** Merchant-specific facts come from shop-owned data or are not sent.
2. **Proposal before authority.** An agent can return a `ProposedAction`; it cannot authorize itself.
3. **Gate before mutation.** Every material mutation receives a short-lived, typed authorization from the Action Gate.
4. **Recovery over silence.** Every indeterminate turn produces a deterministic customer-visible holding response or a human handoff.

## 2. Principles And Boundaries

### 2.1 Principles

- The tenant, customer, conversation, channel, and actor are explicit in every task.
- LLM output is a candidate response. It is never an authority, evidence source, capability grant, or mutation command.
- Deterministic code owns prices, stock, order state, payment state, delivery state, customer consent, and policy decisions.
- Read-only and mutating actions use separate contract variants and separate audit semantics.
- Every retry is safe only when its idempotency key is deterministic and its external uncertainty is reconciled.
- A bounded domain transition is safer than a chain of loosely coordinated agents.
- A failure in authorization, freshness, tenant resolution, idempotency, or policy fails closed.

### 2.2 Domain Model And Transition Matrix

The runtime recognizes five domains. Each domain has one owner and one action namespace.

| Domain | Responsibility | Permitted material actions |
|---|---|---|
| `PRODUCT` | Catalog search, product attributes, price, stock, media provenance | Read catalog; update only a pre-order cart through an authorized order action |
| `ORDER` | Checkout session, order summary, order creation, order-status read | Create an order only after a fresh customer confirmation and gate authorization |
| `KNOWLEDGE` | FAQ, merchant policy, delivery and payment information | Read merchant configuration and knowledge |
| `COMMERCE_OPS` | Payment verification and courier operations | Verify payment or book courier through separate action namespaces |
| `SUPPORT` | Human handoff, complaint, return, refund, existing-order change | Create a support case and stop automated domain routing |

`SUPPORT` is terminal for a turn. It may emit a handoff notification and a holding message, but it MUST NOT transition back into an automated domain during the same turn.

The following matrix is the complete legal transition set. A blank cell is a denial, not an implicit fallback.

| From \ To | `PRODUCT` | `ORDER` | `KNOWLEDGE` | `COMMERCE_OPS` | `SUPPORT` |
|---|---:|---:|---:|---:|---:|
| `PRODUCT` | Yes | Yes | Yes | No | Yes |
| `ORDER` | Yes | Yes | Yes | Yes | Yes |
| `KNOWLEDGE` | Yes | Yes | Yes | Yes | Yes |
| `COMMERCE_OPS` | No | Yes | Yes | Yes | Yes |
| `SUPPORT` | No | No | No | No | Terminal |

The orchestrator MUST enforce `MAX_DOMAIN_HOPS_PER_TURN = 2`. A hop is counted when control moves from one domain to another, including a transition caused by a follow-up candidate. Exceeding the limit is a routing defect: the turn MUST resolve `SAFE_FALLBACK`, emit an alert with the route, and not be treated as an ordinary customer fallback. Any transition not listed above MUST deny and route to `SUPPORT`.

Examples:

- `PRODUCT -> ORDER -> COMMERCE_OPS` is legal for a customer who selects a product and then provides payment or delivery details.
- `KNOWLEDGE -> COMMERCE_OPS` is legal when a static payment-policy answer becomes a live payment-status lookup.
- `PRODUCT -> COMMERCE_OPS` is denied because a product question cannot directly invoke a payment or courier operation.
- `SUPPORT -> ORDER` is denied because human resolution owns the turn.

### 2.3 Hard Boundaries

- The model MUST NOT choose a service by naming a backend class, route, capability, or provider.
- The model MUST NOT assert that a product, price, stock level, variant, policy, delivery charge, payment state, or order state exists without a matching `EvidenceRef`.
- The model MUST NOT receive provider credentials, cross-tenant records, or unredacted internal audit fields.
- The runtime MUST NOT treat a prior assistant message, vector similarity score, UI label, installed dependency, or stale document as authoritative evidence.
- Existing-order update, committed-order cancellation, return approval, refund approval, customer CRUD, merchant settings, product editing, courier management, broadcast, cold outreach, and arbitrary tool invocation are human-only unless a future contract explicitly adds them to the registry and gate.
- Facebook Messenger is the only customer channel in this launch boundary. Instagram, WhatsApp, Telegram, comments, comment-to-DM, cold DM, and broadcast are not capabilities of this runtime.
- A successful material mutation MUST have a corresponding action audit record and a customer-visible outbound result. An executed mutation with no outbound send is an incident.

### 2.4 Anti-Patterns

The following patterns block merge:

- A worker or agent imports an order, payment, or courier mutation service directly.
- A mutation service accepts an untyped boolean such as `approved`, `aiEnabled`, or `confirmed` instead of `ActionAuthorization`.
- A random UUID is used as a retry idempotency key for a material action.
- A model-provided `capability` or permission value is trusted.
- A price or stock change is ignored because the customer previously confirmed a different summary.
- A failed gate is converted into a silent drop, an empty response, or a successful mutation.
- A courier retry creates a new external booking without reconciling the prior attempt.
- An intent is deleted or its identifier is reused.
- A prompt example is placed in a source field that the grounding verifier treats as merchant evidence.

## 3. Runtime Shape

The normative pipeline is:

```text
Inbound Message
  -> Context Builder
  -> Evidence Retrieval
  -> Agent
  -> ProposedAction
  -> Action Gate
  -> mutation (when authorized)
  -> AgentResult
  -> Response Grounding Verifier
  -> Confidence
  -> Outbound Policy
  -> Provider Send
```

The `Agent` may be deterministic, model-backed, or a combination. The pipeline does not grant a model additional authority. `AgentResult` is a result envelope, not proof that an action ran.

The pre-agent and post-agent grounding stages are intentionally separate:

- **Evidence Retrieval** obtains typed, shop-scoped `EvidenceRef` records, stamps freshness, and supplies the same snapshot to the Agent and Action Gate.
- **Response Grounding Verifier** checks generated text against the evidence actually used by the turn and suppresses or replaces unsupported claims before Outbound Policy.

The Action Gate sits before every material mutation. Outbound Policy sits before every provider send, including deterministic holding messages and post-mutation communication.

## 4. Ownership And Authority

There is one owning document for each normative topic. A document may link to another owner but MUST NOT restate that owner's constants or contract shape in a competing form.

| Topic | Owning document |
|---|---|
| Runtime thesis, domains, transitions, boundaries, anti-patterns | `DOMAIN_AGENT_RUNTIME_VISION.md` |
| Runtime types, persisted versions, idempotency, evidence shapes | `AGENT_CONTRACTS.md` |
| Action Gate, authorization, mutation checks, outbound invariants, kill switches | `AGENT_ACTION_POLICY.md` |
| Intent names, slots, taxonomy lifecycle, routing rules | `AGENT_INTENT_REGISTRY.md` |
| Corpus, quality floors, evaluation, latency measurements | `BD_AI_EVALUATION.md` |
| Customer-visible states, retry, handoff, timeout, recovery | `CONVERSATION_RECOVERY_POLICY.md` |
| AI budget ceilings and launch cost constants | `../ai-cost/AGENT_BUDGET_CONSTANTS.md` |
| Phase ordering, readiness, shadow promotion, merchant surface, operations | `ROLLOUT_PLAN.md` |
| Coding-agent change gates | `../../CONTRIBUTING-AI.md` |

## 5. Operational Invariants

The following invariants are testable and are launch blockers:

| ID | Invariant |
|---|---|
| `INV-TENANT-1` | Every `EvidenceRef`, action, mutation input, policy decision, and provider send carries the current `shopId`; cross-tenant records are rejected. |
| `INV-AUTH-1` | A material mutation cannot reach its service without a valid, unexpired `ActionAuthorization` minted by the Action Gate. |
| `INV-AUTH-2` | The gate resolves capability from the registry using `(actionType, requestedByAgent)`; claimed permissions are not authoritative. |
| `INV-CONFIRM-1` | Order creation requires a confirmation over the canonical summary hash that matches a fresh live snapshot. |
| `INV-IDEMP-1` | Every action has a deterministic, required idempotency key. A key that cannot be derived makes the action unsafe to automate. |
| `INV-FAIL-1` | An authorization exception, timeout, or indeterminate result causes no mutation and produces `SAFE_FALLBACK` or `HUMAN_REQUIRED`. |
| `INV-SEND-1` | Once a material mutation executes, Outbound Policy may rewrite or downgrade the response but cannot suppress the fact that the mutation occurred. |
| `INV-ROUTE-1` | A turn cannot exceed two domain hops or traverse an unlisted matrix edge. |
| `INV-COST-1` | Per-turn and per-conversation budgets are enforced by the global budget authority, including Draft and recovery turns. |

## 6. Traceability Of Review Findings

All 36 findings from the architecture review have a disposition. `RESOLVED` means the requirement is specified in the owning document; implementation and evidence gates remain in the rollout sequence.

| Finding | Disposition | Resolving document | Section |
|---|---|---|---|
| B-1 | `RESOLVED` | `AGENT_ACTION_POLICY.md` | §3-§7 |
| B-2 | `RESOLVED` | `../ai-cost/AGENT_BUDGET_CONSTANTS.md` | §2-§5 |
| B-3 | `RESOLVED` | `AGENT_CONTRACTS.md` and `AGENT_ACTION_POLICY.md` | Contracts §6; Policy §2 |
| B-4 | `RESOLVED` | `AGENT_ACTION_POLICY.md` | §10 |
| H-1 | `RESOLVED` | `AGENT_CONTRACTS.md` | §4 |
| H-2 | `RESOLVED` | `AGENT_CONTRACTS.md` and `AGENT_ACTION_POLICY.md` | Contracts §4; Policy §4 |
| H-3 | `RESOLVED` | `AGENT_CONTRACTS.md` and `AGENT_ACTION_POLICY.md` | Contracts §9; Policy §8 |
| H-4 | `RESOLVED` | `DOMAIN_AGENT_RUNTIME_VISION.md` | §2.2 |
| H-5 | `RESOLVED` | `AGENT_ACTION_POLICY.md` | §9 |
| H-6 | `RESOLVED` | `AGENT_ACTION_POLICY.md` | §11 |
| H-7 | `RESOLVED` | `ROLLOUT_PLAN.md` | §4 |
| H-8 | `RESOLVED` | `ROLLOUT_PLAN.md` | §6 |
| H-9 | `RESOLVED` | `CONVERSATION_RECOVERY_POLICY.md` | §3 |
| H-10 | `RESOLVED` | `AGENT_CONTRACTS.md` | §3 |
| H-11 | `RESOLVED` | All normative documents | §1 headers and RFC declaration |
| M-1 | `RESOLVED` | `AGENT_INTENT_REGISTRY.md` | §3 |
| M-2 | `RESOLVED` | `AGENT_INTENT_REGISTRY.md` | §4 |
| M-3 | `RESOLVED` | `AGENT_INTENT_REGISTRY.md` | §6 |
| M-4 | `RESOLVED` | `BD_AI_EVALUATION.md` | §3 |
| M-5 | `RESOLVED` | `ROLLOUT_PLAN.md` | §8 |
| M-6 | `RESOLVED` | `BD_AI_EVALUATION.md` | §5 |
| M-7 | `RESOLVED` | `../ai-cost/AGENT_BUDGET_CONSTANTS.md` | §4 |
| M-8 | `RESOLVED` | `AGENT_CONTRACTS.md` and `CONVERSATION_RECOVERY_POLICY.md` | Contracts §7; Recovery §6 |
| M-9 | `RESOLVED` | `../ai-cost/AGENT_BUDGET_CONSTANTS.md` | §5 |
| M-10 | `RESOLVED` | `ROLLOUT_PLAN.md` | §9 |
| M-11 | `RESOLVED` | `ROLLOUT_PLAN.md` | §3 |
| M-12 | `RESOLVED` | `AGENT_CONTRACTS.md` | §6 |
| L-1 | `RESOLVED` | All normative documents | Header block |
| L-2 | `RESOLVED` | `DOMAIN_AGENT_RUNTIME_VISION.md` | §1 |
| L-3 | `RESOLVED` | `../../CONTRIBUTING-AI.md` | §2 |
| L-4 | `RESOLVED` | `DOMAIN_AGENT_RUNTIME_VISION.md` | §4 |
| L-5 | `RESOLVED` | `DOMAIN_AGENT_RUNTIME_VISION.md` | §2.1 |
| L-6 | `RESOLVED` | `../ai-cost/AGENT_BUDGET_CONSTANTS.md` | §4.3 |
| L-7 | `RESOLVED` | `AGENT_CONTRACTS.md` and `BD_AI_EVALUATION.md` | Contracts §9; Evaluation §4 |
| L-8 | `RESOLVED` | `CONVERSATION_RECOVERY_POLICY.md` | §5 |
| L-9 | `RESOLVED` | `ROLLOUT_PLAN.md` | §11 |

## 7. Phase A Consumption Rules

Phase A implementation MUST consume the documents in this order:

1. Freeze the types and version fields in `AGENT_CONTRACTS.md`.
2. Implement the Action Gate and its audit record before enabling any order or courier mutation.
3. Enforce the dependency rule and the message-worker integration invariant in CI.
4. Add the intent registry and evaluation corpus before changing routing.
5. Implement recovery and merchant readiness before enabling `AI_ACTIVE` for a new shop.
6. Enable order and courier actions only after the launch gates in `ROLLOUT_PLAN.md` pass.

No implementation may infer a missing rule from prompt prose. When these documents disagree, the authority table governs and the conflict blocks merge until resolved by an ADR.
