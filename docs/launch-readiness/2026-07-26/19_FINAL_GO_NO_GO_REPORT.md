# 19 — Final GO / NO-GO Report

**Date:** 2026-07-26 · **Commit:** `d716ecf` (merged as `8394a44`) · **Tree:** clean

---

## A. Meta App Review — Code Readiness: **CONDITIONAL GO**

The permission and webhook surface is exactly right, and that is the part Meta actually
assesses. Verified fresh, not inherited:

- `pages_show_list`, `pages_messaging`, `pages_manage_metadata` — three, no more, no
  environment override, no separate reconnect path that widens them.
- Webhook field: `messages` only. `feed`/comment changes explicitly ignored.
- Instagram and WhatsApp structurally unreachable — one provider, `ENUM('facebook')`.
- Deprecated message tags genuinely dead; outside the 24h window every send hard-denies.
- Data deletion, deauthorization, and the webhook receiver all **fail closed in live
  production** with no PII or secret leakage.
- The three-state deletion model (`COMPLETED` with counters / `COMPLETED` with zero
  counters / `IDENTITY_NOT_RESOLVED`) never reports a false completion.

**The condition:** fix **F-02** and **F-03** first. If the reviewer's Page lands in any
non-`CONNECTED` state, their DM is dropped silently, Meta is told `200`, and nothing
diagnostic is recorded. That is a realistic way to fail a review with no explanation.

---

## B. Meta App Review — Submission Package: **READY AFTER FOUNDER ACTION**

The written package is accurate, narrow, and consistent with the code — its strongest
quality. All reviewer-facing URLs were verified live and resolve correctly.

Missing, all founder-owned: reviewer credentials, test Page, tester account (F-09); the
screencast including the mandatory text round-trip (F-08); app icon and business
verification (F-10).

Nothing in the package needs rewriting. It needs assets.

---

## C. Controlled Pilot Launch: **NO-GO**

Decisive reason: **the hardening this audit examined is not running in production.**

The deploy failed at the preflight before contacting the droplet. Production serves the
pre-merge image — including the broken `delivery_tracking` tenancy query, the pre-fix
SSRF paths, and the pre-fix auth-revocation behaviour. Onboarding merchants today puts
them on un-hardened code.

Compounding:

- **Zero of ten launch gates are confirmed green** (`12_`).
- Alerting reaches nobody — neither `SENTRY_DSN` nor `SLACK_ALERT_WEBHOOK_URL` is set, so
  every `opsAlert` in the system is a no-op (F-06).
- Backups sit on the machine they protect, never restore-tested (F-04).
- Inbound messages can vanish silently (F-02, F-03).

**Path to GO:** founder steps 1-4, 9, 11, 12 plus engineering fixes F-02, F-03, F-05.

---

## D. Public Initial Market Launch: **NO-GO**

Everything blocking C, plus:

- 7-day canary observation not started — and **cannot** be meaningfully started until F-05
  is fixed, because the DLQ gate currently reports PASS while knowing nothing.
- 10-shop activation not reached (unverifiable; requires an admin token).
- No restore has ever been performed.
- bKash is publicly sold, configured for **live money**, and has no credentials; no
  real-money test has ever run.
- Courier integrations are advertised with zero configured providers.
- The ROI calculator asserts an unsubstantiated ~20% COD-return-avoidance figure.

---

## Launch gate scorecard

| # | Gate | Status |
|---|---|---|
| 1 | CI green on `main` | **FAIL** — run `30189476291` failed |
| 2 | Infra up (`/health/ready`) | **UNSOUND** — false PASS against an nginx stub |
| 3 | DB + Redis + Vector healthy | **FAIL** / unverifiable externally |
| 4 | Message DLQ = 0 | **UNSOUND** — false PASS (`dlq=n/a`) |
| 5 | Auto-reply canary fresh | **FAIL** — no heartbeat |
| 6 | Canary green 7 days | **NOT STARTED** |
| 7 | ≥10 shops activated | **UNVERIFIED** (401) |
| 8 | Alerting reaches a human | **FAIL** — no sink configured |
| 9 | Attachment round-trip | **UNVERIFIED** |
| 10 | Meta identity coverage = 0 missing | **UNVERIFIED** |

---

## Answers to the seven closing questions

**1. The five most important findings** — F-07 (Phase 1 hardening not deployed), F-05
(launch gate reports false PASSes), F-02/F-03 (silent inbound message loss), F-04
(co-located, never-restored backups), F-01 (`PAYMENT_ENCRYPTION_KEY` rotation destroys
stored credentials).

**2. The exact next founder action** — Step 1 in `18_`: set `PAYMENT_ENCRYPTION_KEY` to the
sha256 **hex digest of its current value**, never a fresh random key. Do this before
touching any other secret.

**3. The exact next engineering action** — Fix **F-02/F-03**: persist every inbound webhook
event durably *before* channel resolution, and mark it `unresolved`/`failed` instead of
dropping it. Then **F-05**: proxy `/health/*` to `backend:3000` in the `Caddyfile` and make
the DLQ gate fail on an absent value rather than coercing `undefined` to `0`.

**4. Can Meta review materials be recorded now?** — **Not yet.** The product supports every
required step and the scope is clean, so recording is close. But provision the test Page
and tester account first (Step 7), and fix F-02 first, or the recording may capture a
silent failure.

**5. Can Meta App Review be submitted now?** — **No.** No screencast, no reviewer
credentials, no app icon or business verification. The written package itself is ready.

**6. Can real merchants be safely onboarded now?** — **No.** Production runs pre-merge
code, alerting reaches nobody, backups are unproven and co-located, and inbound messages
can vanish silently. Complete founder steps 1-4, 9, 11, 12 and engineering fixes F-02,
F-03, F-05 first.

**7. Should public marketing spend begin now?** — **No.** Nothing is activated, no canary
history exists, billing is sold but non-functional, courier integrations are advertised
with zero providers, and shared links have no social-preview metadata so they render bare
on Facebook and WhatsApp — the exact channels the spend would target.

---

## Closing note

The code quality on the Meta-facing path is genuinely good: correct narrow scope, honest
three-state deletion, real fencing tokens, defence-in-depth policy enforcement, and a
connection flow that refuses to report success it has not verified. Several controls here
are better than typical.

The gap is not code quality. It is that **none of it is deployed**, and that the
instrument used to decide whether it is safe to launch — the launch-readiness gate —
returns PASS for conditions it cannot observe. Fix the gate before trusting any future
green run.
