# EasyModerator Pilot Deployment Rehearsal V1 — Execution Plan

Date: 2026-10-27 (Asia/Dhaka)

## Goal

Produce a reproducible, isolated rehearsal and a founder-ready evidence package from the frozen EasyModerator candidate, while keeping production changes and commerce mutations unauthorized and off.

## Frozen baseline and initial evidence

- Source worktree: `D:\easymod\_wt-ic-merchant-workspace-v1`
- Code tip: `c164a0422046cd91313564817c00002e91d48463`
- Documentation tip: `d5dbd21620a0b25b6c57763c2214a95c811c2fbb`
- `c164a042` is an ancestor of `d5dbd216`. The one-commit delta changes only `docs/ic-merchant-workspace-v1/06-pilot-release-readiness.md` and `docs/ic-merchant-workspace-v1/ic-merchant-workspace-v1-proof.json`.
- The existing readiness document records an independent fresh-context GO at code tip `c164a042`, including the historical test counts and its known Firefox retry. This is historical evidence, not a substitute for the new rehearsal checks.
- Full Git object/connectivity check exited 0 with no integrity errors.
- The frozen checkout has no tracked modifications and 84 pre-existing untracked files under the two Product Experience artifact directories. Their contents are preserved; they are excluded from the rehearsal checkout.
- A separate branch, `rehearsal/pilot-deployment-v1`, was created at the documentation tip in `D:\easymod\_rehearsal-pilot-deployment-v1`. Its checkout was clean at creation.
- Existing Docker services and the Vite process were inventoried and left running. Existing listeners include Postgres/Redis ports `5432`, `6379`, `55432`, `56379`, and Vite `5173`; rehearsal ports must be separately allocated and bound to loopback.

## Execution gates

1. **Source and isolation** — re-check full SHAs, ancestry, clean rehearsal checkout, original-worktree artifact inventory, object integrity, and no branch push/merge.
2. **Deployment parity** — inspect the production Compose file, pinned base images, Dockerfiles, env renderer/validator, reverse proxy, migrations, worker, health checks, monitoring and rollback. Classify every difference as `EQUIVALENT`, `ACCEPTABLE_SIMULATION`, `NON_EQUIVALENT`, or `UNKNOWN`.
3. **Build and deployment** — build local immutable images from the frozen code tree; use a separate Compose project, named volumes/network, loopback-only ports, synthetic secrets and blocked provider egress. Start only the rehearsal project. Verify startup, migration sequencing, readiness, authentication, worker/queue health, synthetic webhook handling, audit/monitoring output, shutdown and restart.
4. **Commerce safety** — inspect rendered production defaults and exercise the existing deterministic matrix plus bounded synthetic API/webhook/worker cases for all three kill-switch levels, queued/retried work and flag revocation. Confirm no external side effects.
5. **Migration and recovery** — run `npm run test:backend:migration-dryrun` against its disposable production-shaped database and bounded local failure/restart scenarios. Record initial state, failure, recovery, observed state and invariant.
6. **Provider decision** — inventory actual integrations and contracts; inspect only exact `EM_GEMINI_KEY` and `EM_OPENAI_KEY` presence without reading values; verify current vendor terms, API contracts, pricing and data handling from official sources. No live inference unless an existing written budget and authorization are evidenced. Do not pass real keys into the isolated app without that gate.
7. **Owner package** — update D-1 through D-7 using current source evidence, alternatives, consequences and required owner authority. Preserve the existing OFF-by-default decisions.
8. **Freeze and independent attestation** — freeze the rehearsal branch, then have a fresh reviewer reproduce provenance, image/config digest, rendered flags, migration, recovery, kill-switch, monitoring, credentials/cost and relevant suite checks. Commit only after review dispositions and fresh verification.

## Constraints

- Do not modify the frozen source worktree or other worktrees; do not stop existing services.
- Do not push, merge, deploy to production, enable real-shop flags, send real messages, or perform real payment/courier actions.
- Do not inspect or print provider credential values. Do not include credentials or real customer data in artifacts.
- Use synthetic data only. Live provider calls stay `NOT_RUN` unless a pre-existing, explicit project budget and authorization are verified.
- Any source correction must be minimal, preceded by root-cause evidence, tested, and independently reviewed.
- Final claims require fresh commands and recorded exits, counts and skips.

## Skill register and applicability

Installed engineering skills read for this task:

