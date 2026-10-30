# 00 — Baseline, evidence ledger, and blocker matrix (Pilot Authorization Closure V1)

Milestone: Pilot Authorization Closure V1. Base code `04b07134c265b04745d7c3add85154b66e82f132`; base evidence `4c36dffc7071e3baec217b5f7f6bbbcfaf4f1956` (direct child of `04b07134`, documentation-only, 11 files, verified by `git show --name-only` — no non-docs paths). This milestone adds evidence only; no product source changed.

## Phase 0 verification (2026-10-30)

| Check | Result | How to reproduce |
|---|---|---|
| Full SHAs | `04b07134c265b04745d7c3add85154b66e82f132`, `4c36dffc7071e3baec217b5f7f6bbbcfaf4f1956` | `git -C D:\easymod\_wt-operational-gate-closure-v1 rev-parse 04b07134 4c36dffc` |
| Direct ancestry | `4c36dffc^ = 04b07134` exact | `git rev-parse 4c36dffc^` |
| Documentation-only | all paths under `docs/` | `git show --name-only 4c36dffc` |
| Source tree identity | `04b07134^{tree} = db4d3f0c01b1e75482d0291dcd145f6bd5145e8c` | `git rev-parse 04b07134^{tree}` |
| Git object health | `fsck` reported only dangling objects; zero missing/corrupt/invalid lines | `git -C D:\easymod\easy-moderator fsck --no-progress` |
| Protected worktree untouched | `_wt-operational-gate-closure-v1` still at `4c36dffc`; preserved unstaged `native-auth-responses.json` fixture modification remains unstaged; untracked artifact dirs intact | `git -C ... status --short` |
| Isolated worktree for this milestone | `D:\easymod\_wt-pilot-authorization-closure-v1`, branch `ops/pilot-authorization-closure-v1`, created at `4c36dffc`, tracked tree clean | `git worktree list` |
| Candidate runtime identity | backend container `.Image = sha256:3367c27e1af0533be9043a299c84995a8b9eaa6bd94bde6fa792f8118239a1a6` (attested candidate image, created 2026-10-27T22:58+06); env `GIT_SHA=04b07134…`, `BUILD_TIME=2026-10-27T00:00:00Z`; `GET /api/version → gitSha=04b07134…, 66 migrations, latest 20261026_001_order_idempotency_unique` | `D:\easymod\_pilot-authorization-closure-v1-local\inspect-image-identity.sh` |
| Compose-label anomaly (informational) | `com.docker.compose.image` label on the long-lived container reads `sha256:ba25ad84…`, an intermediate build pruned from the store; the authoritative runtime fields (`.Image`, config env, `/api/version`) all agree on `3367c27e`/`04b07134`. Stale label, no security meaning. | same script |

## Durability after the 2026-10-27/28 WSL `/tmp` incident

- All attested closure receipts reside on NTFS: `D:\easymod\_operational-gate-closure-v1-independent-final\` (147 top-level files: 91 evidence receipts incl. the 995 KB PASS jest log `postgres-redis-integration-overlay-rerun-20261028t012248-11923.log`, plus harness scripts and the frozen source tars) and `D:\easymod\_operational-gate-closure-v1-local\evidence\` (browser/worker/backup receipts). Verified by directory listing 2026-10-30; independently re-counted by the adversarial verifier (F-2 correction applied here). The Trivy vulnerability DB cache (`trivy-cache/`) also lives under the first directory as a tool cache — distinct from receipt files, touched by scan runs, not evidence.
- Frozen tars (`frozen-source-04b07134.tar`, `full-source-04b07134-wsl-raw.tar`, `closure-backup.dump`) on NTFS; Trivy tooling and DB cache on NTFS (`tooling/trivy-0.76.1/`, `trivy-cache/`).
- This milestone's preview source mirror was moved to **durable ext4** (`/root/pilot-preview/raw`) instead of `/tmp` and was byte-verified against the attested manifest: **2,920/2,920 tracked files match, 0 missing, 0 mismatch** (`verify-preview-tree.sh`; baseline `exact-source-filehashes.tsv`, manifest SHA-256 `4799041f8bf827afc8b9196e06f133d85ccfab7700c4211fa8f517f6d99bcfc5`).
- A WSL keeper process (`bgp_18e098175001ktb6uzcjv8RG8U`) pins the distro VM for the session; a repeat idle-restart no longer destroys any attested artifact. QA caches, source mirrors and Product Experience artifact dirs were not deleted.
- Docker images/volumes/containers survived the intervening VM restarts (inspected 2026-10-30): candidate backend `3367c27e`, attested frontend `7f29dd67fc9c…`, browser runner `easymod-closure-browser-runner:04b07134`, pinned postgres/redis/qdrant/playwright digests, all five closure volumes.

## Standards register (loaded, not assumed)

`AGENTS.md` (repo), `CONTRIBUTING-AI.md` (repo, normative MUST/MUST-NOT contract incl. the human-gate list mirrored in this mission's stop rules), `karpathy-guidelines`, `devops-engineer`, `security-reviewer`, `test-master`, `code-reviewer`, `spec-miner` (Jeffallan equivalents all available and loaded). Workflow applied per change: read evidence → reproduce gap → compare alternatives → minimum intervention → verify → independent review → immutable receipt.

## Blocker matrix (single current view)

| BLOCKER_ID | REPORTED_STATUS | LATEST_VERIFIED_EVIDENCE | OWNER | AUTONOMOUSLY_RESOLVABLE | REQUIRED_ACCESS | SAFE_NEXT_ACTION | ACCEPTANCE_PROOF |
|---|---|---|---|---|---|---|---|
| B-1 Founder preview | BLOCKED (closure) | PASS this milestone: loopback HTTPS path live from Windows; auth + isolation + SPA green (`01-preview-access-proof.md`) | Founder (use it) | Yes (build); use = founder | none | Founder opens `https://127.0.0.1:54680` | Founder confirmation recorded in D-package |
| B-2 Deployed image digest / rollback | BLOCKED | On-droplet `/opt/easymod/deployment-metadata.json` is the only digest ledger; not locally reachable; PRODUCTION_TRUTH.md records commits + Growth digest only | Release owner | No | read-only droplet/SSH or ghcr admin | Owner reads metadata file + `docker inspect` digests | `DEPLOYED_IMAGE_VERIFIED` + prior-digest compatibility rehearsal |
| B-3 Human alert receipt | BLOCKED (production) | Local chain now CLOSED incl. destination receipt (`03-alert-delivery-and-operations.md`); production destination unnamed | Ops owner | No | alert channel + operator | Name channel/operator; run `sendTestAlert` against it | Operator ack on watched device |
| B-4 Effective production flags | UNKNOWN | Source/render defaults verified (`04-effective-production-config.md`); droplet env not readable | Ops owner | No | authorized env inspection | Owner redacted `docker compose exec backend printenv` capture | `EFFECTIVE_PRODUCTION_FLAGS` table signed |
| B-5 Full security scan | PARTIAL (closure) | CLOSED this milestone: vuln+secret+misconfig all completed; one MEDIUM `qs` finding disclosed (`05-trivy-security-disposition.md`) | Release owner (risk accept or patch bump) | Yes for scan; accept = owner | none | Ship `qs@6.16.1` lockfile bump increment or time-bound accept | Bumped-scan zero findings or signed exception |
| B-6 D-1..D-7 decisions | OPEN | Consolidated with new evidence (`06-owner-decisions-d1-d7.md`) | Founder | No | founder signature | One consolidated response per `08-founder-authorization-package.md` | Signed GO/NO-GO record |

Gate: `BASELINE_PROVENANCE=PASS`.
