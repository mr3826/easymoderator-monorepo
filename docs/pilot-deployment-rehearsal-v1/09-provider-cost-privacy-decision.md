# 09 — Provider cost, privacy, and decision

## Cost evidence

Public prices checked on 2026-10-27:

| Provider/model | Input per 1M tokens | Cached input per 1M | Output per 1M | Account status |
|---|---:|---:|---:|---|
| Gemini 3.1 Flash-Lite | $0.25 text/image/video; $0.50 audio | $0.025 text/image/video caching, where applicable | $1.50 | Paid tier and entitlement UNKNOWN |
| Gemini 3.1 Pro Preview, under 200k input | $2.00 | Not used for estimate | $12.00 | Paid tier and entitlement UNKNOWN |
| Gemini 3.1 Pro Preview, over 200k input | $4.00 | Not used for estimate | $18.00 | Paid tier and entitlement UNKNOWN |
| OpenAI GPT-4.1 mini | $0.40 | $0.10 | $1.60 | Billing, tier, limits UNKNOWN |

A simple illustrative one-million-input/one-million-output token total would cost $1.75 on Flash-Lite and $2 on GPT-4.1 mini before retries, caching effects, image/audio tokenization, and any other service charges. If the input is divided among requests each below 200k tokens, the same total would cost $14 on Pro; a single request above 200k input is priced at the higher tier ($4 input and $18 output per million). These are token arithmetic examples, not merchant-task estimates. The Pro threshold is per request, not the aggregate monthly token count.

No reliable cost per valid completed task can be calculated. Source review found AI_USAGE_ACCOUNTING is off by default; existing usage recording is success-only and lacks consistent caller/merchant task context, and some cost values can be null. Actual provider usage, success rate, retries, merchant edits, and task completion are unknown. No per-merchant cap was proven. Vendor account limits/budgets were not inspected.

## Data handling

- OpenAI API data is not used for training by default unless the customer opts in. Standard abuse-monitoring logs can retain prompts/responses for up to 30 days. Endpoint-specific application state and retention rules still matter.
- Gemini unpaid service may use submitted prompts/responses for product improvement and human review. Paid service avoids product-improvement use under the API terms, but limited abuse logs can still apply.
- Actual billing tier, data processing terms, regional settings, retention controls, and project budgets were not verified for either key.
- The rehearsal made zero provider requests and used no merchant/customer content. AI_PROVIDER_OBSERVED_SPEND=0 for this rehearsal; no inference budget or billing authorization was verified.

## Recommendation

AI_PROVIDER_FINAL_DECISION=KEEP_CURRENT_PROVIDER_CONFIGURATION.

Do not add an AI router, SDK, or provider. The source already supports both providers, the user's keys were not validated for access, no authorized inference budget was evidenced, and no task-level quality/cost experiment was justified.

Before an AI-enabled merchant pilot:

1. Confirm Gemini is paid-tier for the exact project and review its data processing/abuse logging terms before any customer data is sent.
2. Confirm OpenAI project access, spending limit, retention controls, and allowed data classes.
3. Plan and test a replacement for GPT-4.1 mini before its 2027-01-14 shutdown if the fallback remains enabled.
4. Review legacy Gemini 1.5 Flash and 2.0 Flash source paths; those model IDs are shut down.
5. Measure successful grounded tasks, token usage, retry rate, latency, merchant edits, and cost per valid completion before selective routing or a pricing optimization.
6. Keep deterministic order, payment, delivery, consent, and Meta authorization gates independent of any model output.

These are preparation steps; they do not authorize a model switch, a new subscription, paid calls, or customer-data transfer.
