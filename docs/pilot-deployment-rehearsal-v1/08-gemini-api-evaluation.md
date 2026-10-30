# 08 — Gemini API evaluation

## Existing compatibility

The application already calls Gemini generateContent directly through EasyMod-backend/src/modules/ai/llm.service.js. The main LLM contract reads EM-GEMINI-KEY or GEMINI_API_KEY. The requested EM_GEMINI_KEY was present in the Windows process and user environment. The bootstrap preflight transiently read it in memory only to compare it against the ignored rehearsal env file; it was not printed, persisted, mapped to either source-contract variable, or passed into the rehearsal. No live request was made.

The source defaults are gemini-3.1-flash-lite primary and gemini-3.1-pro-preview for explicit high-stakes use or configured escalation. Automatic Pro escalation is not the default. `LLM_GEMINI_LITE_MODEL` and `LLM_GEMINI_PRO_MODEL` can override these IDs. The effective deployed model was not observed because `.env.prod` was absent from the checked worktrees and no runtime configuration was available. The application sends prompt content and temperature 0.3; it does not request JSON schema output or tool calls in this main path. The current Gemini model cards support structured outputs and function calling, but those features are not needed to satisfy this existing contract.

## Model lifecycle findings

As checked against Google's model cards and deprecation table on 2026-10-27:

- gemini-3.1-flash-lite is listed as stable/GA and is scheduled for shutdown no earlier than 2027-05-07; Google lists gemini-3.5-flash-lite as its replacement.
- gemini-3.1-pro-preview remains a preview model with no shutdown date currently listed. Preview models can have shorter retirement notice and should not be the only production path.
- The voice-processing controller/service still references gemini-1.5-flash. Google's release notes say Gemini 1.5 Flash was shut down on 2025-09-29. If that source path is reachable, voice processing is not API-feasible until a separately tested model update.
- Legacy tier-selection source still contains gemini-2.0-flash. Google's deprecation table lists that model as shut down on 2026-06-01. Reachability/traffic was not proven, so this is a source inventory risk, not a live outage claim.
- The embedding service uses gemini-embedding-2, which the current model page lists as stable and the deprecation table lists with no shutdown date.

The current Gemini 3 developer guide recommends keeping temperature at 1.0 and warns that lower values may cause looping or degraded performance. EasyModerator sends 0.3 in its shared path. No change was made because behavior has not been measured on the application's synthetic Bangla/Banglish contract set. This is a targeted validation item, not grounds for an unmeasured production change.

## Billing, rate limits, and privacy

The paid Gemini 3.1 Flash-Lite price is $0.25 per million text/image/video input tokens, $0.50 per million audio input tokens, and $1.50 per million output tokens. Gemini 3.1 Pro Preview is $2/$12 per million input/output tokens below 200,000 input tokens, and $4/$18 above that threshold. Actual project entitlement, paid/free tier, model access, and per-project limits remain unknown.

Google's terms distinguish unpaid quota from paid service. For unpaid service, submitted prompts and responses may be used to improve products and may be reviewed by humans. With an active billing account linked to the Gemini API project, paid-service prompts/responses are not used to improve products and are processed under Google's data processing terms; limited abuse-monitoring logs may still apply. Paid status is not equivalent to zero retention.

No budget, tier, or account setting was verified. Do not send customer transcripts, photos, audio, or personal data until billing tier and data processing are confirmed for the actual project.

## Evidence links

- [Gemini 3.1 Flash-Lite model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Gemini 3.1 Pro Preview model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview)
- [Gemini model deprecations and replacement schedule](https://ai.google.dev/gemini-api/docs/deprecations)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API billing and tiers](https://ai.google.dev/gemini-api/docs/billing)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [Gemini 3 temperature guidance](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

GEMINI_API_FEASIBILITY=SOURCE_COMPATIBLE_FOR_MAIN_LLM; EFFECTIVE_DEPLOYED_MODEL_UNKNOWN; PROJECT_ACCESS_AND_PAID_TIER_UNKNOWN.
