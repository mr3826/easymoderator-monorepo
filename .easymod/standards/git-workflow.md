# EasyModerator Git Workflow

## Core Rule
NEVER work directly on `main` or `master`. All work goes through feature/fix/refactor/test branches.

---

## Branch Naming

```
feature/{scope}-{short-description}
fix/{scope}-{issue}
refactor/{scope}-{improvement}
test/{scope}-{coverage}
hotfix/{critical-issue}
```

### Scope Values
```
backend | frontend | devops | ai | payments | delivery | meta | rag | subscriptions | jobs | db
```

### Examples
```
feature/backend-bkash-topup-api
feature/frontend-inbox-conversation-lock-indicator
feature/ai-intent-router-cache-warming
feature/meta-comment-keyword-rate-guard
fix/backend-bkash-webhook-signature-validation
fix/frontend-order-status-bn-translation
fix/ai-circuit-breaker-race-condition
refactor/backend-delivery-provider-registry
refactor/db-sequelize-shop-id-indexes
test/backend-bullmq-message-worker-guards
test/backend-bkash-payment-state-machine
hotfix/meta-rate-limit-guard-overflow
hotfix/bkash-token-cache-expiry-fix
```

---

## Commit Message Format

```
{type}({scope}): {short description — imperative, lowercase}

{optional body: why this change was made}
```

### Types
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — adding or fixing tests
- `docs` — documentation changes
- `chore` — dependency updates, config changes
- `perf` — performance improvements

### Examples
```
feat(payment): add BKash top-up pack purchase endpoint
fix(ai): prevent circuit breaker from opening under concurrent retry burst
refactor(delivery): extract ProviderRegistry from delivery.service.js
test(webhooks): add Meta webhook replay idempotency tests
chore(deps): upgrade bullmq to 5.x for group fair-queueing support
perf(db): add shop_id + status composite index to orders table
```

---

## Multi-Repo Rules

EasyModerator has two repos: **EasyMod-backend** and **EasyMod-frontend**.

When a feature requires changes to both:

1. Create synchronized branches with the **same name** in both repos
2. **Backend PR merged first** — API contract must exist before frontend uses it
3. Frontend PR description must reference the backend PR: `Depends on: EasyMod-backend#{PR number}`
4. If API contract changes, update `.easymod/standards/api-contract-rules.md` in the backend PR

---

## Pull Request Requirements

Every PR description must contain ALL of the following sections:

```markdown
## Purpose
{What problem does this PR solve? Which module(s)?}

## Architecture Impact
{DB schema changes? New queues/jobs? New services? API contract changes? — or N/A}

## Test Coverage
{What new tests were added? Coverage % for affected modules}

## Meta Policy Impact
{Does this affect FB/IG automation, webhooks, or rate limits? — or N/A (ran meta-policy-skill.md check)}

## Rollback Plan
{How to revert: feature flag / DB migration down / revert commit}

## Screenshots
{Required for any frontend/UI changes — include before/after}

## Risk Analysis
{What could go wrong? What's the blast radius if this fails?}

## Migration Notes
{Sequelize migration files included? Env var changes required? — or N/A}
```

---

## Protected Branches

| Branch | Rules |
|--------|-------|
| `main` | Requires PR + all CI checks passing |
| `develop` | Integration branch — PRs from feature branches |

CI must pass: `lint + unit tests + integration tests + coverage thresholds`

---

## Memory Update on Merge

After every merged PR, EM-Orchestrator MUST update:

- `.easymod/memory/execution-history.md` — append task summary
- `.easymod/memory/architecture-decisions.md` — if an ADR was made
- `.easymod/memory/failures.md` — if a rollback occurred or incident was resolved
- `.easymod/memory/meta-policy-risks.md` — if Meta policy risk was discovered or mitigated
