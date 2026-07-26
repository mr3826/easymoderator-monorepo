# 17 — Findings and Blocker Ledger

35 findings: **1 P0**, **8 P1**, **16 P2**, **10 P3**.

This ledger is **canonical**. The per-workstream files use the same `F-nn` identifiers.

Legend — *Owner*: `ENG` = engineering, `FOUNDER` = founder action, `META` = Meta App
Dashboard, `INFRA` = infrastructure/config.

---

## P0 — Immediate data-loss hazard

### F-01 — `PAYMENT_ENCRYPTION_KEY` rotation silently destroys stored payment credentials

- **Evidence:** `payment-config.entity.js:14-20` derives the AES key via
  `sha256(value)` for non-hex input; the validator requires 64 hex
  (`production-config.validator.js`); the deploy preflight reports
  `invalid: PAYMENT_ENCRYPTION_KEY`, proving the live value is not 64 hex. Payment
  credentials use AES-256-**CBC** (no auth tag), so a wrong key yields garbage, not a
  clean error.
- **User impact:** every merchant's stored bKash credentials become permanently
  undecryptable. Unrecoverable without a backup restore.
- **Meta-review impact:** none.
- **Market-launch impact:** total loss of payment configuration for all merchants.
- **Root cause:** a lenient runtime fallback paired with a strict validator, with no
  re-encryption migration path.
- **Remediation:** set the secret to the sha256 **hex digest of the current value**:
  `printf '%s' 'CURRENT_VALUE' | openssl dgst -sha256 -hex | awk '{print $NF}'`.
  Byte-identical key, satisfies the regex. **Do not generate a fresh random key.**
  Longer term: add a decrypt-old/re-encrypt-new migration and move payment credentials to
  AES-256-GCM.
- **Owner:** FOUNDER (the value must never pass through an agent)
- **Verification after fix:** deploy preflight no longer reports
  `invalid: PAYMENT_ENCRYPTION_KEY`; a merchant's saved payment config still decrypts.

---

## P1 — Meta review or market-launch blockers

### F-02 — Unknown/non-CONNECTED Page silently drops customer messages, acks Meta 200
- **Evidence:** `meta-webhook-events.handler.js:448-467`, then `res.sendStatus(200)`.
- **User impact:** customers' messages vanish; merchant never learns.
- **Meta-review impact:** **high** — a reviewer whose Page is mis-mapped sends a DM and sees nothing, with no diagnostic.
- **Market-launch impact:** silent customer-message loss.
- **Root cause:** no durable persistence before channel resolution; `continue` on failure.
- **Remediation:** persist every inbound event to a durable table before resolution; mark `unresolved`; alert on non-zero depth.
- **Owner:** ENG · **Verify:** send a webhook for an unknown Page → durable row + alert, not a silent 200.

### F-03 — Per-message store failure swallowed, acks Meta 200
- **Evidence:** `meta-webhook-events.handler.js:508-512`.
- **Impact / remediation / owner:** as F-02; the `catch` must record a durable failure rather than only logging.

### F-04 — Backups are co-located with production; no restore ever tested
- **Evidence:** `backup.yml` → `BACKUP_DIR=/opt/easymod/backups` on the droplet; no off-site step; no restore evidence.
- **User impact:** droplet loss destroys production **and** all seven days of backups.
- **Meta-review impact:** none. **Market-launch impact:** unrecoverable total data loss.
- **Remediation:** off-site encrypted copy (Spaces/S3) + one documented restore into an isolated DB.
- **Owner:** FOUNDER (bucket credentials) + ENG (workflow) · **Verify:** restore succeeds in isolation.

### F-05 — Launch-readiness gate reports false PASSes
- **Evidence:** reproduced this run — `✅ PASS Infra up` and `✅ PASS Auto-reply DLQ empty (dlq=n/a)` against the nginx stub; `Caddyfile` never proxies `/health/*` to the backend; `launch-readiness.js:60` coerces `undefined || 0` to `0`.
- **User impact:** none directly. **Market-launch impact:** the go/no-go signal is untrustworthy; a dead backend still reads "Infra up".
- **Remediation:** proxy `/health/*` to `backend:3000` in Caddy, remove the nginx stubs, and make the DLQ gate fail on an absent value.
- **Owner:** ENG · **Verify:** stop the backend container → gate 2 must FAIL.

### F-06 — Alerting reaches nobody in production
- **Evidence:** neither `SENTRY_DSN` nor `SLACK_ALERT_WEBHOOK_URL` exists in `gh secret list`; the repo has only `VITE_SENTRY_DSN`.
- **Impact:** every `opsAlert(...)` in the codebase — queue down, DLQ growth, deletion unresolved, backup failure — has no destination. Launch gate 8 fails.
- **Owner:** FOUNDER · **Verify:** trigger a test alert and confirm human receipt.

