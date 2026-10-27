# Independent Release Attestation — Operational Gate Closure V1

| Field | Value |
|---|---|
| Review date | 2026-10-28 |
| Base source SHA | `6d6bc1dd056e09202b97d05e81f20308b15109ab` |
| Rehearsal final SHA | `c190442e955465372173deea50f6baa580d8d20c` |
| Frozen candidate code SHA | `04b07134c265b04745d7c3add85154b66e82f132` |
| Branch | `ops/operational-gate-closure-v1` |
| Worktree | `D:\easymod\_wt-operational-gate-closure-v1` |

## Attestation result

**Technical pilot readiness: NO-GO.** The isolated candidate closes the source-default, dependency-lock, commerce-denial, integration, exact-image browser, worker-recovery, and backup-comparison evidence: every reviewer-side gate now has an independent green receipt at the frozen candidate (see gate matrix). The remaining blockers are owner/production dependencies — founder-accessible preview, prior deployed-image digest, production alert destination, live flag/provider/billing state, and the incomplete full Trivy secret/misconfiguration scan — plus the external release steps (push/merge/deploy) that were never authorized or performed.

The reviewer reconstructed the candidate from Git objects into a separate checkout and verified all 2,920 tracked blobs with no missing files or mismatches. The raw Git archive SHA-256 is `7ca2cb180bacf61d41a057ee071c6d2c8e385d8852cb90e15ac3176386f59f8b`; its manifest SHA-256 is `4799041f8bf827afc8b9196e06f133d85ccfab7700c4211fa8f517f6d99bcfc5`. The documentation-only commit must be a direct child of the frozen candidate. Its commit SHA is reported in the final handoff because it cannot be embedded in its own commit.

### Continuation disclosure (2026-10-27T18:20Z – 2026-10-28T02:00Z, reviewer-side environment incidents)

- A WSL VM restart wiped the reviewer's ext4 `/tmp` exact-source mirrors, container stack state, and installed dependency trees (the distro `/tmp` is not durable across restarts). Nothing in the candidate tree or its D:-persisted frozen tars changed.
- The exact-source mirror was rebuilt from `frozen-source-04b07134.tar` (dependency install copy) and a direct `git clone` + detached checkout of `04b07134` from the main repository, then byte-re-verified: tree `db4d3f0c…`, 2,920 tracked blobs, manifest SHA-256 `4799041f…` identical, and the regenerated per-file hash manifest `cmp`-identical to the pre-restart manifest. The staging mirror was rebuilt with the reviewer's own `prepare-integration-runner-stage.sh` and re-verified (`all_tracked_bytes_match=true`).
- Dependency-tree rebuild deviated narrowly from the original: `npm ci --ignore-scripts` (the frozen root/`prepare` husky hook spawn ELOOPs in the current distro environment; `prepare` was stripped only from the transient install copy, never from the attested checkout), then `sqlite3@6.0.1` and `@unrs/resolver-binding-linux-x64-gnu@1.11.1` installed `--no-save` and merged into the package-level tree, with `node-gyp rebuild` for the sqlite3 binding — matching the surviving original install receipts. The attested checkout's `git status --porcelain` was verified empty of tracked-file changes after install.
- Three external test-harness defects were fixed (all in the untracked evidence directory, never in candidate source; timestamped backups retained): (1) the overlay-rerun verifier compared the container `.Image` ID against the full pinned ref string, which could never match — it now compares against the locally resolved image ID, preserving exact-digest intent; (2) the runner's writable-tmpfs allowlist omitted `EasyMod-backend/uploads`, where the app creates `uploads/invoices` at require time — a third narrowly scoped tmpfs mount and its guard expectation were added; (3) `compare-backup-restored-order.sh` died under `set -e` on an informational grep for a nonexistent env key — made tolerant. The stage-preparation script now also pre-creates the `uploads/invoices` mountpoint.
- The synthetic browser journey is state-consumptive. Last night's chromium `403` (vs expected `404`) on the cross-tenant order mutation occurred in fixture state already consumed by an earlier deep run; after a full drop/recreate/migrate/reseed of the name-guarded synthetic `easymod_ops_gate_e2e` database, chromium passed 20.1s and firefox passed 35.4s on the exact images. No authorization regression exists at fresh state.
- Honest receipt-loss note: two re-run `tee` operations overwritten earlier same-named receipts (`browser-e2e-seed-final.json`, `playwright-chromium-final.log`) before the green repro was produced. The present receipts are the independent post-reset green reproductions; the superseded originals are not recoverable. All other pre-restart receipts remain in the external evidence directory.
- Paid inference calls remained 0; no production system was contacted; nothing was pushed, merged, or deployed.

