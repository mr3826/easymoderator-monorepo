# AI runtime configuration and model lifecycle

| Field | Value |
|---|---|
| Review date | 2026-10-27 |
| Base source | `6d6bc1dd056e09202b97d05e81f20308b15109ab` |
| Rehearsal final | `c190442e955465372173deea50f6baa580d8d20c` |
| Candidate code | `04b07134c265b04745d7c3add85154b66e82f132` |

## Evidence boundary

No production `.env.prod`, provider dashboard, credential value, or live inference
was accessed for this review. The effective live provider keys, per-call model
overrides, billing state, account controls, and cost telemetry are therefore
**UNKNOWN**. The statements below describe the checked source and deployment
render contract, not production observations. Paid inference calls: **0**.

## Provider and key resolution

The source default LLM chain is Gemini Flash-Lite → OpenAI. The Gemini Pro step
is omitted from the automatic chain unless `LLM_AUTO_ESCALATE_TO_PRO=true` or a
caller explicitly requests `gemini-pro`. The CI production renderer does not
include `LLM_GEMINI_LITE_MODEL`, `LLM_GEMINI_PRO_MODEL`,
`LLM_OPENAI_MODEL`, or `LLM_AUTO_ESCALATE_TO_PRO`, so a CI-rendered environment
uses the source defaults and does not enable automatic Gemini Pro escalation.
Per-call preferred-provider arguments remain in source and are not changed by
this closure.

The source defaults are:

| Role | Source default | Render-contract conclusion |
|---|---|---|
| Primary | Gemini `gemini-3.1-flash-lite` | Used unless a per-call provider override applies. |
| Optional Gemini escalation | `gemini-3.1-pro-preview` | Not automatic in the renderer's default configuration. |
| Final automatic fallback | OpenAI `gpt-4.1-mini` | Reached after Gemini failure when an OpenAI key is available. |

`llm.service.js` reads Gemini from `EM-GEMINI-KEY` (hyphens) or the legacy
`GEMINI_API_KEY`; the workflow maps the GitHub secret
`GOOGLE_GEMINI_API_KEY` to `GEMINI_API_KEY`. The workflow maps
`OPENAI_API_KEY` from the `OPENAI_API_KEY` GitHub secret. The reported aliases
`EM_GEMINI_KEY` and `EM_OPENAI_KEY` (underscores) are not read or mapped by the
checked production workflow. No alias values were inspected or copied. Confirm
the intended secret names with the operations owner before a production release.

If the Gemini key is missing or its request fails, `chat()` advances to the
next configured provider. If the OpenAI key is also unavailable or that request
fails, the chain throws. Customer-photo extraction catches its provider failure
and returns no visual attributes. No provider call was made to verify these
failure paths.

## Image data and runtime lifecycle

The closure changes the source and production-render defaults for
`AI_PHOTO_MATCH_ENABLED` to `false` and validates only the exact strings `true`
or `false`. It also gates the separate image-plus-purchase order matcher. The
ordinary text product lookup remains available. The production renderer and
`.env.prod.example` leave `AI_VISION_ENABLED=false` by default.

When photo matching is explicitly enabled, the extraction sends an image to
Gemini first. If Gemini fails and OpenAI is configured, the existing fallback
chain can fetch and forward that image to OpenAI. `AI_VISION_ENABLED=true` is a
separate route that can also attach image blocks to the reply request. These
are source-reachability conclusions; the closure made no image transfer.

The resolver reads `process.env` on each request, but production configuration
is injected when the backend and worker processes start. An operator changing
the setting must replace or restart both processes. That does not cancel an
extraction already in flight. New queued work is evaluated using the receiving
worker's environment after restart.

## Usage and cost telemetry

`AI_USAGE_ACCOUNTING` is off unless exactly `true`. When enabled, the usage
recorder emits structured token/model/cost metadata and omits prompt bodies,
replies, provider credentials, and customer PII. The production renderer does
not include the setting, so its default is off. Live production telemetry state
is **UNKNOWN** because the deployment environment was not inspected. No usage
record from a live provider call exists for this closure.

## Retirements and stale model references

As of the review date, the official provider lifecycle pages report:

| Reference | Source reachability | Current lifecycle and disposition |
|---|---|---|
| OpenAI `gpt-4.1-mini` | Default final fallback in `llm.service.js`. | Deprecated on 2026-10-14; API shutdown is scheduled for 2027-01-14. Keep the current route for this closure. Plan an owner-approved migration and compatibility review before that date. |
| Gemini `gemini-3.1-flash-lite` | Default primary model in `llm.service.js`. | Stable model; earliest shutdown date is 2027-05-07. Google lists `gemini-3.5-flash-lite` as replacement. Schedule a later migration review. |
| Gemini `gemini-3.1-pro-preview` | Optional escalation model. | Preview model; no shutdown date is currently listed. Do not enable automatic escalation as part of this closure. |
| Gemini `gemini-2.0-flash` | Retired model IDs remain in the unreferenced `llm-tier-selection.service.js` and in tests/pricing metadata. The current cache path resolves its default from the live primary model instead. | Shut down 2026-06-01. The tier-selection service has no runtime callers in the inspected source. Preserve the references for this audit; schedule separate cleanup with owner approval. |
| Gemini `gemini-1.5-flash` / `gemini-1.5-pro` | The voice-transcription route calls `gemini-1.5-flash`; the shop model allowlist and unreferenced tier map contain 1.5 IDs. | Gemini 1.5 models were shut down 2025-09-29. The voice route is a reachable API path, but voice transcription is outside this pilot's approved exercise. Keep it out of the pilot and require a separate migration or disablement decision before enabling it. |

OpenAI's model page currently marks GPT-4.1 Mini deprecated and lists its
snapshot; its deprecation schedule names `gpt-6-luna` as the replacement for the
2027-01-14 shutdown. Gemini's deprecation page lists the stable and preview
shutdown dates above. These provider pages can change and must be checked again
before a later model migration:

- [OpenAI GPT-4.1 Mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [OpenAI API deprecations](https://developers.openai.com/api/docs/deprecations)
- [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Gemini 3.1 Flash-Lite model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Gemini 3.5 Flash-Lite model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Gemini API release notes](https://ai.google.dev/gemini-api/docs/changelog)

## Migration plan

1. Before 2027-01-14, the owner selects an approved OpenAI replacement and
   approves any associated provider terms, budget, and customer-data handling.
2. In a separate change, add an explicit model setting to the renderer and
   example environment, or update the source default. Keep the automatic
   fallback ordering unchanged unless separately approved.
3. Run provider-mocked compatibility tests over the existing synthetic product,
   policy, order, and Banglish fixtures. Review response shape, refusal/error
   mapping, token cap, timeout, fallback behavior, and cost metadata. Do not use
   customer messages or perform paid inference without a separate approval.
4. Deploy only after a reviewed, authorized release. Keep a rollback path to a
   still-supported model; do not roll back to `gpt-4.1-mini` after the vendor
   shutdown.
5. Recheck Gemini lifecycle before 2027-05-07 and use the same synthetic,
   provider-mocked compatibility process before any later migration.
6. Separately decide whether to disable or migrate the reachable voice
   transcription endpoint that references the already-shut-down Gemini 1.5
   model, and remove stale tier/allowlist model IDs only in a scoped follow-up.

**Lifecycle verdict:** source defaults are identifiable; production overrides
and live provider access remain unknown. Official lifecycle pages were checked
on 2026-10-27. The primary Gemini model has a published 2027-05-07 earliest
shutdown date. The OpenAI fallback is deprecated with a 2027-01-14 shutdown
date. No model migration was made.