### F-07 — Phase 1 hardening is not deployed
- **Evidence:** run `30189476291` failed at the preflight; `Copy .env.prod` and `Deploy via SSH` skipped; droplet untouched.
- **Impact:** production runs pre-merge code — including the broken `delivery_tracking` tenancy query and the pre-fix SSRF/auth-revocation paths.
- **Owner:** FOUNDER (secrets) then ENG · **Verify:** deploy succeeds; `/health/ready` on the backend container returns 200 with the new image.

### F-08 — No screencast; mandatory text round-trip unrecorded
- **Evidence:** no storyboard in any of the three review documents.
- **Meta-review impact:** **submission blocker**.
- **Owner:** FOUNDER + META.

### F-09 — No reviewer credentials, test Page, or tester account
- **Evidence:** `meta-app-review-submission.md` references "the supplied tester customer account"; no credentials block exists.
- **Meta-review impact:** **submission blocker**.
- **Owner:** FOUNDER + META.

---

## P2 — Required before scaling beyond the pilot

| ID | Finding | Evidence | Owner |
|---|---|---|---|
| F-10 | App icon + business-verification state absent from the review package | `07_` | FOUNDER |
| F-11 | Webhook processed synchronously before ack; risks Meta timeouts | `meta-webhook.routes.js:170-172` | ENG |
| F-12 | AI-pause suppression write is fire-and-forget with a swallowed error — AI can reply over a human agent | `conversation.controller.js:425` | ENG |
| F-13 | Delivery-status writes end in `.catch(() => {})`; a failed status write leaves a message looking sent | `conversation.controller.js:258-270` | ENG |
| F-14 | Queue-unavailable path stores but never replies; `dispatchMessageJob` not awaited | `meta-webhook-events.handler.js:140-159,505` | ENG |
| F-15 | E2E suite (8 Playwright specs) exists but never runs in CI | `ci-cd.yml:117-134` | ENG |
| F-16 | CI does not typecheck despite the comment claiming it does (`vite build` strips types) | `ci-cd.yml:116` | ENG |
| F-17 | No lint gate exists in either package (no ESLint config, no `lint` script) | `npx eslint src` → no config | ENG |
| F-18 | Backend dependency vulnerabilities unverified (npm audit tooling failure) | `10_` | ENG |
| F-19 | `/api/voice/transcribe` — unmetered AI-cost vector, no size cap, no shop scoping | `voice-processing.controller.js:22-47` | ENG |
| F-20 | No upload-volume capacity monitoring or disk alert | `09_` | INFRA |
| F-21 | Migration up/down/up not re-verified (no Docker daemon); rests on one unreproduced run | `11_` | ENG |
| F-22 | No golden-set evaluation for Bengali/Banglish AI quality or hallucination resistance | `08_` | ENG |
| F-23 | ROI calculator asserts an unsubstantiated "~20% COD return rate avoided" | `15_` | FOUNDER |
| F-24 | Courier feature card promises integrations while "0 couriers built-in" and no credentials exist | `14_`, `15_` | FOUNDER |
| F-35 | Production migration status unconfirmed — `migrate:status` not run against production | `11_` | ENG |

---

## P3 — Post-launch improvements

| ID | Finding | Evidence |
|---|---|---|
| F-25 | Frontend: 2 high advisories (react-router RSC CSRF bypass) — likely N/A for a Vite SPA, but patch it | `npm audit` |
| F-26 | Dead `MESSAGE_TAG` branch in `MetaMessengerProvider.js:471-473` — remove so tagged sending cannot silently revive | source |
| F-27 | `conversation/ai-chatbot.controller.js` is unmounted dead code containing a second, divergent order implementation | `routes.js` |
| F-28 | `voice-processing.service.js:95` `downloadMediaFromMeta` — dead, unguarded raw Graph fetch; delete or route via `safeFetchMedia` | source |
| F-29 | Coalescing window is 8s (`AI_BURST_WINDOW_MS`), not the documented ~10s | `burst-coalescer.js:35` |
| F-30 | `meta-channel.entity.js:121` comment implies a `messaging_optins` subscription that is never made | source |
| F-31 | Frontend CSP `connect-src` allowlists `https://api.easymod.tech`, a host with no valid TLS and no role | live headers |
| F-32 | Footer copyright reads "© 2025"; current date 2026-07-26 | live site |
| F-33 | No `og:`/`twitter:` social-preview or `meta description` tags — shared links render bare on FB/WhatsApp | served HTML |
| F-34 | Meta review package has no troubleshooting section for the reviewer | `07_` |

---

## INFO — verified observations (no action)

- Meta permission surface is exactly the three target scopes, with no env override.
- Webhook field surface is exactly `messages`.
- Instagram/WhatsApp unreachable: one provider, `ENUM('facebook')` at the model layer.
- Deprecated message tags genuinely dead (`ALLOWED_TAGS` empty; outside-window hard-deny).
- Compliance callbacks fail closed in live production with no leakage.
- Order cancellation requires an explicit cancel phrase — a bare "no"/"না" cannot cancel.
- Order and message idempotency are enforced at the database level.
- Public copy, privacy policy, and the Meta package are mutually consistent.
- Security headers on production are strong.
- 1,669 tests pass, 0 fail, 0 skip.
