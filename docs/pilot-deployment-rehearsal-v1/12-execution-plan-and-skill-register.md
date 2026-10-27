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
- Initial host inventory reported existing Docker services and a Vite process, with listeners on Postgres/Redis ports `5432`, `6379`, `55432`, `56379`, and Vite `5173`; all were left running. The later read-only snapshot in `00-source-and-environment.md` found no listener on 5432, still found 5173 and 6379, and did not recheck 55432/56379. The service behind 6379 is unknown and was not contacted. Rehearsal ports are separately allocated and bound to loopback.

## Execution gates

1. **Source and isolation** — re-check full SHAs, ancestry, clean rehearsal checkout, original-worktree artifact inventory, object integrity, and no branch push/merge.
2. **Deployment parity** — inspect the production Compose file, pinned base images, Dockerfiles, env renderer/validator, reverse proxy, migrations, worker, health checks, monitoring and rollback. Classify every difference as `EQUIVALENT`, `ACCEPTABLE_SIMULATION`, `NON_EQUIVALENT`, or `UNKNOWN`.
3. **Build and deployment** — build local immutable images from the frozen code tree; use a separate Compose project, named volumes/network, loopback-only ports, synthetic secrets and blocked provider egress. Start only the rehearsal project. Verify startup, migration sequencing, readiness, authentication, worker/queue health, synthetic webhook handling, audit/monitoring output, shutdown and restart.
4. **Commerce safety** — inspect rendered production defaults and exercise the existing deterministic matrix plus bounded synthetic API/webhook/worker cases for all three kill-switch levels, queued/retried work and flag revocation. Confirm no external side effects.
5. **Migration and recovery** — run `npm run test:backend:migration-dryrun` against its disposable production-shaped database and bounded local failure/restart scenarios. Record initial state, failure, recovery, observed state and invariant.
6. **Provider decision** — inventory actual integrations and contracts; inspect only exact `EM_GEMINI_KEY` and `EM_OPENAI_KEY` presence without displaying values; verify current vendor terms, API contracts, pricing and data handling from official sources. The bootstrap preflight may transiently read those aliases in memory solely to compare them against the ignored rehearsal env file and prevent accidental injection. No live inference unless an existing written budget and authorization are evidenced. Do not pass real keys into the isolated app without that gate.
7. **Owner package** — update D-1 through D-7 using current source evidence, alternatives, consequences and required owner authority. Preserve the existing OFF-by-default decisions.
8. **Freeze and independent attestation** — freeze the rehearsal branch, then have a fresh reviewer reproduce provenance, image/config digest, rendered flags, migration, recovery, kill-switch, monitoring, credentials/cost and relevant suite checks. Commit only after review dispositions and fresh verification.

## Constraints

- Do not modify the frozen source worktree or other worktrees; do not stop existing services.
- Do not push, merge, deploy to production, enable real-shop flags, send real messages, or perform real payment/courier actions.
- Do not print, persist, or inject provider credential values. The bootstrap preflight may transiently read the two requested Windows aliases in memory only to confirm they are absent from the ignored rehearsal env file; no values enter WSL or artifacts. Do not include credentials or real customer data in artifacts.
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

| Gate | State | Evidence/limitation |
|---|---|---|
| Source and isolation | PASS for scoped source; worktree cleanliness NO | Code `6d6bc1dd056e09202b97d05e81f20308b15109ab` derives from the frozen pins. Dedicated WSL2 Docker runtime and Compose project used. Unrelated untracked QA/cache and Product Experience artifacts were preserved. |
| Deployment parity | PARTIAL | Eight-service isolated stack started; local app image IDs and secret-redacted Compose fingerprint recorded. Internal routes pass. Windows founder preview is blocked by absent host port mappings. All eight rehearsal containers were gracefully stopped after the final receipts; volumes and distro were preserved. |
| Build and unit tests | PARTIAL | Backend security 58 suites/813 passed; startup-boundary 4 passed; frontend 78 files/692 passed; frontend build passed. The frontend skip count was not retained. Full backend default suite did not complete. Backend image audit reported 3 high findings. |
| Standalone frontend lockfile | PASS | `axe-core` entries were synchronized in the child lockfile; standalone npm ci dry-run resolved 450 packages. This lockfile result is from commit `714be007`. |
| Runtime defaults and kill switches | PARTIAL / exercised cases PASS | Backend and worker mutation flags false. Fresh independent run confirmed global Action Gate denial, conversation pause, and per-shop MANUAL. MANUAL queued a synthetic in-app HITL notification; no customer message or external send. Photo-match false is a rehearsal override from production's true default. |
| Migration dry-run | PASS | Fresh independent six-phase disposable Postgres dry-run on exact code SHA `6d6bc1dd` exited 0: 240 generated orders plus 2 cross-shop idempotency fixtures (242 catalog total), duplicate refusal, repair/reapply, down/up. Partial failure and concurrency not run. |
| Failure recovery | PARTIAL with independent receipts | Worker-pending and graceful Redis canaries independently stayed waiting and then completed once; full graceful Compose stop/restart independently passed. Abrupt crash, database outage, backup restore, and business side-effect replay remain untested. Receipts are in the runtime evidence directory and referenced in 04. |
| Monitoring | PARTIAL | Live/readiness/SSE and internal proxy health passed, independently reconfirmed. Slack configured, Sentry absent; synthetic alert was not sent and no receipt exists. |
| Provider inventory | DOCUMENTED; runtime entitlement UNKNOWN | Existing OpenAI/Gemini adapters and official API, lifecycle, pricing, and privacy evidence reviewed. No provider call, billing check, model-override check, or spend-cap validation. Keep existing provider configuration. |
| Bangladesh merchant task quality | NOT ESTABLISHED | Existing synthetic contract tests do not establish exact-candidate merchant usefulness. Livestream coverage and image-to-SKU identity calibration remain gaps. |
| Merchant outage UX | NOT ESTABLISHED | No Inbox `llm_outage` listener; Bangla/Banglish price fallback can misroute under AUTO. Keep reply mode `MANUAL`. |
| Founder decision package | READY FOR OWNER REVIEW; all D-1 to D-7 remain open | Recommendations are consolidated in 05. No merchant selected or approved. |
| Independent final attestation | NO_GO for full milestone; bounded checks independently passed | Two independent contexts verified source, images/config, runtime flags, and health. The fresh operational verifier reran the six-phase migration, worker/Redis recovery, kill switches, health/sink inspection, and scoped shutdown/restart. Full backend default suite, authenticated/browser E2E, alert receipt, broader fault injection, preview, and owner decisions remain open. |

No production settings changed, no real provider request or customer data was used, no push/merge/deployment occurred, and no other agent worktree or process was stopped. Deployment and pilot authorization remain separate gates from the locally completed rehearsal evidence.
