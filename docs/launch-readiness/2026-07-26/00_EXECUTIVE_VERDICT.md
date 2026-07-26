# 00 — Executive Verdict

**Audit date:** 2026-07-26
**Auditor role:** CTO / security reviewer / QA lead / release manager / Meta-platform compliance reviewer
**Repository:** `D:\hexabyte\easy-moderator` (`https://github.com/mr3826/easymod-backend`)
**Branch audited:** `codex/phase1-security-compliance` @ `d716ecf` (fully merged into `origin/main` @ `8394a44`)
**Working tree:** clean (0 dirty files, 0 stashes, 1 worktree)

This audit is **read-only**. No merge, no deploy, no push, no production mutation, no secret values printed.

---

## The four verdicts

| # | Question | Verdict |
|---|----------|---------|
| **A** | Meta App Review **code** readiness | **CONDITIONAL GO** |
| **B** | Meta App Review **submission package** readiness | **READY AFTER FOUNDER ACTION** |
| **C** | **Controlled pilot** launch readiness | **NO-GO** |
| **D** | **Public initial market** launch readiness | **NO-GO** |

These are deliberately not combined. The code's Meta permission surface is genuinely
correct and narrow; the operational and deployment posture is not launch-ready.

---

## The single most important fact

**The Phase 1 security and Meta-compliance hardening that this whole audit concerns
is not running in production.**

