# Easy Moderator — C-Level Final Audit & Launch Decision

**Date:** 2026-06-24
**Prepared by:** Claude Code, acting as the virtual executive board (CEO · CTO · CISO · CFO · COO · CPO)
**Audience:** Founder / PM (Hexabyte)
**Production HEAD:** `main` @ `e004f73` (PR #47, bKash subscription billing) — live, `/health` & `/health/ready` = **200**
**Scope:** Whole-company readiness for the initial **Facebook Page Messenger DM-only** public launch in Bangladesh.

This is the authoritative, board-level audit. It supersedes
`docs/launch/FINAL_LAUNCH_READINESS_AUDIT_2026-06-24.md` (which predated the billing system) and
consolidates the engineering, security, finance, and operations view into one launch decision.

---

## 0. Bottom Line (read this if nothing else)

**The product is engineering-complete and launch-ready. It is NOT yet revenue-proven or
operationally hardened.** Everything within code's control is shipped, green, and live on `main`.
The remaining gates are **founder-owned and non-code**, and two of them are money/data risks that
must be closed *before* the first real seller pays:

1. **Meta App Review submission** (3-scope Messenger-only) — the hard external gate. Nothing reaches
   real sellers until Meta approves. *(founder action)*
2. **Live bKash money test on PRODUCTION merchant credentials** — the entire business charges on a
   single new code path (PR #47) that has **never processed a real taka**. *(founder action — do not
   skip)*
3. **Off-site database backups** — backups currently live on the same droplet they protect. One lost
   droplet = total data loss. *(fast-follow, this week)*
4. **10-shop activation smoke test + operational gates 4–9** — DLQ/canary/alerting/attachment
   round-trip. *(founder + ops)*

**Recommended launch sequence:** close #2 and #3 → submit #1 → run #4 in the Meta review waiting
window → flip the switch on approval. **Decision required from you is at the end (§9).**

---

## 1. What I did this session (autonomous)

| Action | Result |
|---|---|
| Re-ran the full backend Jest suite | **Green (exit 0)** — 1007 passed / 1007, 68 suites |
| Re-ran the frontend production build (`tsc` + Vite) | **Green** — built in ~22s, bundle warnings only (vendor chunks > 500 kB, expected) |
| Verified live production health | `/health` **200**, `/health/ready` **200**, `/api/subscription` **401** (auth-gated, correct) |
| Synced local `main` to `origin/main` @ `e004f73` | Local was stranded on the merged feature branch |
| Audited infra topology, backups, CD pipeline, billing internals | Evidence captured below |
| Corrected the stale billing section of the prior launch audit | Done (it credited the now-deprecated `conversation-limit.middleware.js`) |
| Triaged every "known issue" for safe-to-fix-now vs. defer | See §7; nothing else was safe to change pre-launch without infra/founder input |

**Engineering judgment exercised:** I deliberately did **not** churn locale files, re-enable the
DB-dependent integration tests, drop the Postgres `instagram` enum, or do surgery on the stray nested
`.git` dirs. Each is either inert, needs infrastructure I can't reach, or carries pre-launch
regression risk that outweighs its (cosmetic) value. Details and the exact remediations are in §7 so
they can be executed deliberately post-launch.

---

## 2. CTO — Architecture, code & reliability

**Bottom line:** Solid, conventional, well-tested for a solo-founder SaaS. The single material
reliability risk is that **everything runs on one droplet with no resource limits**.

- **Topology** (`docker-compose.prod.yml`): one host runs Caddy (TLS) + backend API + BullMQ worker +
  nginx SPA + **Postgres 15 + Redis 7 + Qdrant**. Inbound Meta webhooks enqueue to BullMQ and return
  `200` fast; the worker drains them (burst-coalesce → intent routing → RAG → Gemini→OpenAI failover
  with circuit breaker → confidence/safety gate → AI-attribution marker → send).
- **Single point of failure.** No HA, no managed/replicated DB. A droplet failure or a corrupt volume
  is a full outage. Acceptable for an MVP launch *if* backups are off-site (they are not yet — see CISO).
- **No per-service memory limits.** Redis is capped at 256 MB (`allkeys-lru`); **Qdrant and Postgres
  are unbounded.** Under real load on a small droplet, Postgres + Qdrant + two Node processes can
  contend and OOM-kill each other. This is the core input to the droplet-sizing question (§8).
- **Migrations are decoupled from boot** (`RUN_MIGRATIONS_ON_STARTUP=false`; CD runs `npm run migrate`
  as a discrete step), and the custom runner uses idempotent raw SQL — good, this is what prevents the
  "migration crash takes down the deploy" class of outage you hit before.
- **Test coverage gap (the one real engineering debt):** `jest.config.js` excludes **25+ integration
  tests** — including **auth**, **orders**, and the **billing usage-meter** (`usage-tracking.test.js`)
  — because they need a live Postgres/Redis that CI doesn't provide. The curated unit suite is green,
  but your **revenue path and auth path have no automated integration coverage in CI.** This is the
  highest-value post-launch engineering investment: stand up a dockerized Postgres+Redis service in
  the CI `test` job and re-enable them. *(Not a launch blocker; a launch+1 priority.)*

## 3. CISO — Security, compliance & data safety

**Bottom line:** Application security is genuinely good. The exposure is **operational**: co-located
backups and unverified secret rotation.

- **Strong, verified:** HMAC-verified Meta webhooks (timing-safe compare), Business-Login OAuth with
  **AES-256-encrypted page tokens at rest**, GDPR data-deletion + deauthorize callbacks, consent +
  24-hour-window policy engine, 2FA with token-version invalidation, platform-role admin guard +
  audit log. Reviewer docs in `.easymod/meta-app-review/`.
- **🔴 Backups are co-located with the data** (`backup.yml`): nightly `pg_dump` + uploads tarball land
  in `/opt/easymod/backups` **on the same droplet**, 7-day retention, **no off-site copy.** If the
  droplet or its volume is lost, the backups die with it. **Fix this week:** push each dump to
  DigitalOcean Spaces / S3 (object storage), guarded on a `SPACES_*` secret so it's a no-op until
  configured. This is the single most important non-Meta item before real customer data lands.
- **🟠 Secret rotation — unverified (founder must confirm).** Project history records leaked keys that
  were flagged for rotation (Resend, an OpenAI key, and the bKash credentials must be **production**,
  not sandbox). I cannot read secrets, so I cannot confirm state. **Confirm on the droplet `.env.prod`
  / GH Actions secrets:** bKash = production merchant creds; any historically-leaked key rotated;
  `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` current. Never log or echo these values.
- **Backups are unencrypted** plaintext SQL gzips on disk — acceptable on a locked-down droplet, but
  once they go off-site, enable server-side encryption on the bucket.

## 4. CFO — Revenue integrity & unit economics

**Bottom line:** The billing model is sound and now correctly wired, but it has **never charged a real
taka.** Treat the first month as a revenue-integrity test, not a steady state.

- **Charging model (PR #47):** single **Growth ৳999/mo all-in** (VAT rate set to 0 — confirm this is
  the deliberate NBR posture), 300 conversations + 50 grace; **conversations are the sole charge.**
  Partner per-delivered-order tiers exist as a second model. bKash one-time checkout per renewal (no
  recurring mandate) + bKash top-ups.
- **✅ The critical defect was fixed this cycle:** before PR #47 the conversation meter was **never
  wired into the live webhook**, so every shop read `conversations_used = 0` forever — i.e. the
  product could not have billed anyone. It is now metered idempotently at the webhook. **This is
  exactly why a live end-to-end money test is non-negotiable before launch** — the meter→invoice→bKash
  pay→reactivate loop has unit tests but zero production miles.
- **Dunning / involuntary churn:** unpaid renewal → 3-day grace → AI auto-suspends (manual inbox
  unaffected) → pay to reactivate. Reasonable. Watch the **3-day window** with real sellers — for a BD
  f-commerce audience it may be too aggressive (a seller who's slow on bKash loses their AI on day 4);
  consider widening to 5–7 days after observing real payment latency. *(tunable, not a blocker)*
- **Margin question I can't answer from code (founder/CFO to model):** ৳999 must clear the per-shop
  variable cost — OpenAI embeddings + Gemini/OpenAI LLM calls per conversation, at 300+50
  conversations/mo, plus bKash merchant fees + droplet/infra amortization. Build the one-line
  contribution-margin model before scaling acquisition; if it's thin, the grace buffer and overage
  rate (৳2.5/conv) are your levers.

## 5. COO — Operations & launch gates

**Bottom line:** Code gates are green; the operational gates are unstarted and are the real countdown.

From `LAUNCH_GATE_CHECKLIST.md` — gates 1–3 (CI / infra / data-stores healthy) ✅. Gates 4–9 are
operational and **founder-owned**:

| # | Gate | Owner | How |
|---|---|---|---|
| 4 | DLQ empty (`message-dlq` = 0) | founder | `npm run launch:check` on droplet |
| 5 | Auto-reply canary fresh | founder | same |
| 6 | Canary green 7 straight days | founder | watch ops channel for a week |
| 7 | ≥10 shops activated | founder | 10-shop onboarding smoke test |
| 8 | Alerting reaches a human (Slack/Sentry) | founder | trigger a test alert, confirm it lands |
| 9 | Shared Inbox attachment round-trip | founder | live FB tester image upload |

No code work is required to pass any of these — they are verification and pilot activities.

## 6. CPO / CMO — Product scope & positioning

**Superseded launch-scope note (2026-07-01):** use
`docs/launch/BD_LAUNCH_EXECUTION_TODOS.md` as the active BD private-launch scope.
The active public/review positioning is Facebook Messenger DM-only.

**Bottom line:** A deliberately narrow, defensible v1. Right call.

- **Facebook Pages only for direct Messenger DMs.** Instagram and Comment-to-DM were removed
  end-to-end to shrink the Meta review surface to **3 honest scopes** (`business_management`,
  `pages_read_engagement`, and `pages_manage_engagement` not requested). Multi-page connect is
  preserved. Re-enabling comments or IG later requires code plus a separate Meta App Review.
- **Bengali-first** UX for the target audience. English mode is incomplete outside the app shell
  (~200 hardcoded BN strings) — correctly deferred; it does not affect the default Bengali seller.
- The active launch story is no longer multi-channel. Position the product as a Bangla-first
  Facebook Messenger AI sales assistant for BD f-commerce sellers.

---

## 7. Known-issue register — disposition & exact remediations

Every tracked issue, with an honest call on why it was or wasn't fixed now.

| Issue | Severity | Disposition | Remediation |
|---|---|---|---|
| Off-site backups missing | 🔴 High | **Fix this week** (needs Spaces creds) | Add an `aws s3 cp`/`s3cmd put` step to `backup.yml`, guarded on `SPACES_KEY`/`SPACES_SECRET` secrets; test a restore |
| bKash creds = production? leaked-key rotation? | 🟠 Med-High | **Founder verify** (I can't read secrets) | Confirm `.env.prod` + GH secrets; rotate anything historically leaked |
| Billing path never charged real money | 🟠 Med-High | **Founder live test** | One real ৳999 renewal + one top-up through prod FE; confirm invoice → pay → AI reactivate |
| CI excludes 25+ integration tests (auth, orders, billing meter) | 🟠 Med | **Launch+1** | Add dockerized Postgres+Redis to CI `test` job; re-enable suites; rewrite `usage-tracking.test.js` TEST 5 for the soft-meter model |
| No per-service memory limits | 🟡 Med | **With droplet sizing (§8)** | Add `deploy.resources.limits` (or `mem_limit`) per service; cap Qdrant |
| 3-day dunning window may be too tight for BD | 🟡 Low-Med | **Observe, then tune** | Widen to 5–7 days after seeing real bKash payment latency |
| ~200 hardcoded Bengali strings | 🟢 Low | **Deferred (intentional)** | Migrate opportunistically when touching those screens; not a bulk pre-launch refactor |
| Dead i18n keys | 🟢 Low | **Deferred (verified-safe, queued)** | Remove `orders.createModal.{division,district,upazila}` (en.json L823–825, bn.json L875–877) and the asymmetric `manageShop.paymentSettings.contactUs*`; keep the live `orders.form.*`/"Select …" block (en.json L880–882) |
| Postgres `instagram` enum value + `linked_fb_page_id` column | 🟢 Low | **Deferred (safe to retain)** | Optional; dropping enum values on Postgres is risky — only do it with a tested migration |
| Stray nested `.git` in `EasyMod-backend/` & `EasyMod-frontend/` | 🟢 Low | **Founder (left deliberately)** | They are stale duplicate clones (old doubled-path layout, separate remote). The backend one has a `codex/fix-meta-instagram-connect` branch — check it holds nothing you want, then `rm -rf EasyMod-backend/.git EasyMod-frontend/.git`. Always run git from the repo root meanwhile |
| Vendor bundle chunks > 500 kB (`react-vendor` 620 kB, `mammoth-vendor` 497 kB) | 🟢 Info | **Informational** | Only tighten `manualChunks` if first-load latency becomes a complaint |

---

## 8. Droplet sizing recommendation

You asked whether to size up the droplet. **My recommendation: yes, ensure the production droplet is
at least 2 vCPU / 4 GB before onboarding real shops, and plan for 8 GB as Qdrant grows.** I cannot
execute the resize — there is no `doctl` or DigitalOcean API token in this environment, and resizing
requires DO dashboard/account access — so this is a **hand-off** with a concrete target and procedure.

**Why:** the single droplet co-locates Postgres 15 + Qdrant (vector DB, RAM-hungry, currently
**unbounded**) + two Node processes + Redis + nginx + Caddy. With real sellers and growing embeddings,
a 1–2 GB droplet will memory-thrash. A 4 GB floor gives headroom; 8 GB is comfortable once the vector
collection and conversation volume grow.

**Procedure (founder, or me if given a DO token / `doctl`):**
1. **Snapshot first** (DO → Droplet → Snapshots) — rollback safety.
2. Power off → **Resize** → choose a *resize-with-disk* plan ≥ `s-2vcpu-4gb` (CPU-Optimized only if
   you see sustained CPU saturation; this workload is memory-bound, so general-purpose/4 GB is the
   value pick).
3. Power on → `docker compose -f /opt/easymod/docker-compose.prod.yml up -d` → confirm `/health/ready`
   **200** and `/health/detailed` shows Postgres/Redis/Qdrant healthy.
4. **Pair the resize with the memory-limits change** (§7) so one service can't starve the others.
5. If `DEPLOY_HOST`/droplet IP changes, update the `DEPLOY_HOST` and `DO_HOST` GitHub secrets (the CD
   and backup workflows reference them).

---

## 9. Decision required from you

**Engineering's verdict: GO for launch, conditional on the founder gates.** I have taken every action
that is safe and within code's control. The launch switch is now yours to flip, gated on:

- [ ] **Meta App Review** submitted & approved (3-scope Messenger-only screencast + test roster)
- [ ] **bKash production** merchant creds confirmed + one **live ৳999 + top-up** money test passed
- [ ] **Off-site backup** wired and a restore tested
- [ ] **Operational gates 4–9** passed (`npm run launch:check`, alert test, attachment round-trip, 10-shop smoke test, 7-day canary)
- [ ] **Droplet** sized to ≥ 4 GB (recommended) + per-service memory limits

**Your call (pick one):**
1. **Proceed as sequenced** (close money + backup + droplet → submit Meta → activate on approval) — *recommended.*
2. **Submit Meta App Review first**, run the money/backup/droplet hardening during the review window (parallel-track).
3. **Hold** for a specific concern you want addressed first.

I will keep doing what's best for the app within code; the four items above genuinely require your
hands (Meta portal, bKash merchant secrets, DO account) — that's the human hand-off.

---

## Addendum — 2026-06-25 · Greeting, Closing & Social Links shipped

**Branch:** `feat/greeting-closing-social-messages` → PR to `main` (CI gate → merge → auto-deploy).
**Spec:** `docs/superpowers/specs/2026-06-25-greeting-closing-social-design.md`.

**What shipped (owner-configurable, woven into the live AI pipeline):**
- **Greeting** — auto-prepended to the **first** AI reply of each conversation. Carries a fixed,
  owner-uneditable **Meta AI-disclosure** (`Hi, I'm the AI assistant from {shop}.`,
  language-aware) followed by the owner's editable welcome text. Edited on **Chat Settings**.
- **Closing** — appended to the **order-confirmation** message (after the invoice): owner thank-you +
  a "Follow us:" block rendering only the social links that are set. Edited on **Chat Settings**;
  links live on **Business Info**.
- **Social links** — active launch UI and AI message rendering expose only Facebook and website.
  Older stored keys under `settings.businessInfo.socialLinks` are treated as legacy data.
- **Defaults seeded** for every shop (greeting + closing both on, Banglish defaults).

**Compliance posture:** the first AI reply always starts with a clear plain-text automated-assistant
declaration before any owner greeting, FAQ/product answer, order-flow response, or LLM text. There is
no icon-only marker and no owner-controlled off switch for this first-message disclosure.

**Risk:** low. **No DB migration** (`Shop.settings` is JSON; `sanitizeSettings` already preserves
`ai`/`businessInfo`). Greeting/closing injection is best-effort (failures never block a reply or
un-confirm an order). Pre-existing dead `brandingRules.greetingStyle`/`closingStyle` left in place
(unwired; superseded — noted, not refactored).

**Tests:** backend **1044/1044** jest green (new: `ai-messaging` pure builders, validators, defaults,
closing-on-confirm integration, socialLinks persistence). Frontend `vite build` green; touched unit
suites **48/48**; changed files typecheck clean. **Deploy outcome (SHA + `/health/ready`) appended on merge.**
