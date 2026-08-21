# Contributing To AI Runtime

Version: 1.0.0<br>
Last updated: 2026-08-22<br>
Owner: Engineering<br>
Supersedes: AI contribution guidance in `EASYMODERATOR_DOMAIN_AGENT_RUNTIME_VISION.md`<br>
Status: Normative

MUST / MUST NOT / REQUIRED are binding: violating one blocks merge. SHOULD / RECOMMENDED may be deviated from with a recorded ADR. MAY is optional. Any rule affecting authorization, tenant isolation, idempotency, or material mutation MUST be written as MUST.

This is the coding-agent contract for changes that touch AI, routing, evidence, outbound messaging, orders, payments, courier, customer state, or model budgets. The authoritative documents are:

- [`docs/ai/DOMAIN_AGENT_RUNTIME_VISION.md`](docs/ai/DOMAIN_AGENT_RUNTIME_VISION.md)
- [`docs/ai/AGENT_CONTRACTS.md`](docs/ai/AGENT_CONTRACTS.md)
- [`docs/ai/AGENT_ACTION_POLICY.md`](docs/ai/AGENT_ACTION_POLICY.md)
- [`docs/ai/AGENT_INTENT_REGISTRY.md`](docs/ai/AGENT_INTENT_REGISTRY.md)
- [`docs/ai/BD_AI_EVALUATION.md`](docs/ai/BD_AI_EVALUATION.md)
- [`docs/ai/CONVERSATION_RECOVERY_POLICY.md`](docs/ai/CONVERSATION_RECOVERY_POLICY.md)
- [`docs/ai-cost/AGENT_BUDGET_CONSTANTS.md`](docs/ai-cost/AGENT_BUDGET_CONSTANTS.md)

## 1. Required Change Gates

1. **Contract gate:** use the current versioned types. Add a migration note for persisted shape or intent changes. Do not create an unregistered intent or random idempotency key.
2. **Authorization gate:** route every material mutation through the Action Gate. Do not import a mutation service directly from `modules/ai/**` or a worker.
3. **Evidence and tenant gate:** retrieve typed shop-scoped evidence, preserve the snapshot hash, and test cross-tenant denial. A prompt instruction is not an evidence or authorization control.
4. **Verification gate:** add or update deterministic tests for failure, retry, budget, recovery, and outbound behavior. Include Bangla/Banglish near misses when confirmation or intent rules change.

## 2. Quality Skills

Coding agents use only the skills that gate this work:

- `karpathy-guidelines` for minimal, surgical changes and explicit assumptions;
- `security-reviewer` for authorization, tenant isolation, PII, and provider-boundary changes;
- `test-master` for invariant, integration, regression, and failure-path coverage;
- `code-reviewer` for the final diff and regression-risk pass.

The skills support the repository documents; they do not override them.

## 3. Review Checklist

- [ ] The change names its owning document and authority section.
- [ ] The action or intent is registered, versioned, and observable.
- [ ] Tenant, customer, channel, trace, evidence, and idempotency fields are preserved.
- [ ] All mutation paths have Action Gate authorization and an audit record.
- [ ] Failure and timeout behavior is deterministic and customer-visible.
- [ ] A committed mutation cannot disappear behind Outbound Policy.
- [ ] Budget and latency counters are enforced, including Draft and recovery turns.
- [ ] Tests cover retries, stale evidence, price/stock changes, duplicates, and near-miss language where relevant.
- [ ] No credentials, access tokens, raw customer text, or unnecessary PII enter logs or prompts.
- [ ] Documentation links resolve and no competing constant or contract is introduced.