PR #74 merged to `main` as `8394a44` on 2026-07-26T05:29:55Z. The `Build & Push Docker
Images` job succeeded. The `Deploy to DO Droplet` job **failed after 8 seconds at its
first step**, "Render and validate .env.prod", which runs *before* `Copy .env.prod to
droplet` and `Deploy via SSH`. Both later steps show as skipped.

The droplet was never contacted. Production is still serving the **pre-merge image**.

Every control introduced by PR #74 — the tenancy fixes, the auth-revocation
tightening, the deletion fencing tokens, the SSRF magic-byte validation, the
migration-before-replacement ordering — exists in `main` and in the GHCR image, and in
**none** of them in production. Any merchant onboarded today is onboarded onto
un-hardened code.

The preflight failing closed is correct, designed behaviour, not a regression. It is
blocked on eight GitHub repository secrets that only the founder may set
(see `18_FOUNDER_ACTION_CHECKLIST.md`).

---

## The five findings that matter most

### 1. P1 — The launch-readiness gate reports false PASSes against production

`docs/launch/LAUNCH_GATE_CHECKLIST.md` gate 2 ("Infra up") and gate 4 ("No silent
reply failures — message-dlq depth = 0") both pass against the real production URL
while knowing nothing about the backend, database, Redis, or the DLQ.

Caddy proxies only `/api/*`, `/uploads/*`, and `/webhooks/*` to the backend. `/health/*`
therefore lands on the **frontend nginx container**, which answers with a hardcoded
stub. The backend's real probe — the one that actually calls `sequelize.authenticate()`
and checks Redis — is unreachable from outside the Docker network.

Reproduced live, this run:

```
✅ PASS  Infra up (/health/ready 200)          ok
❌ FAIL  DB + Redis + Vector store             db=undefined redis=undefined vector=undefined
✅ PASS  Auto-reply DLQ empty                  dlq=n/a
❌ FAIL  Auto-reply canary fresh               no canary heartbeat yet
```

`dlq=n/a` passing as "no silent reply failures" is the exact false-success pattern this
audit exists to catch. The gate would stay green with a dead backend, a dead Postgres,
and a full DLQ.

The **automated deploy gate is not affected** — CI probes the backend container
directly (`ci-cd.yml:433`), as does the compose healthcheck. Only the external and
human-facing signal is fake.

### 2. P1 — Inbound Messenger messages are dropped silently, and Meta is told 200

Two paths in `meta-webhook-events.handler.js` lose a real customer message with no
durable record, no DLQ entry, no retry, and a `200` acknowledgement to Meta (which
suppresses Meta's own retry):

- **Unknown / non-CONNECTED Page** (line 448-467): logs, emits a best-effort SSE *only
  if* a prior channel row exists, then `continue`s.
- **Per-message store failure** (line 508-512): `catch` logs and moves on.

A merchant whose Page mapping is stale loses customer messages permanently and
invisibly. This is the "durable and truthful failure state, not false completion"
requirement, unmet.

### 3. P1 — Backups are still co-located with production

`.github/workflows/backup.yml` writes `pg_dump` output and the uploads tarball to
`/opt/easymod/backups/` **on the production droplet**, 7-day retention, no off-site
copy, no encryption beyond gzip, and no restore test on record. Droplet loss = total
loss of production *and* every backup.

Previous reports flagged this. It is **not fixed**. Per the audit brief this is a
market-launch blocker absent an explicit written risk exception.

The scheduled workflow itself is genuinely running and succeeding (last run
`30189139485`, 2026-07-26T05:17Z, 10s).

### 4. P1 — bKash billing is publicly promised, configured live, and has no credentials

The public pricing section sells a ৳999/mo Growth plan with a 14-day trial. The deploy
workflow hardcodes `BKASH_ENABLED: "true"` and `BKASH_SANDBOX: "false"`
(`ci-cd.yml:246,253`) — i.e. **live money mode** — while all six `BKASH_*` secrets are
absent from the repository. No real-money production test has been performed.

### 5. P0-adjacent hazard — `PAYMENT_ENCRYPTION_KEY` cannot be naively rotated

The production-config validator demands 64 hex characters, but
`payment-config.entity.js:14-20` falls back to `sha256(value)` for non-hex input, and
payment credentials are stored AES-256-**CBC**. Setting a *fresh* hex key to satisfy the
validator silently changes the derived AES key and makes every existing
`payment_configs` row permanently undecryptable.

The lossless migration is to set the secret to the sha256 **hex digest of the current
value**, which is byte-identical to what the runtime already derives. This is a
data-loss trap sitting directly in the path of the fix for the deploy.

---

## What is genuinely good

These were verified fresh, not taken from prior reports:

- **The Meta permission surface is exactly right.** `pages_show_list`, `pages_messaging`,
  `pages_manage_metadata` — three, no more, no environment override, no separate
  reconnect path that widens them.
- **The webhook field surface is exactly right.** `messages` only. `feed`/comment changes
  are explicitly ignored in the normalizer.
- **Instagram and WhatsApp are structurally unreachable.** One provider in the registry;
  the Sequelize model enum is `ENUM('facebook')`.
- **Deprecated Messenger message tags are genuinely dead.** `ALLOWED_TAGS` is an empty
  `Set`; no rule ever sets `augment.message_tag`; outside the 24h window the pipeline
  hard-denies with `OUTSIDE_24H_TEMPLATES_DISABLED`.
- **The compliance callbacks fail closed in live production** — verified against the real
  deployment this run, with no PII or secret leakage in the error bodies.
- **Security headers on production are strong** — CSP, HSTS, `nosniff`, `SAMEORIGIN`,
  a restrictive `permissions-policy`.
- **Public marketing copy is honest.** No Instagram, no WhatsApp, no comment automation,
  no omnichannel claim, no fabricated testimonials — the "pilot scorecard" is correctly
  framed as *"what we will prove"*, not as results.
- **The whole test suite is green:** backend 107 suites / 1226 tests, frontend 49 files /
  443 tests, `tsc --noEmit` exit 0.

---

## Correction to a prior statement

An earlier session reported production health as unverifiable and attributed the failure
to sandbox network restrictions. That was wrong. `api.easymod.tech` and
`app.easymod.tech` were never the production hostnames — the canonical origin is the
apex `https://easymod.tech` (same-origin SPA), which is reachable from this environment
and returned `200`. `app.easymod.tech` is NXDOMAIN and `api.easymod.tech` fails TLS
because neither is a configured host. Production was reachable and testable all along,
and the live evidence in this audit was gathered directly against it.

---

## Reading order

| File | Contents |
|---|---|
| `01_REPOSITORY_AND_RELEASE_STATE.md` | Git/PR/CI state and release integrity |
| `02_META_SCOPE_AND_PERMISSION_AUDIT.md` | Permission + webhook field proof, removed-channel reachability |
| `03_META_LOGIN_AND_PAGE_CONNECTION.md` | 17 connection scenarios and what is actually blocked |
| `04_WEBHOOK_SECURITY_AND_RELIABILITY.md` | Signature, idempotency, the silent-drop findings |
| `05_MESSENGER_POLICY_COMPLIANCE.md` | Policy pipeline, message tags, timing windows |
| `06_DATA_DELETION_DEAUTH_AND_PRIVACY.md` | Compliance callbacks and security controls |
| `07_META_REVIEW_PACKAGE_AUDIT.md` | Reviewer package gap analysis |
| `08_CORE_MERCHANT_JOURNEY.md` | Signup → connect → order lifecycle |
| `09_SHARED_INBOX_AND_ATTACHMENTS.md` | Inbox and attachment round-trip |
| `10_TEST_BUILD_AND_CI_EVIDENCE.md` | Every command, exit code, and exclusion |
| `11_DATABASE_AND_MIGRATION_EVIDENCE.md` | Migration state and what could not be re-run |
| `12_PRODUCTION_INFRA_AND_OPERATIONS.md` | The health-gate finding in full |
| `13_BACKUP_RESTORE_AND_DR.md` | Backup posture and DR gap |
| `14_BILLING_AND_COURIER_SCOPE.md` | bKash and courier launch-scope decision |
| `15_PUBLIC_COPY_AND_MARKET_CLAIMS.md` | Live site claim-by-claim review |
| `16_MANUAL_TEST_MATRIX.md` | What was manually exercised, what was not |
| `17_FINDINGS_AND_BLOCKER_LEDGER.md` | All findings, P0–INFO, with remediation |
| `18_FOUNDER_ACTION_CHECKLIST.md` | Exact ordered founder steps |
| `19_FINAL_GO_NO_GO_REPORT.md` | Consolidated verdict and gate table |
| `EVIDENCE_INDEX.md` | Claim → receipt map |
| `readiness-results.json` | Machine-readable results |
