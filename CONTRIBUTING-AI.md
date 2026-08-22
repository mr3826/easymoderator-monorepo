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

## 3. Git And Merge Autonomy

Branch protection on `main` requires exactly two contexts, and both always report on every PR into `main`:

| Required context | Emitted by | Always reports |
| --- | --- | --- |
| `PR Merge Gate` | `.github/workflows/ci-cd.yml` job `pr-merge-gate` | Yes — no `if`, no paths filter |
| `Security Scan` | `.github/workflows/security-scan.yml` job `gate` | Yes — no `if`, no paths filter |

Component jobs (`Test & Build Gate`, `Growth OS build gate`, `Growth OS browser E2E gate`, integration, Docker validation) still run and still gate merge — through `PR Merge Gate`, which fails if any of them fails. They MUST NOT be named individually in branch protection: a job that legitimately does not run for a given diff would then block the PR forever on a context that never reports.

A coding agent MAY do all of the following autonomously, with no human approval:

- create a branch, implement, test, push;
- open a PR, update it, retarget a stacked PR once its base has merged;
- diagnose and repair a failing check;
- merge when the required contexts are green, and delete the merged branch.

A human gate is REQUIRED, and only for:

- production deployment approval;
- enabling production AI mutations (`PRODUCTION_DEPLOY_ENABLED`, production automation-mode activation);
- destructive production data operations;
- secret disclosure or rotation requiring human custody;
- any branch-protection bypass;
- a cross-tenant or security exception;
- an irreversible infrastructure action;
- an explicit architecture exception to the normative documents above.

No other human checkpoint is introduced. Ordinary Git and PR mechanics are not one.

## 4. Review Checklist

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
