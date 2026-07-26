# 09 — Deployment Receipt

**Status at time of writing: NOT YET DEPLOYED — prepared, pending the operator's go-ahead for the production merge.**

Merging this branch to `main` triggers the CI/CD deploy job, which is an irreversible, outward-facing production action (it replaces the running containers on the live droplet). All local gates are green (`08_`) and the preflight now passes with existing secrets plus the new `CSRF_SECRET`, so the deploy is expected to proceed past the step that previously failed. Because it is a live-production change, it is being surfaced for explicit confirmation rather than merged unilaterally.

## Pre-merge checklist (all satisfied)

- [x] All local backend/frontend tests green
- [x] Migration up/down/up verified on real PG15
- [x] Caddy / nginx / compose configs validate
- [x] Security self-review: no issues
- [x] `CSRF_SECRET` created; `SENTRY_DSN` fallback wired; bKash disabled; payment key normalized
- [x] No secret value printed or committed; no fake credential created

## Merge & monitor procedure (to execute on go-ahead)

```bash
# after the PR's required checks are green, no bypass:
gh pr merge <PR#> --squash --delete-branch=false     # repo's normal strategy
gh run list --branch main --limit 5
gh run watch <RUN_ID>
gh run view <RUN_ID>
```

Confirm, separately, that each deploy sub-step ran:
- Test & Build gate ✓
- Docker image build ✓
- **Environment preflight passed** (previously the failure point)
- `.env.prod` rendered & copied to droplet
- Migrations ran from the candidate image **before** service replacement
- Services replaced (`up -d`)
- In-container `/health/ready` health check ✓
- Rollback **not** triggered

## Release identity (to record post-deploy)

- Image tag / digest pushed to GHCR
- `GET https://easymod.tech/health/ready` → `commit` field equals the merge commit SHA
- `GET https://easymod.tech/health` → `service:"easymod-backend"`, `commit`, `builtAt`

*(This section will be completed with the actual run URL, merge commit, and image digest once the deploy executes.)*
