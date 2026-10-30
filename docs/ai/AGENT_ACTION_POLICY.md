# Agent Action Policy

Version: 1.0.0<br>
Last updated: 2026-08-22<br>
Owner: Engineering + Security<br>
Supersedes: Action and outbound policy portions of `EASYMODERATOR_DOMAIN_AGENT_RUNTIME_VISION.md`<br>
Status: Normative; security launch gate

MUST / MUST NOT / REQUIRED are binding: violating one blocks merge. SHOULD / RECOMME&#78;DED may be deviated from with a recorded ADR. MAY is optional. Any rule affecting authorization, tenant isolation, idempotency, or material mutation MUST be written as MUST.

The Action Gate is the only authority that can authorize a material mutation. The Outbound Policy is the final authority for provider sends. Contract shapes are owned by [Agent Contracts](./AGENT_CONTRACTS.md); domain transitions are owned by [the vision](./DOMAIN_AGENT_RUNTIME_VISION.md).

## 1. Scope And Definitions

**Material mutation** changes an order, payment state, courier booking, stock, customer consent, support state, or another durable business record, or causes an external provider write.

**Action Gate** is a deterministic service that receives a `ProposedAction`, current tenant context, an evidence snapshot, and budget state. It resolves capability, evaluates all required checks, writes an audit decision, and mints an `ActionAuthorization` only on success.

**Response Grounding Verifier** is a deterministic post-agent service. It validates generated text and attachments against the `EvidenceRef` records used by the turn. It runs before confidence and Outbound Policy.

**Outbound Policy** evaluates consent, Meta window/tag, content, business hours, rate, automation mode, channel status, and post-mutation communication rules. It runs before every provider send.

## 2. Required Pipeline Order

The only approved customer-worker order is:

```text
Context Builder
  -> Evidence Retrieval
  -> Agent
  -> ProposedAction
  -> Action Gate
  -> mutation
  -> AgentResult
  -> Response Grounding Verifier
  -> Confidence
  -> Outbound Policy
  -> Provider Send
```

Evidence Retrieval is a pre-agent operation. It fetches typed, shop-scoped `EvidenceRef` records, stamps `retrievedAt` and `freshnessExpiresAt`, calculates an evidence snapshot hash, and places the snapshot in `AgentTask.context`. The Action Gate MUST validate the same snapshot, not re-authorize from untyped prompt text.

Response Grounding Verifier is a post-agent operation. It checks generated claims against the exact evidence references returned by the turn, rejects unsupported prices, URLs, product facts, delivery facts, payment facts, and media, and replaces or suppresses the candidate before Outbound Policy.

No agent, controller, queue worker, or mutation service may bypass this ordering.

## 3. Action Gate Enforcement

### 3.1 Authorization Token

Every mutation service MUST require an explicit authority context before opening a mutation transaction. Agent-initiated mutations MUST carry a valid `ActionAuthorization`; manual merchant actions MUST carry a server-constructed human context that the service revalidates against the active shop membership; system actions MUST carry a server-constructed context with a verified webhook signature and event identity. A missing, malformed, expired, tenant-mismatched, action-mismatched, idempotency-mismatched, evidence-mismatched, or unrecognized context MUST fail closed. Client request fields MUST NOT be accepted as authority.

The gate is the only minting boundary. The authorization token MUST contain:

| Field | Requirement |
|---|---|
| `actionId` | Stable identity of the proposed action |
| `actionType` | Exact registry action type |
| `shopId` | Current tenant |
| `actorAgent` | Agent identity resolved by the runtime |
| `taskId` | Originating task identity when present |
| `conversationId` | Bound conversation identity |
| `traceId` | Request trace identity |
| `idempotencyKey` | Deterministic action key |
| `evidenceSnapshotHash` | Snapshot used by the checks |
| `issuedAt` | Gate issuance time |
| `expiresAt` | `issuedAt + 30 seconds` |
| `gateDecisionId` | Durable audit decision |
| `signature` | Service-verifiable signature |