## Gate matrix

| Gate | Status | Evidence and boundary |
|---|---|---|
| Photo-matching default | **PASS — candidate source/render default OFF** | Candidate source and production renderer use `AI_PHOTO_MATCH_ENABLED=false`; the exact-source flag matrix passed 5 suites / 32 tests. Actual production process values were not inspected. |
| Production-default flag matrix | **PASS — isolated candidate only** | Exact-source targeted matrix passed 5 suites / 32 tests. Safe runtime inspection showed the 12 AI, domain-agent, commerce, courier, payment, support, mobile, growth, Telegram, bKash, and Meta-profile flags false. Live production values remain **UNKNOWN**. |
| Commerce mutation denial | **PASS — isolated candidate** | Included in the exact-source 5-suite / 32-test flag and denial matrix. No production mutation was attempted. |
| Authenticated tenant journey | **PASS — independent exact-image rerun at fresh state** | Exact-image runner (`easymod-closure-browser-runner:04b07134`, attested archive SHA, no published ports, internal network only) passed the Shop A/Shop B journey on chromium (20.1s) and firefox (35.4s) against the freshly reset/migrated/reseeded synthetic DB: sign-in, tenant isolation, inbox/customer/order navigation, notes/tags, draft policy, handoff, and cross-shop order denial (404 masking) all green. Receipts `playwright-chromium-final.log` / `playwright-firefox-final.log` in the external evidence directory. |
| Meta-shaped E2E | **PASS — independent exact-source rerun** | 2 suites / 48 tests passed in 68.065 seconds on the migrated disposable database. |
| PostgreSQL/Redis integration | **PASS — independent corrected rerun** | On the corrected overlay runner at the rebuilt exact-source mirror (byte-verified manifest `4799041f…`), all 32 suites / 225 tests passed on a unique tmpfs-only disposable PostgreSQL migrated by the candidate image itself (ledger 66/66). Every guard true: exact container image ID, read-only source mounts, three narrow tmpfs overlays (auth fixture, attachment uploads, `uploads/`), loopback DB/Redis proxies, disposable DB name, `NODE_ENV=test`, fixture token, exact source revision. Receipt: summary `postgres-redis-integration-overlay-rerun-20261028t012248-11923-summary.txt`, jest log SHA-256 `7994b56adc62c3e068338735da24b03b2b449302504b888a95bb19493424d0e1`. The earlier 29/32 run's three setup failures are resolved at harness level (writable-path overlays, loopback DB host, `uploads` mountpoint); the verifier image-identity comparison and stage mountpoint defects were fixed in the external harness as disclosed above. No candidate source change. |
| Full backend suite | **PASS** | Exact Git-backed candidate: 320 suites; 4,310 passed, 2 skipped (4,312 total). |
| Backend security suite | **PASS** | Exact source: 58 suites / 817 tests; isolated network namespace; provider credentials unset. |
| Full frontend suite | **PASS** | Exact source: 78 files / 692 tests. |
| Frontend production build | **PASS** | Exact source build completed; existing Rollup pure-comment and large-chunk warnings were emitted. |
| Migration | **PASS — safe disposable full-chain apply substitute** | Exact candidate applied all 66 migrations to a unique ephemeral disposable database; ledger had 66 distinct rows. The repository helper that creates another Compose project and unconditionally runs `down -v` was not run. This is not called a literal dry-run. |
| Founder-accessible preview | **BLOCKED** | The isolated API's configured loopback port was not published in runtime port state; WSL/backend internal health worked, but no Windows-accessible founder preview was established. Internal browser-runner success does not satisfy founder preview. |
| Backup and restore | **PASS including representative record compare** | Custom dump: 314,461 bytes, SHA-256 `759e4a0b99481d3a7b852e80e2862a42766d8c839b0dab6989991b6468ce9dad`; 693 TOC entries. Source and restore each had 80 tables / 181 rows, matching core fixture counts, 66 migration rows, 146 foreign keys, and no unvalidated constraints. Representative order `OGCE2E-A-1001` is byte-equal between the live source and every restored database (`OGCE2E-A-1001|processing|1250.00`); receipt `backup-restore-order-compare.txt` (`representative_order_match=true`). |
| Previous-image compatibility | **BLOCKED** | The immutable digest and provenance of the previously deployed image are unavailable. A local base-source rebuild is not proof of compatibility with that deployed image. |
| Worker recovery | **PASS — independent exact-image confirmation** | Rehearsed at fresh state on the exact candidate image (`3367c27e…`, user `node`, no published host ports): signed synthetic inbound accepted while worker stopped, receipt `QUEUED` with encrypted replay body and queue job ID; the browser journey `authenticated-webhook-worker-restart.spec.ts` passed on chromium (7.0s); after `dc start worker` the receipt reached `PROCESSED` with queue job `completed` (`processedAt` recorded, `aiRowsAtOrAfterInbound=0`, no provider acknowledgement — pure synthetic); harness cleanup detached the channel (`DISCONNECTED`) and the worker was stopped (`exited`). Receipts `worker-post/inspect-queued/wait-processed/inspect-processed/cleanup-final*.json`, `worker-restarted-final.log`, run ID `ops-20261027T194348Z-40773`. The compose-declared local alert-sink reached healthy during the flow; production alert delivery remains blocked separately. |
| Queue safety | **PASS for observed isolated state** | Precheck found no waiting, active, prioritized, or failed jobs. Remaining keys were expected repeatable delayed schedulers and bounded completed jobs; no queue clearing was performed. |
| Alert delivery | **BLOCKED for production; local receipt pending confirmation** | Production alert destination and human receipt are unavailable and were not contacted. A local PII-free sink is the permitted rehearsal target; the independent reviewer had not supplied a final receipt at report time. |
| Dependency source audits | **PASS** | Exact root, backend, and frontend lockfiles independently audited with zero advisories at all severities. Lockfile hashes and dependency counts are in `dependency-vulnerability-disposition.md`. |
| Candidate image security scan | **PASS — vulnerability-only; broader scan incomplete** | Exact backend and frontend candidate images passed Trivy 0.76.1 vulnerability-only scans with zero findings at all severities. The full vulnerability/secret/misconfiguration invocation timed out before producing JSON and has no findings result. |
| Provider/model runtime | **UNKNOWN in production** | No production environment, provider dashboard, credential value, live inference, or billing state was accessed. Paid inference calls: **0**. Source Gemini primary is `gemini-3.1-flash-lite`; source OpenAI fallback is `gpt-4.1-mini`; optional Gemini Pro escalation is not enabled by the checked renderer. |
| Model lifecycle | **PASS — migration required before scheduled retirements** | Official lifecycle pages checked 2026-10-27. OpenAI lists `gpt-4.1-mini` shutdown on 2027-01-14 and recommends `gpt-6-luna`; Gemini lists `gemini-3.1-flash-lite` earliest shutdown on 2027-05-07 and recommends `gemini-3.5-flash-lite`. No model migration or paid call was made. |

