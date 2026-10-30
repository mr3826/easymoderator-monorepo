# Pilot+ V1 — 01. Source Baselines and Skill Provenance

Date: 2026-10-24 (UTC). Execution: autonomous Pilot+ V1 goal.

## 1. Source baselines (verified, not historical)

| Item | Value | Verification |
|---|---|---|
| Product Engine V1.3 worktree | `D:\easymod\_wt-product-engine-v1-3` | `git worktree list` |
| V1.3 branch | `feature/product-engine-v1.3-customer-truth` | `git branch --show-current` |
| V1.3 starting SHA | `f0f04e4ebc7af9771fdb433419d1f6340c5da156` | `git rev-parse HEAD` (matches reported baseline exactly) |
| V1.3 worktree state | 3 dirty entries, all checkpoint docs (`docs/ai/product-experience-v1-3/checkpoints/*`) | `git status --porcelain`; no source dirt |
| Last reported production revision | `2a8c1e2d0bef0f3ddc8dd767901d1228865c302c` | present in object DB |
| Ancestry | `2a8c1e2d` IS an ancestor of `f0f04e4e` | `git merge-base --is-ancestor` exit 0 |
| Pilot+ implementation branch | `feat/pilotplus-v1-merchant-momentum` | created fresh (name verified unused beforehand) |
| Pilot+ worktree | `D:\easymod\_wt-pilotplus-v1` | `git worktree add ... f0f04e4e` (path verified non-existent before creation) |
| V1.3 checkpoint patch | touches ONLY the two checkpoint-doc files (diffstat reviewed) | NOT imported into Pilot+ (no runtime content; docs-only evidence) |

## 2. Phase-zero gate

```text
PRODUCT_TREE_VERIFIED=YES        # SHA match + ancestry + patch content-level review (docs-only)
ISOLATED_WORKTREE_VERIFIED=YES   # new branch + new dir from exact f0f04e4e; V1.3 worktree untouched
CONCURRENT_AGENT_INTERFERENCE=NO # Agent Manager list: 0 sections / 0 sessions; all WSL distros Stopped;
                                 # Docker daemon not running; no app/dev ports (3000/5432/6379/8080) listening.
                                 # Other agents' worktrees exist as static baselines only — never modified.
```

Protected worktrees not touched (owned by other workstreams): `_wt-product-engine-v1-3` (read-only), plus 20+ other
`_wt-*` worktrees listed by `git worktree list`; main checkout `D:\easymod\easy-moderator` sits on
`fix/meta-all-pages-granular-authorization` — untouched.

## 3. Runtime environment inventory

| Concern | Finding | Pilot+ choice (dedicated, isolated) |
|---|---|---|
| Node | System `node` is v25.6.1 (too new; repo `engines.node=20.x`) | Portable `D:\easymod\_local-runtimes\node-v20.20.2` (used by V1.3 workstream) |
| Docker/WSL | docker-desktop, Ubuntu, Debian, Ubuntu-24.04 all Stopped; no daemon | Start only under a Pilot+-owned name/namespace when integration tests run; never touch another agent's containers |
| Postgres/Redis | Not listening (5432/6379 free) | `docker-compose.test.yml` (in repo) defines the integration topology; dedicated DB + Redis namespace for Pilot+ |
| Ports | Listening 1024–9999: 1025,1253,1254,1256,1257,4096,5040,7732,7735,9222 (none are app ports) | Pilot+ app ports chosen disjoint: see 06/10 docs when provisioned |

## 4. Skills and binding contracts — provenance

Loaded/consulted before planning or application code:

| Skill / contract | Source path | Status | Use |
|---|---|---|---|
| Karpathy Guidelines | `C:\Users\ahmee\.config\kilo\skills\karpathy-guidelines\SKILL.md` | LOADED 2026-10-24 | assumption checking, surgical scope, simplicity, evidence-based completion |
| Spec Miner (Jeffallan) | `C:\Users\ahmee\.config\kilo\skills\spec-miner\SKILL.md` | LOADED 2026-10-24 | Phase 1 current-state reconstruction (EARS, evidence-grounded) |
| Security Reviewer | `C:\Users\ahmee\.config\kilo\skills\security-reviewer\` | REQUIRED by CONTRIBUTING-AI.md §2 — load at Phase 3+ | authz, tenant isolation, PII, provider boundary |
| Test Master | `C:\Users\ahmee\.config\kilo\skills\test-master\` | REQUIRED by CONTRIBUTING-AI.md §2 — load at Phase 3+ | invariants, integration, failure-path coverage |
| Code Reviewer | `C:\Users\ahmee\.config\kilo\skills\code-reviewer\` | REQUIRED by CONTRIBUTING-AI.md §2 — load per diff review | final diff + regression risk |
| Architecture Designer | `C:\Users\ahmee\.config\kilo\skills\architecture-designer\` | load at Phase 2 | domain boundaries, minimal compatibility architecture |
| API Designer | `C:\Users\ahmee\.config\kilo\skills\api-designer\` | load at Phase 2 | interaction/event contracts |
| The Fool | `C:\Users\ahmee\.config\kilo\skills\the-fool\` | load at Phase 2 challenge pass | adversarial challenge of misleading customer outcomes / merchant toil |
| React/Node/PG/Playwright skills | installed under `~\.config\kilo\skills\` | load only if directly required | implementation support |
| Repository contract `CONTRIBUTING-AI.md` | repo root (v1.0.0, Normative) | READ | 4 gates: contract, authorization (Action Gate), evidence+tenant, verification |
| Repo standards | `.easymod/standards/{meta-safe-rules,tdd-rules,api-contract-rules}.md` | READ | Meta policy, TDD order, envelope/shop-scoping contracts |
| Repo guidance | `.easymod/skills/meta-policy-skill.md`, `.easymod/memory/meta-policy-risks.md`, `.easymod/memory/failures.md` | READ during Phase 1 (agents) | P0 context |

External skills never override repository contracts, Meta policy, or release restrictions (per master directive §2.1).

## 5. Review board persona assignment

Lead Orchestrator = this session (goal root). BazarLens, FieldFounder, MomentumUX, FlowGuard, CTO/Domain Architect,
AI Product Engineer, Customer Intelligence Engineer, Order/Workflow Engineer, Meta Platform Specialist,
QA/Reliability Architect, Independent Verifier = adversarial review passes executed as delegated independent-agent
reviews and documented dissent in decision records (`docs/pilot-plus-v1/` decision section). Dissent is recorded,
not forced into consensus.

## 6. Deliverable structure

Authoritative evidence root: `docs/pilot-plus-v1/` (this directory), per master directive §18.