An authorization older than 30 seconds MUST fail closed. A token cannot be replayed into a later turn.

The gate decision audit MUST be followed by one idempotent result record linked by `gateDecisionId`. The result record contains sanitized mutation and outbound states/codes; it MUST NOT contain message bodies, payment evidence, credentials, or raw provider responses. A result record MUST only be appendable by a caller presenting the same gate-signed `ActionAuthorization` — shape validity alone is not sufficient (`recordActionGateOutcome` verifies the mint signature; only the 30-second TTL is relaxed at result time, so a mutation that commits just after expiry can still record its outcome).

Every mutating action type MUST map to one explicit runtime sub-flag in `config/ai-runtime-flags.js`. Read-only types ride `DOMAIN_AGENT_RUNTIME_ENABLED` alone. An action type with no mapping — including any type added later without wiring its flag — MUST be denied, never allowed by fall-through. The current map is `CREATE_ORDER` / `EDIT_PREORDER_CART` / `CANCEL_ORDER_SESSION` -> `AI_ORDER_MUTATIONS_ENABLED`, `BOOK_COURIER` -> `AI_COURIER_BOOKING_ENABLED`, `ACCEPT_PAYMENT` -> `AI_PAYMENT_ACCEPTANCE_ENABLED`, `CREATE_SUPPORT_CASE` -> `AI_SUPPORT_CASE_ENABLED`. `render-production-env` emits all four sub-flags with strict-literal defaults of `false`.

A committed mutation whose result audit fails MUST NOT be converted into a caller-facing failure: the order-creation path returns the committed order with a `result_unaudited` marker (the replayed confirmed turn re-records the outcome), mirroring the courier path's committed-but-unaudited handling. An original validation or tenant failure MUST never be masked behind a failed failure-outcome audit write.

### 3.2 Capability Resolution

The gate MUST resolve authoritative capability from the registry using `(actionType, requestedByAgent)`. An agent-provided capability claim is never trusted. A legacy `claimedCapability`, if present, is metadata only. A claimed/resolved mismatch is a logged security event and the action is denied.

### 3.3 Mutation Service Boundary

The dependency graph MUST enforce the agent portion of this rule in CI:

```text
from: modules/ai/**, jobs/message-worker.js, agent adapters/**
to:  mutation services under modules/order/**, modules/payment/**,
     modules/delivery/**, modules/customer/**, modules/consent/**
allowed only through: ActionGate.authorize() -> authorized mutation adapter
```

The dependency-cruiser rule MUST be a severity `error` rule. It MUST fail when any file under `modules/ai/**` imports a mutation service directly. The allowed adapter list MUST be explicit rather than a wildcard. A CI failure blocks merge.

Manual and signed-system actions MUST be independently tested at their authenticated route boundary and recorded with the human user or verified event identity. The implementation MUST add an integration test that starts from the message worker and traverses every reachable agent action path. The test MUST assert that any durable or external agent mutation has an `action_gate_audit` decision and a linked, idempotent result record with the same `gateDecisionId`, `actionId`, `idempotencyKey`, `shopId`, `taskId`, `conversationId`, and `traceId`. A path that mutates without both records fails the test.

## 4. Gate Check Set And Decision

The gate evaluates the following checks in order. Every check has a stable name in the audit record.

1. `contract_version_supported`
2. `tenant_context_complete`
3. `tenant_records_match`
4. `agent_identity_registered`
5. `capability_registry_allows`
6. `runtime_kill_switch_enabled`
7. `domain_transition_allowed`
8. `domain_hop_limit`
9. `action_schema_valid`
10. `idempotency_key_deterministic`
11. `idempotency_not_committed`
12. `evidence_snapshot_fresh`
13. `material_state_revalidated`
14. `customer_confirmation_valid` when required
15. `merchant_mode_allows_mutation`
16. `cost_budget_available`
17. `authorization_ttl_available`

The gate MUST write one decision row for every attempted mutation, including denials, exceptions, and timeouts. A denial names the first failing check and preserves the complete check outcome bitmap without customer text.

