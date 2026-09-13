# ADR-M-009: Mobile CI Runs Only in a New, Narrowly-Scoped Workflow

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

`CURRENT_STATE.md` §2: existing workflows already do not trigger on `feature/mobile-app` or
`mobile/**` (verified empirically, zero runs). The repo is private on GitHub Free with no
server-side branch protection, so the `production` deploy environment's "protected branches only"
rule currently admits any branch — a mobile workflow that touched secrets, an environment, or a
dispatch capability would be a real production risk, not a theoretical one. Gitleaks scans all
branches' full history, so a committed secret-shaped file on a mobile branch would fail Security
Scan for every future PR to `main`, including unrelated ones.

## Decision

Add exactly one new workflow, `.github/workflows/mobile-ci.yml`:

- Triggers: `push` to `[feature/mobile-app, 'mobile/**']`, `pull_request` targeting
  `feature/mobile-app` only. It never triggers on `main` and is never `workflow_dispatch`-able.
- `permissions: contents: read` at the workflow level — no write, no deployments, no packages.
- No `secrets.*` reference anywhere in the file, no `environment:` block, no SSH step, no registry
  push step, no `workflow_dispatch`. A guard script (`scripts/verify-mobile-ci-isolation.js`, run
  as this workflow's first job) parses `mobile-ci.yml` itself and fails the run if any of those
  ever appear — a structural check, not a promise.
- Jobs: gitleaks (same pinned action digest as the existing Security Scan, run against just the
  pushed ref's history) → mobile `tsc --noEmit` + ESLint + Jest/RNTL + `npm audit --workspace
  EasyMod-mobile`-equivalent for the standalone package → a root-lockfile-and-protected-paths diff
  check (fails if anything outside `EasyMod-mobile/`, `docs/mobile/`, or `mobile-ci.yml` itself
  changed, unless the PR is explicitly labeled as carrying a reviewed additive backend delta per
  the ledger) → conditionally, when the diff touches backend files, the existing backend unit +
  `test:security` + integration suites run on Node 20 exactly as they do today → an opt-in,
  label-gated (`mobile-e2e`) Android Gradle build + Maestro job, since emulator minutes are
  metered and should not run on every push.
- No existing workflow file is ever edited or dispatched by this program.

## Assumptions

- GitHub Actions minutes/emulator minutes for the opt-in Android/Maestro job are an acceptable
  ongoing cost once it starts running regularly — flagged to the user before Phase 1 turns it on
  by default for a phase, rather than assumed silently.
- The guard script itself is trustworthy only as long as it is reviewed with the same scrutiny as
  the workflow it checks — a compromised guard script is not a safety net. It is small,
  dependency-free, and reviewed in the same PR as any change to `mobile-ci.yml`.

## Alternatives Rejected

- **Extend `ci-cd.yml` with a mobile job, gated by an `if:` branch check.** Rejected: it puts
  mobile-authored CI logic inside a file this program is explicitly forbidden from modifying
  (`CURRENT_STATE.md` §15), and any future change to `ci-cd.yml` for unrelated reasons would now
  need to reason about mobile's `if:` conditions too.
- **Run mobile checks with `workflow_dispatch` so the orchestrator can trigger them on demand.**
  Rejected outright: this program never dispatches any workflow, including new ones — the brief's
  prohibition on triggering deployment-capable dispatch mechanisms is treated as covering "don't
  create a new one either," not just "don't touch the existing ones."

## Consequences

- Positive: a mobile-branch push cannot, by construction, reach a secret, an environment, or a
  deploy-capable action — verified structurally on every run, not just at authoring time.
- Positive: `gh run list --branch feature/mobile-app` showing only `mobile-ci` runs is a simple,
  repeatable isolation receipt for every phase gate.
- Negative: mobile CI cannot currently post a deployment preview or comment with a build artifact
  URL (no permissions for it) — acceptable; Phase 8's beta build path goes through EAS directly,
  not through this workflow.
