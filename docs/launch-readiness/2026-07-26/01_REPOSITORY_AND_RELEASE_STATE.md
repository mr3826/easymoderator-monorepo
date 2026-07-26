# 01 — Repository and Release State

## Captured state

| Item | Value | Receipt |
|---|---|---|
| Repository root | `D:/hexabyte/easy-moderator` | `git rev-parse --show-toplevel` |
| Branch | `codex/phase1-security-compliance` | `git rev-parse --abbrev-ref HEAD` |
| Commit | `d716ecfd1bf6847a8434f61fcc5a7bec5ef9bd0d` | `git rev-parse HEAD` |
| Upstream | `origin/codex/phase1-security-compliance` | `git rev-parse --abbrev-ref @{u}` |
| vs `origin/main` | 0 ahead, 1 behind (the merge commit) | `git rev-list --left-right --count origin/main...HEAD` → `1  0` |
| Merged into main? | **Yes** | `git merge-base --is-ancestor HEAD origin/main` → exit 0 |
| Dirty files | **0** | `git status --porcelain \| wc -l` → `0` |
| Stashes | none | `git stash list` (empty) |
| Worktrees | 1 (the primary) | `git worktree list` |
| Remote | `https://github.com/mr3826/easymod-backend.git` | `git remote -v` |
| Open PRs | none | `gh pr list --state open` (empty) |

**Status: PASS** — the tree is clean, so no test integrity is compromised by uncommitted work.

## Nested `.git` directories

```
./.git                  ← primary
./.kilo/glo/.git        ← vendored tooling
./claude-skills/.git    ← vendored tooling
```

Both nested repositories are unrelated tooling checkouts, consistent with the
`launch-freeze-2026-07-23` note that nested repos were backed up to
`.easymod/nested-git-backup/`. Neither is on a launch path. **NOT_APPLICABLE_WITH_JUSTIFICATION.**

## Release lineage

```
8394a44  Merge PR #74: Phase 1 launch-critical security and Meta compliance   ← origin/main
d716ecf  fix(ui): stop silent failure when marking a payment confirmation read
2225364  security: harden tenancy, auth revocation, and Meta deletion follow-ups
12556c7  security: close Phase 1 merge gates
```

PR #74 merged 2026-07-26T05:29:55Z: 10 commits, 84 files, +7390/−688.

## CI / CD state

| Run | Workflow | Branch | Result | Receipt |
|---|---|---|---|---|
| `30189330153` | CI / CD | `codex/phase1-security-compliance` (PR) | **success** 2m42s | `gh run list` |
| `30189476291` | CI / CD | `main` (`8394a44`) | **failure** 4m37s | `gh run list` |
| `30189139485` | Database Backup | `main` (schedule) | success 10s | `gh run list` |

### The failing run, precisely

Run `30189476291`:

- `Test & Build Gate` — pass
- `Build & Push Docker Images` — pass (1m28s, both images pushed to GHCR)
- `Deploy to DO Droplet` — **failed after 8s at its first step**, "Render and validate
  .env.prod without shell interpolation"
- `Copy .env.prod to droplet` — skipped
- `Deploy via SSH` — skipped

```
Error: Unsafe production configuration (missing: BKASH_APP_KEY, BKASH_APP_SECRET,
BKASH_BASE_URL, BKASH_PASSWORD, BKASH_USERNAME, BKASH_WEBHOOK_SECRET, CSRF_SECRET,
SENTRY_DSN|SLACK_ALERT_WEBHOOK_URL; invalid: PAYMENT_ENCRYPTION_KEY)
    at assertProductionConfig (.../production-config.validator.js:153:15)
    at Object.<anonymous> (.../scripts/render-production-env.js:105:1)
```

**The droplet was never contacted. Production runs the pre-merge image.**

This is the new fail-closed preflight working as designed — not a regression. But its
consequence is decisive for verdicts C and D: none of the Phase 1 hardening is live.

## Release integrity

### Lockfile / `npm ci` reproducibility — PASS

`package.json` last changed in `2225364`; `package-lock.json` last changed in the earlier
`5929f94`. That looks like drift, but the diff shows the **only** change to
`package.json` was the `test:security` script string — no dependency added, removed, or
re-ranged. `npm ci` (`ci-cd.yml:112,122`) validates dependency consistency only, and the
PR run passed. **No release-integrity defect.**

Receipt: `git show 2225364 -- package.json | grep '^[+-]'` → two lines, both the
`test:security` script.

### Backend dependency audit — BLOCKED

`npm audit --omit=dev` and `npm audit --package-lock-only --omit=dev` both fail locally:

```
npm WARN audit 400 Bad Request - POST .../security/audits/quick
{ statusCode: 400, error: 'Bad Request',
  message: 'Invalid package tree, run npm install to rebuild your package-lock.json' }
```

This is a local npm/registry tooling failure (the endpoint is being retired), not a
repository defect. **Backend production dependency vulnerabilities are unverified in
this audit.** See `10_TEST_BUILD_AND_CI_EVIDENCE.md`.

## Documents located (the audit brief's paths were partly stale)

The brief referenced `.easymod/meta-app-review/`. **That directory does not exist.**
The real locations:

| Brief reference | Actual path | State |
|---|---|---|
| `.easymod/meta-app-review/` | *(absent)* | — |
| Meta review materials | `docs/meta-app-review.md`, `docs/meta-app-review-submission.md`, `docs/META_APP_REVIEW_MASTER_GUIDE.md` | current (2026-06-27) |
| `CLEVEL_FINAL_AUDIT_2026-06-24.md` | `docs/launch/CLEVEL_FINAL_AUDIT_2026-06-24.md` | **superseded** |
| `FINAL_LAUNCH_READINESS_AUDIT_2026-06-24.md` | `docs/launch/FINAL_LAUNCH_READINESS_AUDIT_2026-06-24.md` | **superseded** |
| `LAUNCH_GATE_CHECKLIST.md` | `docs/launch/LAUNCH_GATE_CHECKLIST.md` | current but **gates 2 and 4 are unsound** (see `12_`) |
| Production truth | `docs/launch/PRODUCTION_TRUTH.md` | baseline `3f878e3` |
| Phase 1 controls | `docs/security/PHASE1_SECURITY_COMPLIANCE.md` | current |

Both 2026-06-24 audits predate the Instagram removal follow-ups and PR #74 and should be
treated as historical inputs only, per the brief.