The gate MUST be deterministic. It MUST NOT call an LLM, accept a model confidence score as authorization, or infer missing policy from a prompt.

## 5. Failure Semantics

The entire Action Gate fails closed. On any exception, timeout, unavailable dependency, stale evidence, registry uncertainty, idempotency uncertainty, or indeterminate provider state:

- no local mutation is started unless a previously committed idempotent result is proven;
- no external write is attempted when the external state is unknown;
- the turn resolves `SAFE_FALLBACK` or `HUMAN_REQUIRED`;
- the denial or uncertainty is audited with the failing check name;
- the customer receives a deterministic holding message or safe explanation; silence is not an allowed result;
- the merchant receives a notification for `HUMAN_REQUIRED` and for every indeterminate material action.

`SAFE_FALLBACK` is a written, evidence-safe response. `HUMAN_REQUIRED` means no automated claim or mutation is made and a support owner is notified. The recovery state and customer timing are owned by [Conversation Recovery Policy](./CONVERSATION_RECOVERY_POLICY.md).

## 6. Latency Budget

The gate has a launch ceiling of `ACTION_GATE_P95_MS = 150`. The 17 checks are expected to use in-process validation and indexed reads. Any check that cannot meet the ceiling MUST be precomputed into `AgentTask.context` and validated by hash or version at gate time; it MUST NOT perform an unbounded network call inline.

The gate records per-check elapsed time and total duration. A p95 breach over 100 decisions in a 15-minute window pages the gate owner and blocks promotion of new action types. The end-to-end turn budgets are owned by [BD AI Evaluation](./BD_AI_EVALUATION.md) and the customer hard timeout by [Conversation Recovery Policy](./CONVERSATION_RECOVERY_POLICY.md).

## 7. Read-Only Actions

Read-only actions still require a tenant context, contract validation, evidence snapshot, deterministic idempotency key, and audit record. The shop and conversation must match the retrieved evidence for every read. `READ_ORDER_STATUS` and `READ_CUSTOMER_CONTEXT` additionally require the verified customer identity; shop-catalog `READ_PRODUCT` does not require a customer record because product facts are shop-scoped, not customer-scoped. A catalog read that cannot be audited MUST fail closed before its facts are used in a reply — except when the audited-read runtime itself is disabled: `DOMAIN_AGENT_RUNTIME_ENABLED=false` is the shipped production default, and the evaluator's `domain_agent_runtime_disabled` result is a policy state, not an integrity failure, so the legacy grounded reply continues while the runtime is off. Once the runtime is enabled, every non-disabled audit failure (unavailable audit store, stale evidence, tenant mismatch, contract invalid) MUST fail closed with the safe handoff. Read-only actions do not receive `ActionAuthorization` because they do not mutate, but they MUST NOT be used to smuggle a write through a read endpoint.

Order-status reads MUST bind to the requesting customer identity or return `HUMAN_REQUIRED`. A shop and guessed legacy order number are not sufficient authorization.

## 8. Order Confirmation And Freshness

Order creation requires `ConfirmationRecord.summaryHash` from the customer and a fresh live rebuild of the order summary. The gate MUST compare the canonical `confirmed_summary_hash` specified in [Agent Contracts](./AGENT_CONTRACTS.md), including product IDs, variants, quantities, unit prices, line totals, delivery charge, total, delivery method, payment method, customer name, phone, address, and currency.

Any delta in price fields or stock invalidates the confirmation. The action MUST be denied, the session MUST return to `AWAITING_CONFIRMATION`, and a new summary MUST be issued. The system MUST NOT create an order against either the old confirmed figures or the newly changed figures without a new customer confirmation.

The same revalidation rule applies when a retry resumes after a timeout. An old confirmation cannot authorize a new price or stock snapshot.

## 9. Post-Mutation Communication Invariant

Once a material mutation has committed, Outbound Policy MAY rewrite, localize, or downgrade the response, but it MUST NOT suppress the fact that the mutation occurred.