| Skill | Loaded path | Applicability |
|---|---|---|
| Karpathy Guidelines | `C:\Users\ahmee\.codex\plugins\cache\karpathy-skills\andrej-karpathy-skills\1.0.0\skills\karpathy-guidelines\SKILL.md` | Minimal scope, explicit assumptions, surgical changes and verifiable completion. |
| Spec Miner | `C:\Users\ahmee\.codex\skills\spec-miner\SKILL.md` | Trace the frozen implementation and distinguish observed behavior from inference. |
| Architecture Designer | `C:\Users\ahmee\.codex\skills\architecture-designer\SKILL.md` | Preserve the modular-monolith boundary and document parity trade-offs. |
| API Designer | `C:\Users\ahmee\.codex\skills\api-designer\SKILL.md` | Inspect existing provider/API contracts; no API redesign is in scope. |
| DevOps Engineer | `C:\Users\ahmee\.codex\skills\devops-engineer\SKILL.md` | Rehearsal topology, immutable builds, startup, rollback and operations. |
| Monitoring Expert | `C:\Users\ahmee\.codex\skills\monitoring-expert\SKILL.md` | Health, audit, structured logs and actionable synthetic alert evidence. |
| Security Reviewer | `C:\Users\ahmee\.codex\skills\security-reviewer\SKILL.md` | Auth, tenant isolation, secret boundary and fail-closed checks. |
| Test Master | `C:\Users\ahmee\.codex\skills\test-master\SKILL.md` | Deterministic, integration, recovery and skip-inventory strategy. |
| Code Reviewer | `C:\Users\ahmee\.codex\skills\code-reviewer\SKILL.md` | Final diff and test review by an independent context. |
| Using Superpowers | `C:\Users\ahmee\.codex\plugins\cache\openai-curated-remote\superpowers\7.0.1\skills\using-superpowers\SKILL.md` | Skill discovery and priority. |
| Dispatching Parallel Agents | `C:\Users\ahmee\.codex\plugins\cache\openai-curated-remote\superpowers\7.0.1\skills\dispatching-parallel-agents\SKILL.md` | Independent SRE, FlowGuard and provider reviews. |
| Using Git Worktrees | `C:\Users\ahmee\.codex\plugins\cache\openai-curated-remote\superpowers\7.0.1\skills\using-git-worktrees\SKILL.md` | Isolated rehearsal checkout; native tool was unavailable at the non-Git workspace root, so the verified Git worktree fallback was used. |
| Systematic Debugging | `C:\Users\ahmee\.codex\plugins\cache\openai-curated-remote\superpowers\7.0.1\skills\systematic-debugging\SKILL.md` | Root-cause process for any reproduced failure before a correction. |
| Writing Plans | `C:\Users\ahmee\.codex\plugins\cache\openai-curated-remote\superpowers\7.0.1\skills\writing-plans\SKILL.md` | This gate plan; the mandate already supplies the execution method. |
| Verification Before Completion | `C:\Users\ahmee\.codex\plugins\cache\openai-curated-remote\superpowers\7.0.1\skills\verification-before-completion\SKILL.md` | Fresh verification before status claims or local commit. |

No project-local `SKILL.md` files were found in the frozen source or persona-context directory. The repository's `CONTRIBUTING-AI.md` and linked AI domain/policy/evaluation documents are the applicable EasyModerator-specific instructions. Root `AGENTS.md` is Growth OS-scoped and does not apply to the rehearsal; `EasyMod-mobile/AGENTS.md` is relevant only to the D-5 compatibility disposition, and no mobile changes are planned.

## Current status

Initial pre-execution snapshot only: planning and source pin reconciliation were recorded; the final results are in the Final execution status table below, which supersedes this snapshot.

## Final execution status (2026-10-27)

| Gate | Final state | Evidence/limitation |
|---|---|---|
| Source and isolation | PASS | Frozen full pins and ancestry verified; original tracked tree clean; 84 untracked artifacts preserved; rehearsal branch isolated |
| Deployment parity | PARTIAL | Production topology parsed; image digest and runtime equivalence unavailable |
| Build and host tests | PARTIAL/PASS | Backend security 58 suites/812 tests, focused interaction/worker 47/47, frontend 78 files/692 tests, frontend build, backend syntax check passed |
| Standalone frontend image dependency | PASS after correction | Child lockfile fixed and standalone npm ci dry-run resolved 450 packages |
| Compose rehearsal | BLOCKED | Docker snapshot I/O and read-only metadata store; no services started |
| Commerce safety | PARTIAL | Deterministic tests passed; no deployed queue, webhook replay, or runtime switch exercise |
| Migration and recovery | BLOCKED/NOT RUN | No Docker-backed migration or database/worker fault injection |
| Provider inventory | PASS source/docs | Existing adapters and official model lifecycle/pricing/privacy docs inspected; no account-level billing, key validity, or live calls |
| Founder decision package | READY | D-1 through D-7 consolidated with evidence, alternatives, consequences, and owner authority |
| Independent final attestation | NO_GO | Narrow independent code review completed; fresh final verifier unavailable because disk was full; runtime gates remain blocked |

The mandatory documentation package is in this directory. No production settings were changed, no real provider call occurred, no merchant data was used, and no push or merge was performed.