The candidate image vulnerability-only scan receipts are retained outside the repository:

- Backend image `sha256:3367c27e1af0533be9043a299c84995a8b9eaa6bd94bde6fa792f8118239a1a6`: zero findings. Sanitized receipt `D:\easymod\_operational-gate-closure-v1-independent-final\backend-vulnerability-only-scan-summary.txt` (SHA-256 `D24F5B4A82E21F725BEFFB331DD2212F8182179E6F27C665E9C7BF69869A9DC9`); raw JSON SHA-256 `A08EABFA7621A71B64E3BA7F36EDDD7650E121F548617AFEBBAAC96A36DC8E47`.
- Frontend image `sha256:7f29dd67fc9ceaafe9668bab2b1a2d7e868cd18e2aada33c7528c29f4023ffc3`: zero findings. Sanitized receipt `D:\easymod\_operational-gate-closure-v1-independent-final\frontend-vulnerability-only-scan-summary.txt` (SHA-256 `B2B5F5641564936B7D38FF2D2E48339E07CE8479DA91C706B8EA18A991B4A49A`); raw JSON SHA-256 `672D851DB8013434884E30D0A1B52F0E7130B64AD0642D95B940FB217DD630CE`.
- Both used Trivy 0.76.1 and vulnerability database v2, updated `2026-10-27T13:12:49.474279883Z`. These scans cover vulnerabilities only. The separate vulnerability/secret/misconfiguration scan timed out before producing JSON, so its secret and misconfiguration findings are unknown.

The two earlier review observations about ownership-audit transaction duration and worker harness targeting were rechecked against the frozen candidate. The audit insert runs after the transaction callback commits and is best-effort; the worker harness checks production mode, the exact closure Compose project, project/seed confirmations, and the disposable database host/name. Neither finding remains open in `04b07134`.

## Exact final output contract

