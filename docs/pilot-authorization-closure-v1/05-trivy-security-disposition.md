# 05 — Complete security-scan disposition (Gate E)

## Scope and tooling (2026-10-30)

Trivy **0.76.1** (same binary+cache pinned on NTFS as the 10-27 partial run; vulnerability DB freshly re-downloaded this session — receipt `evidence/trivy-db-update.txt`; previous DB age was 2026-10-27). Image identity prechecks re-passed before scanning (immutable identity preserved): backend `sha256:3367c27e…`, frontend `sha256:7f29dd67…` (`trivy-*-full-identity.txt`).

Why the 10-27 scan never finished: the combined `vuln,secret,misconfig` invocation exceeded the 5-minute window on a cold DB. This milestone split the work: per-image `vuln+secret` scans, and `trivy config` per IaC target (Trivy rejects multiple config targets in one invocation). **The previously deferred scan is now complete.**

## Results

| Target | Checks | Findings |
|---|---|---|
| Backend image `3367c27e` | vuln + secret (Alpine 3.23.4 OS pkgs 18, node-pkg) | **1 vulnerability, 0 secrets** |
| Frontend image `7f29dd67` | vuln + secret (nginx 1.29-alpine, static dist) | **0 findings** |
| `docs/operational-gate-closure-v1/compose.yml`, `docs/pilot-deployment-rehearsal-v1/docker-compose.rehearsal.override.yml`, `docker-compose.prod.yml`, all three Dockerfiles | misconfig | **0 failures (6/6 targets)** |
| Exact lockfiles (backend/frontend/root, `npm audit --package-lock-only`, current registry data) | advisories | **0 HIGH / 0 CRITICAL**; 5 LOW (jest dev-chain: `@jest/core, jest, jest-cli, jest-config, deepmerge`) + 1 MODERATE (`qs`) |

Receipts: `D:\easymod\_pilot-authorization-closure-v1-local\evidence\trivy-{backend,frontend}-full.json`, `trivy-cfg-*.json`, `*-identity.txt`; 10-27 vulnerability-only baselines remain in the closure evidence dir (zero findings then; today's single finding is a **new CVE published after 2026-10-27**, consistent with a moving DB, not a regression).

## The one unresolved finding — full disposition record

```text
ADVISORY            CVE-2026-110816 (GHSA-linked; npm rates MODERATE, Trivy MEDIUM)
SEVERITY            MEDIUM — availability only
AFFECTED_COMPONENT  qs (transitive: express body/query parsing chain)
INSTALLED_VERSION   6.16.0  (exact lockfile; image + all three lockfiles agree)
FIXED_VERSION_IF    6.16.1  (patch release; status=fixed in scanner)
RUNTIME_REACHABILITY The CVE concerns unhandled exceptions during array *serialization*
                     (qs.stringify of crafted/array-shaped values). The backend reaches qs
                     via (a) express query parsing (qs.parse — unaffected by this CVE path)
                     and (b) internal query-string building for outbound HTTP (Google
                     Graph, payment/courier adapters). In the approved pilot posture
                     (commerce/AI/outbound flags OFF, no provider egress, authenticated
                     merchant inputs only) no attacker-controlled array-valued field is
                     serialized. Reachability: LOW; exploit effect bounded to a 500 on a
                     crafted internal serialization, not data exposure.
EXPOSURE            Loopback pilot preview (none public) / authenticated SaaS surface
                     post-deploy. No public unauthenticated dependency on the path.
PROPOSED_REMEDIATION Minimal lockfile bump qs 6.16.0→6.16.1 in a separate correction
                     increment on top of 04b07134 (no API change; patch-level), then
                     re-scan + focused regression (express query tests + outbound
                     adapter tests). Explicitly NOT applied to the frozen candidate:
                     silent candidate alteration is prohibited, and a lockfile delta
                     requires fresh image+scan attestation to be meaningful.
VERIFICATION        After the bump: trivy vuln scan zero findings on rebuilt images;
                     npm advisories = 5 LOW jest-chain dev-only remain (not shipped:
                     devDependencies excluded from runtime images — image scan proves).
ACCEPTED_RISK_OWNER  UNRESOLVED — requires founder/release-owner signature: either
                     (a) ship the bump increment before pilot deploy (recommended), or
                     (b) time-bound acceptance for the pilot window with the flag-OFF
                     posture as compensating control. The reviewer recommends (a) and
                     cannot accept the risk on the owner's behalf.
```

## Prior findings reconciliation

- The three original production HIGHs (documented in `docs/operational-gate-closure-v1/dependency-vulnerability-disposition.md`) remain remediated — exact lockfile audits today show 0 HIGH/CRITICAL; image scans confirm the shipped trees.
- 10-27 "broader scan incomplete" is now closed: secret scanning of both image trees = 0 (no baked secrets; closure secrets live only in the ignored external env file), misconfiguration scanning of both rehearsal compose files, the production compose, and all Dockerfiles = 0 failures (non-root users, digest pins, no `:latest`, read-only/tmpfs where declared).
- Runtime container identity/capabilities covered by the 17 integration guards + browser-runner isolation attestations (unchanged; `00` ledger reconfirms image identity at runtime today).

`FULL_SECURITY_SCAN=PASS (scope complete) — OPEN_HIGH_CRITICAL=0 — one MEDIUM finding disclosed with an available patch awaiting owner disposition (ship-the-bump recommended).`
