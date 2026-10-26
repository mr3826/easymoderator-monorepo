# 11 — Founder GO / NO-GO

## Decision

**Rehearsal: PARTIAL. Production release: NO-GO pending owner authorization and blocked runtime evidence.**

This run improved the local candidate and verified host-side source behavior. It did not deploy a stack, run a migration, demonstrate database/worker recovery, exercise the kill switches in a running app, or verify an alert reached an operator. No real provider call or merchant activity occurred.

## What this run proved

- The isolated branch is based on the verified frozen documentation tip and remains separate from the original candidate.
- A numeric reply could reach a choice proposal still in GENERATED state even though the worker only marks it SENT after delivery. The code now resolves only SENT proposals, rechecks the per-shop interaction feature before dispatch, and skips the worker fallback/send if the flag is disabled.
- Focused interaction/worker tests, the backend security suite, frontend unit tests/build, standalone child lockfile dry-run, production env render, and Compose manifest parse passed.
- The standalone frontend production build context had an incomplete lockfile. The missing axe-core entries were added in commit 714be007 and its standalone npm dry-run passed.
- Production-default commerce mutation flags are defined as false. The local synthetic environment explicitly sets them false. The optional image-matching path is separately disabled locally even though the production renderer currently defaults it true.

## What remains unproved

- No final app image digest, container startup, health endpoint, authentication, queue state, webhook receipt, clean shutdown, or restart.
- No fresh Postgres/Redis integration, Meta-shaped E2E, production-shaped migration dry-run, partial migration failure, concurrent migration, backup restore, worker crash, Redis disruption, or pending-job replay.
- No runtime kill-switch exercise or synthetic monitoring alert receipt.
- No independent final system verifier. The current code reviewer only attested the narrow interaction patch; prior c164a042 attestation is historical.
- No provider billing/tier, model entitlement, project spend limit, or live task quality evidence. The user keys were never used.
- No merchant cohort was selected, no Meta Human-Agent eligibility confirmed, and no production flag or rollout authorized.

The Docker Desktop metadata store returned I/O errors and a read-only filesystem; C: had 0 bytes free. No user data was deleted and no existing service was intentionally stopped. This is why the deployment, database, migration, runtime kill-switch, alert, and full independent-attestation gates are blocked or not run.

## Provider decision

Keep the current provider configuration for this rehearsal and do not add routing infrastructure or make an automatic provider switch. OpenAI GPT-4.1 mini is already deprecated and has a published 2027-01-14 shutdown, so schedule a tested replacement before then if this fallback remains enabled. Gemini 3.1 Flash-Lite is currently listed as stable with a 2027-05-07 earliest shutdown; the Pro fallback is preview. Legacy source paths still reference Gemini 1.5 Flash and 2.0 Flash, which Google's current lifecycle pages list as shut down. See 07-09 for price, billing, privacy, and lifecycle evidence.

## One founder decision package

Please resolve D-1 through D-7 together as listed in 05-owner-decisions-d1-d7.md:

- D-1: select or defer the 3–5 shop cohort and name coverage.
- D-2: confirm Meta review eligibility and close the app contact/support/data-deletion metadata gaps.
- D-3: name the alert channel, dashboard, and on-call owner; accept a synthetic alert receipt test.
- D-4: name switch operators and second approver; keep mutation switches off.
- D-5: accept the missing mobile upload endpoint and keep mobile API disabled.
- D-6: accept or defer V6/Phase-D debt while preserving the reviewed Inbox draft and reply-window guarantees.
- D-7: keep webhook auto-booking off and use manual dispatch for the pilot.

This package does not authorize production release. Reopen the release decision only after Docker storage and host space recover, blocked gates are run against the pinned source, the final reviewer attests the actual tested SHA, and the founder resolves the owner decisions.

## Founder preview

Open the local folder D:\easymod\_rehearsal-pilot-deployment-v1\docs\pilot-deployment-rehearsal-v1 in Codex to review this handoff. The static rehearsal manifest is in docker-compose.rehearsal.override.yml and Caddyfile.rehearsal. There is no running application preview from this rehearsal.

Final source code SHA: 714be0072b6c8a8bba181dbe814e284c3b342ffe.
Frozen documentation SHA: d5dbd21620a0b25b6c57763c2214a95c811c2fbb.
The final evidence commit SHA is reported in the handoff; it is documentation-only after the code SHA above.