```text
PROJECT=EasyModerator
MILESTONE=Operational Gate Closure V1

BASE_SOURCE_SHA=6d6bc1dd056e09202b97d05e81f20308b15109ab
FINAL_CODE_SHA=04b07134c265b04745d7c3add85154b66e82f132
FINAL_DOCUMENTATION_SHA=reported in final handoff; direct child of FINAL_CODE_SHA
BRANCH=ops/operational-gate-closure-v1
WORKTREE=D:\easymod\_wt-operational-gate-closure-v1
TRACKED_TREE_CLEAN=NO (preserved pre-existing native-auth fixture modification)

PHOTO_MATCHING_DEFAULT=PASS (candidate source/render default OFF; production runtime unknown)
ALL_PRODUCTION_DEFAULT_FLAGS=PASS (isolated candidate only; production runtime unknown)
COMMERCE_MUTATION_DENIAL=PASS (exact-source targeted matrix, 5 suites / 32 tests)

AUTHENTICATED_TENANT_E2E=PASS (exact-image rerun; chromium 20.1s, firefox 35.4s at fresh state)
META_SHAPED_E2E=PASS (independent exact-source rerun, 2 suites / 48 tests)
FULL_BACKEND_SUITE=PASS (320 suites; 4,310 passed; 2 skipped)
FULL_FRONTEND_SUITE=PASS (78 files; 692 tests)
PLAYWRIGHT_CHROMIUM=PASS (exact-image final rerun)
PLAYWRIGHT_FIREFOX=PASS (exact-image final rerun)
FOUNDER_PREVIEW=BLOCKED (no Windows-accessible preview)

BACKUP_RESTORE=PASS (integrity, counts, and representative order-field equality)
PREVIOUS_IMAGE_COMPATIBILITY=BLOCKED (previous immutable image digest unavailable)
WORKER_RECOVERY=PASS (exact-image confirmation; queued-then-processed with zero provider/AI rows)
QUEUE_SAFETY=PASS for observed isolated queue state
ALERT_DELIVERY=BLOCKED for production; local receipt confirmation pending

HIGH_VULNERABILITIES_OPEN=0 in exact lock audits and both candidate images (vulnerability-only scans)
HIGH_VULNERABILITIES_TRIAGED=PASS (three original production highs remediated)
RUNTIME_SECURITY_VERDICT=PASS for vulnerability-only scans of both candidate images; secret/misconfiguration scan BLOCKED

EFFECTIVE_OPENAI_MODEL=UNKNOWN (source fallback gpt-4.1-mini)
EFFECTIVE_GEMINI_MODEL=UNKNOWN (source primary gemini-3.1-flash-lite)
MODEL_LIFECYCLE_VERDICT=PASS (official retirement schedule recorded; migration not performed)
PAID_INFERENCE_CALLS=0

INDEPENDENT_ATTESTATION=PARTIAL (all reviewer-side gates now green at the frozen candidate, including the corrected PostgreSQL/Redis integration rerun at 32/32 suites and 225/225 tests; remaining items are owner/production dependencies below)
TECHNICAL_PILOT_READINESS=NO-GO
OUTSTANDING_OWNER_DECISIONS=provide prior immutable image digest; establish founder-accessible preview; verify live flags/provider/key mapping and billing telemetry; authorize production alert destination and human receipt; attest production backup/restore controls; complete the full Trivy secret/misconfiguration scan window

PRODUCTION_AUTHORIZED=NO
PRODUCTION_CHANGED=NO
PUSHED=NO
MERGED=NO
DEPLOYED_TO_PRODUCTION=NO
OTHER_AGENT_WORKTREES_TOUCHED=NO
```

## Consolidated owner handoff

Before reconsidering a pilot, the release owner must provide the immutable digest and provenance for the deployed rollback image. The operations owner must confirm the effective production flags, provider-key mapping, per-call model overrides, `AI_USAGE_ACCOUNTING`, billing controls, and a permitted alert destination with an operator receipt. The founder needs a working authenticated preview on an approved local or staging boundary. The backup owner must confirm the protected production backup/restore process and provide the requested representative-record comparison. Any externally delivered callback or live provider check requires a separately approved staging target and budget; none was used here.

During the isolated review, a synthetic-only closure action-gate secret appeared in tool output. The reviewer rotated it in the ignored external closure environment file. No production credential or provider secret was accessed or changed; the rotated value is not recorded here.

The source-lock audits and synthetic local tests do not establish production configuration, production customer-data handling, provider billing, backup objectives, on-call delivery, deployed-image rollback compatibility, or founder acceptance. No production resource was changed. No push, merge, or deployment was performed.
