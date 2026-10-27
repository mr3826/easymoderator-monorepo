# 09 — Provider cost, privacy, and decision

## Cost evidence

Public prices checked on 2026-10-27 for the source-default models. Effective deployed model IDs were not verified; model environment variables can override these defaults.

| Provider/model | Input per 1M tokens | Cached input per 1M | Output per 1M | Account status |
|---|---:|---:|---:|---|
| Gemini 3.1 Flash-Lite | $0.25 text/image/video; $0.50 audio | $0.025 text/image/video caching, where applicable | $1.50 | Paid tier and entitlement UNKNOWN |
| Gemini 3.1 Pro Preview, under 200k input | $2.00 | Not used for estimate | $12.00 | Paid tier and entitlement UNKNOWN |
| Gemini 3.1 Pro Preview, over 200k input | $4.00 | Not used for estimate | $18.00 | Paid tier and entitlement UNKNOWN |
| OpenAI GPT-4.1 mini | $0.40 | $0.10 | $1.60 | Billing, tier, limits UNKNOWN |

A simple illustrative one-million-input/one-million-output token total would cost $1.75 on Flash-Lite and $2 on GPT-4.1 mini before retries, caching effects, image/audio tokenization, and any other service charges. If the input is divided among requests each below 200k tokens, the same total would cost $14 on Pro; a single request above 200k input is priced at the higher tier ($4 input and $18 output per million). These are token arithmetic examples, not merchant-task estimates. The Pro threshold is per request, not the aggregate monthly token count.

No reliable cost per valid completed task can be calculated. Source review found AI_USAGE_ACCOUNTING is off by default; existing usage recording is success-only and lacks consistent caller/merchant task context, and some cost values can be null. Actual provider usage, success rate, retries, merchant edits, and task completion are unknown. No per-merchant cap was proven. Vendor account limits/budgets were not inspected.

The repository's cost artifacts conflict on customer-photo inference: `AI_COST_ASSUMPTIONS.md` revision 2026-08-03 models approximately $0.0008 per expected conversation for three photo messages and says matching shipped ON; `AI_COST_AUDIT.md` §0 revision 2026-07-28b says no AI vision and no image-token cost. The rehearsal source confirms a separate default-on photo-extraction flag, so the July audit's zero-photo claim is stale for this code SHA. The later estimate is a scenario, not verified deployed economics. Its synthetic Gemini measurement of approximately 1,064 image tokens implies about $0.000266 of image input per photo at the current published paid-tier Flash-Lite price of $0.25 per million tokens, excluding text/output, retries, or fallback. Effective model, account tier, and provider mix are unknown. Reconcile the audit and generated artifacts against the deployed source/config and observed usage before using them for pricing or spend decisions.

`AI_USAGE_ACCOUNTING` is off by default and usage records are emitted after provider responses, so failed calls and any billed usage from them can be absent. No aggregate or per-merchant provider-spend cap was found. The `AI_MAX_COST_PER_ORDER_CREATED_USD` mutation check is separate from provider inference spend and is not a spend cap.

## Data handling

- OpenAI API data is not used for training by default unless the customer opts in. Standard abuse-monitoring logs can retain prompts/responses for up to 30 days. Endpoint-specific application state and retention rules still matter.
- Gemini unpaid service may use submitted prompts/responses for product improvement and human review. Paid service avoids product-improvement use under the API terms, but limited abuse logs can still apply.
- Actual billing tier, data processing terms, regional settings, retention controls, and project budgets were not verified for either key.
- The rehearsal made zero provider requests and used no merchant/customer content. AI_PROVIDER_OBSERVED_SPEND=0 for this rehearsal; no inference budget or billing authorization was verified.

## Customer-photo provider transfer

The source-default `AI_PHOTO_MATCH_ENABLED` is true. Customer-photo extraction sends an `image_url` through the shared LLM chain; if Gemini fails and the source-contract OpenAI key is usable, the OpenAI fallback can receive the image. This is source reachability only: no image or other customer data was sent during this rehearsal, and `liveInference=NOT_RUN`. OpenAI's [data controls](https://developers.openai.com/api/docs/guides/your-data) state that Chat Completions abuse-monitoring logs are retained for 30 days by default and that image/file inputs are scanned for CSAM; if a classifier flags potential CSAM, the image may be retained for manual review even when Zero Data Retention, Modified Abuse Monitoring, or private retention with Private Safety Processing is enabled. This is a limited safety exception, not a general image-retention claim.

Before any pilot that processes real customer photos, confirm both providers' image-data terms, account controls, source-contract access, and owner authorization for that data transfer. Keep `AI_PHOTO_MATCH_ENABLED=false` until those conditions are met. If policy requires customer images to remain Gemini-only, change the source to exclude OpenAI from image-bearing calls and add a synthetic regression test; current tests do not cover Gemini image failure followed by an OpenAI image request.

The `LLM_*_MODEL` settings can override source defaults. `.env.prod` was absent from the checked worktrees, and no running environment was available to inspect; effective deployed model IDs are UNKNOWN. Existing AI cost documentation disagrees about `.env.prod` contents, so no provider model is claimed as the effective production model.

## Recommendation

AI_PROVIDER_FINAL_DECISION=KEEP_CURRENT_PROVIDER_CONFIGURATION.

Do not add an AI router, SDK, or provider. The source already supports both providers, the user's keys were not validated for access, no authorized inference budget was evidenced, and no task-level quality/cost experiment was justified.

Before an AI-enabled merchant pilot:

1. Confirm Gemini is paid-tier for the exact project and review its data processing/abuse logging terms before any customer data is sent.
2. Confirm OpenAI project access, spending limit, retention controls, and allowed data classes.
3. Keep customer photo matching off until owner approval and both providers' image-data handling are confirmed; if OpenAI image fallback is not approved, require a Gemini-only source path and regression test.
4. Verify effective production model IDs and overrides before assessing live provider suitability.
5. Plan and test a replacement for GPT-4.1 mini before its 2027-01-14 shutdown if the fallback remains enabled.
6. Review legacy Gemini 1.5 Flash and 2.0 Flash source paths; those model IDs are shut down.
7. Measure successful grounded tasks, token usage, retry rate, latency, merchant edits, and cost per valid completion before selective routing or a pricing optimization.
8. Keep deterministic order, payment, delivery, consent, and Meta authorization gates independent of any model output.

These are preparation steps; they do not authorize a model switch, a new subscription, paid calls, or customer-data transfer.
