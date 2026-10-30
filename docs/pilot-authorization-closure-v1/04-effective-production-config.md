# 04 — Effective production configuration, redacted (Gate D)

## The photo-matching question the mission asks

An earlier rehearsal found the photo-matching source default ON while labs forced it OFF. **Determined from the frozen candidate itself (no assumption):** the mismatch is CORRECTED in `04b07134`.

- `src/modules/ai/vision-policy.service.js:40` — `photoMatchEnabled = () => process.env.AI_PHOTO_MATCH_ENABLED === 'true'` → unset is OFF; only the exact literal `true` opts in; header comment `:7` "default OFF" and it names the exact image-forwarding concern (Gemini-first, provider chain may forward the image to OpenAI).
- Regression-pinned: `intent-router.test.js:1375` ("an unset photo flag fails closed without sending the image to a provider"), `:1391` ("a non-literal runtime photo flag `'TRUE'` also fails closed"), `gemini-first-routing.test.js:257` (non-literal photo values disabled), plus explicit disabled-behavior tests in `order-flow.service.test.js:475,490`.
- `visionEnabled` (same file) is the identical strict-literal pattern; the supersession trail is documented in the closure docs (`docs/operational-gate-closure-v1/README.md`); the pilot-rehearsal-era `05-owner-decisions` line "defaults true" is stale against this candidate and is corrected in `06`.

The supplemental privacy condition still stands as a forward requirement for any future enablement (image-data classes, provider terms, OpenAI image-fallback approval, gated text-RAG order selection) — that is a D-package item, not a current flag state.

## Redacted effective-configuration table

`SOURCE_DEFAULT` is the candidate code behavior; `REHEARSAL_RUNTIME` is the isolated closure stack (production NODE_ENV, inspected via safe runtime probes on 2026-10-27 and re-attested by `alert-recovery-harness preflight` 2026-10-30); `PRODUCTION_EFFECTIVE` requires authorized droplet env inspection and is **UNKNOWN — not inferred from code** per mission rule.

| SETTING | SOURCE_DEFAULT (candidate) | DEPLOYMENT_OVERRIDE / REHEARSAL_RUNTIME | EFFECTIVE_VALUE (production) | SIDE_EFFECTS IF ON | OWNER | VERIFICATION_STATUS |
|---|---|---|---|---|---|---|
| `AI_PHOTO_MATCH_ENABLED` | **OFF** — literal `'true'` only, fail-closed (`vision-policy.service.js:40`) | renderer passes `false`; rehearsal runtime false | UNKNOWN | customer image → Gemini/OpenAI chain; photo-driven order selection | Founder + AI-platform owner | SOURCE_VERIFIED + REHEARSAL_VERIFIED; PRODUCTION_PENDING |
| `AI_VISION_ENABLED` | OFF — literal-only (`vision-policy.service.js`) | false in rehearsal | UNKNOWN | image blocks to provider | same | as above |
| `DOMAIN_AGENT_RUNTIME_ENABLED` (parent kill) | OFF in production (`ai-runtime-flags.js:26-31`: unset→`NODE_ENV!=='production'`; dev-only fallback ON) | renderer false; kill-switch rehearsal denied `CREATE_ORDER` with `runtime_kill_switch_enabled` + audit row | UNKNOWN | all AI agent actions | Security (per AGENT_ACTION_POLICY §11 ownership table) | SOURCE_VERIFIED + REHEARSAL_VERIFIED |
| `AI_ORDER_MUTATIONS_ENABLED` | OFF in production (same helper; every mutating action type without a mapped flag is DENIED by construction, `:3-7,36-37`) | false; `config.js` | UNKNOWN | create/edit/cancel orders via AI | Order Engineering + Product | SOURCE_VERIFIED + REHEARSAL_VERIFIED |
| `AI_COURIER_BOOKING_ENABLED` (webhook auto-booking) | OFF in production (same) | false; verified paid webhook → `automation_disabled`, manual dispatch (AGENT_ACTION_POLICY §11) | UNKNOWN | courier bookings | CommerceOps | SOURCE_VERIFIED + POLICY_PINNED |
| `AI_PAYMENT_ACCEPTANCE_ENABLED` | OFF in production | false | UNKNOWN | payment acceptance mutations | Payment owner | SOURCE_VERIFIED |
| `AI_SUPPORT_CASE_ENABLED` | OFF in production | false | UNKNOWN | support-case creation | Support owner | SOURCE_VERIFIED |
| `MOBILE_API_ENABLED` | OFF — literal `'true'` only (`config.js:43`) | false | UNKNOWN | mobile API surface (photo-upload gap D-5) | Mobile owner | SOURCE_VERIFIED |
| `GROWTH_OS_ENABLED`, `TELEGRAM_ENABLED`, `BKASH_ENABLED`(+`BKASH_SANDBOX`), `META_USER_PROFILE_ENABLED`, `LLM_AUTO_ESCALATE_TO_PRO` | false-by-env in rehearsal (closure compose `:72-84`) | all false in rehearsal runtime inspection | UNKNOWN | growth ops, telegram sends, bKash, profile fetch, pro-cost escalation | respective owners | REHEARSAL_VERIFIED |
| `START_EMBEDDED_WORKERS` / `RUN_MIGRATIONS_ON_STARTUP` | false / false (compose `:33-34`; prod compose runs separate worker) | n/a | UNKNOWN | accidental dual workers / auto-migration | SRE | SOURCE_VERIFIED |
| Alert config | production validator refuses boot without `SENTRY_DSN` OR `SLACK_ALERT_WEBHOOK_URL` (`production-config.validator.js:219-220`) | rehearsal: Slack→local sink only, Sentry empty | names UNKNOWN | none (fail-closed boot) | Ops (D-3) | SOURCE_VERIFIED |
| Provider/model selection | source primary `gemini-3.1-flash-lite`, fallback `gpt-4.1-mini` (closure `ai-runtime-and-model-lifecycle.md`); keys: env names `GEMINI_API_KEY`/`OPENAI_API_KEY` only — values never read | rehearsal used non-credential markers; 0 paid calls across all milestones | live key mapping UNKNOWN | AI spend; lifecycle dates 2027-01-14 (OpenAI) / earliest 2027-05-07 (Gemini) | Founder/AI owner | SOURCE_DOC_VERIFIED; PRODUCTION_PENDING |
| `PRODUCTION_DEPLOY_ENABLED` | GitHub Actions **repository variable**, not app env (`ci-cd.yml:942`) — the human gate required by `CONTRIBUTING-AI.md` §3 | n/a | UNKNOWN (owner console) | enables the deploy job | Founder | SOURCE_VERIFIED |

## Disposition

- Every risky mutation surface is **fail-closed at source in production mode**, strict-literal, independently verified by focused regression tests already attested in the frozen candidate (flag matrix 5 suites/32 tests; security suite 58/817). The dev-only unset fallback (`NODE_ENV!=='production'`) is deliberate lab ergonomics and cannot affect a production render; it is recorded here so nobody mistakes it for a production default.
- **No production values were inferred.** Missing permission to read the droplet's effective environment is blocker B-4 (`00` ledger): the owner-side safe action is a redacted `docker compose --env-file .env.prod config` name/value dump of only the rows above, or `printenv` of exactly these variables, with secrets masked.
- No source correction was required (the photo-matching fail-closed correction is already the frozen candidate), so no isolated correction branch was created.

`EFFECTIVE_CONFIGURATION=PARTIAL` — source and rehearsal-verified fail-closed defaults PASS with file:line and runtime evidence; production-effective attestation awaits authorized inspection (B-4, owner item 4 in `08`).