The deterministic post-mutation template MUST identify the executed result without generated claims:

- order creation: order number and current status;
- courier booking: booking or consignment reference when known;
- payment acceptance: transaction reference and verification status;
- support case: case reference and human-handoff status.

If grounding, confidence, or policy fails after a mutation, the template is sent instead of the candidate. If the template cannot be sent, the system MUST raise an alert named `executed_mutation_without_outbound_send`, persist the outbound failure, and notify the merchant. Logging alone is insufficient.

## 10. CommerceOps Boundary

Payment and courier remain bundled under the top-level `COMMERCE_OPS` domain for this release, but they are separate subdomains:

- namespaces are `payment.*` and `courier.*`;
- action types and gate check sets are separate;
- kill switches are separate;
- audit streams are separate;
- no shared mutable state is allowed between them;
- each provider has its own idempotency and reconciliation record.

The split trigger is the first of:

1. either subdomain receives merchant-configurable policy; or
2. self-MFS verification enters business `AUTO`.

At the trigger, the top-level domain is split into `PAYMENT_OPS` and `COURIER_OPS`, with separate ownership, rollout gates, and budgets.

## 11. Automatic Kill Switches

Each flag has rolling-window triggers, a named role owner, and a re-enable procedure. A trigger is evaluated by the telemetry service, not by a human remembering to inspect a dashboard.

| Flag | Trigger | Window and minimum sample | Owner | Re-enable condition |
|---|---|---|---|---|
| `AI_ORDER_MUTATIONS_ENABLED` | Any confirmed false/disputed order creation; order-create error rate >2%; or gate denial >10% with at least 100 attempts | 24h for false/disputed; 15m for rates | Order Engineering + Product | Incident reviewed, regression added, 100 shadow attempts clean, owner approval |
| `AI_COURIER_BOOKING_ENABLED` | Any duplicate booking; provider error rate >5%; or reconciliation backlog >0 for 10 minutes | 24h for duplicates; 15m for rates | CommerceOps Engineering | Provider reconciliation clean, duplicate prevention test passes, owner approval |
| `DOMAIN_AGENT_RUNTIME_ENABLED` | Any confirmed cross-tenant data exposure | Immediate; one occurrence | Security | Security incident closed, tenant test suite green, Security owner and incident commander approval |

Kill switches fail closed and are durable across worker restarts. Disabling a flag stops new actions while preserving reconciliation and customer support visibility.

Deployment note (IC-V1 review F10): with `AI_COURIER_BOOKING_ENABLED=false` — the rendered production default — a verified payment webhook confirms and invoices the order but does NOT auto-book the courier; the booking answers `{blocked, status: 'automation_disabled'}`, is logged, and dispatch proceeds manually. Enabling webhook auto-booking at rollout is a deliberate operator action, not an effect of this deploy.

## 12. Audit Record

Every gate attempt records:

```text
gateDecisionId, traceId, taskId, shopId, conversationId,
requestedByAgent, actionType, domain, idempotencyKey,
evidenceSnapshotHash, checkResults, decision, reasonCode,
issuedAt, expiresAt, mutationResult, outboundResult
```

The record MUST never include access tokens, provider credentials, full message bodies, or unnecessary customer PII. Hashes and stable identifiers are sufficient for replay and review.

## 13. Required Security And Integration Tests

- Direct imports of mutation services from `modules/ai/**` fail the dependency rule.
- A message-worker traversal cannot create an order, accept payment, or book courier without a gate audit row.
- Missing, expired, forged, tenant-mismatched, action-mismatched, or stale-evidence tokens are rejected.
- Gate exception and timeout cases produce no mutation and a deterministic holding message.
- Price and stock changes after customer confirmation return `AWAITING_CONFIRMATION`.
- One committed idempotency key returns the prior result and does not repeat the mutation.
- Provider timeout reconciliation never creates a second courier booking.
- A committed order with a failed candidate grounding check still sends the post-mutation template or raises the required alert.
- A cross-tenant evidence or order lookup is denied and pages Security for a confirmed exposure.
