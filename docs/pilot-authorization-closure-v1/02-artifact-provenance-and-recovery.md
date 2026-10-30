# 02 — Deployment artifact provenance and recovery authority (Gate B)

## Identity ladder — explicit distinctions

| Level | Verdict | Evidence |
|---|---|---|
| `SOURCE_VERIFIED` | **PASS** | `04b07134` = tree `db4d3f0c…`, 2,920 tracked blobs; manifest SHA-256 `4799041f8bf827afc8b9196e06f133d85ccfab7700c4211fa8f517f6d99bcfc5`; re-verified byte-for-byte 2026-10-30 (2,920/2,920) on the durable preview mirror (`00` ledger). |
| `LOCAL_IMAGE_VERIFIED` | **PASS** | Backend `sha256:3367c27e1af0533be9043a299c84995a8b9eaa6bd94bde6fa792f8118239a1a6` with baked `GIT_SHA=04b07134c265b04745d7c3add85154b66e82f132`, `BUILD_TIME=2026-10-27T00:00:00Z` (Dockerfile ARG→ENV), runtime self-report `/api/version gitSha=04b07134…`, 66 migrations; frontend candidate `sha256:7f29dd67fc9ceaafe9668bab2b1a2d7e868cd18e2aada33c7528c29f4023ffc3` (Trivy identity precheck re-passed 2026-10-30). Source→image provenance mechanism guard-pinned by `EasyMod-backend/src/security/__tests__/workflow-deploy-guard.test.js:393`. |
| `REGISTRY_IMAGE_VERIFIED` | **NOT APPLICABLE / NOT RUN** | No image was pushed: the candidate branch has never been pushed (`git ls-remote` for `ops/operational-gate-closure-v1` → empty; unchanged for this branch). CI pipeline *would* publish `ghcr.io/mr3826/easymoderator-{backend,frontend}:<full SHA>` with digest outputs (`.github/workflows/ci-cd.yml:831-928`). No registry access was exercised. |
| `DEPLOYED_IMAGE_VERIFIED` | **BLOCKED (owner-side)** | The only per-deploy digest ledger is `/opt/easymod/deployment-metadata.json` on the DigitalOcean droplet (written by `ci-cd.yml:1796-1809`, mode 0600). `docs/launch/PRODUCTION_TRUTH.md` records runtime **commits** (`e6bf0c7ea…`, 2026-09-26) and only the Growth digest `sha256:85a3ee22…`; **no backend/frontend RepoDigest of the running images is recorded anywhere in-repo.** Tags/local IDs must never stand in for digests — not inferred. |
| `ROLLBACK_COMPATIBILITY_VERIFIED` | **BLOCKED** | Cannot rehearse candidate-vs-deployed compatibility without the deployed immutable digest. Migration compatibility reasoning (below) is documented, not asserted. |

## Migration compatibility analysis (no execution against production-shaped data)

- Runner: `src/database/migrate.js` — ledger table `migrations`, per-migration transaction + `pg_advisory_xact_lock`, `down` exists but production policy is **forward-only** (`docs/deployment/MONOREPO_CUTOVER_RUNBOOK.md:73-74,119-120`); deploy applies `migrate.js up` from the candidate image **before** service replacement, then `schema-drift-audit.js` fail-closed (`ci-cd.yml:1567-1616`).
- Candidate adds migrations `20261007_001…`→`20261026_001` beyond the 09-26 production record; all are additive (unique-constraint/lineage/backfill columns per filenames and the attested 66/66 disposable apply). A prior image can continue serving a schema migrated forward **as long as no column rename/drop exists in the delta** — that audit is performed by `schema-drift-audit.js` at deploy and can be re-run read-only against a restore; it cannot substitute for the missing prior digest.
- Therefore: DB-rollback via `migrate:down` is forbidden policy; schema rollback = reviewed forward fix or point-in-time restore from the production backup chain (`backup.yml` isolated restore drill exists in CI).

## Prepared promotion procedure (documented; NOT executed)

1. Owner authorizes push of `ops/*` + merge path to `main` (protected by `PR Merge Gate` + `Security Scan` contexts).
2. CI builds & publishes `:<full SHA>` immutable images; captures `backend_digest`/`frontend_digest` outputs.
3. Manual `workflow_dispatch` deploy with `deploy_confirmation=DEPLOY-<full main SHA>` while `vars.PRODUCTION_DEPLOY_ENABLED=true` remains founder-controlled.
4. Deploy job: independent DB auth probe → capture previous container digests (fail-closed if incumbents not content-addressed) → assert all refs `@sha256:` → cutover-rollback snapshot `/opt/easymod/.cutover-rollback/<run_id>` (env+compose+Caddyfile+manifest.sha256) → migrate up → drift audit → staged start → `/health/ready` → `/api/version` gitSha equality → write `deployment-metadata.json`.
5. Exit-trap automatic rollback restores captured digests/env/compose/Caddy and re-verifies health (`ci-cd.yml:1375-1480`).

## Forward-recovery strategy (where rollback is unsafe)

Because the prior deployed digest is unestablished, the pilot's primary recovery path is **forward-fix**: flag-flip to `MANUAL` (instant, no deploy, proven in kill-switch rehearsal), then redeploy the *same* known-good immutable digest recorded in `deployment-metadata.json`, with data recovery via the attested backup/restore drill. Destructive DB reset paths in CI are refused in production (`ci-cd.yml:1169-1172`).

## Exact pending owner access

Read-only, in priority order: (1) `cat /opt/easymod/deployment-metadata.json` (or `docker inspect` `RepoDigests` of running backend/frontend/growth) on the droplet; (2) GHCR package history + retention policy for `easymoderator-backend/frontend` (whether the prior SHA tags still exist); (3) last successful `backup.yml` run id for RPO attestation. Owner may paste **only digests/timestamps** back — no env contents. Until (1) or (2) returns a digest, `ARTIFACT_AND_RECOVERY=PARTIAL` (local identity proven, deployed identity blocked) and no rollback proof may be claimed.
