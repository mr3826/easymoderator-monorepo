# 07 — OpenAI API evaluation

## Existing compatibility

The application already calls OpenAI Chat Completions server-side through EasyMod-backend/src/modules/ai/llm.service.js. The source-default fallback model is gpt-4.1-mini. The code sends messages, temperature, and max_tokens and parses the returned text. `LLM_OPENAI_MODEL` can override that default; the effective deployed model was not observed because no production runtime configuration was available. The requested EM_OPENAI_KEY is not the variable the application reads; its current contract is OPENAI_API_KEY. The environment variable was present in the Windows user environment but absent from the process environment. No value was read, copied, or injected.

The existing model card lists Chat Completions, Responses, structured outputs, and function calling support. The current application request does not use provider-enforced structured output or tool calling. No Responses API migration is necessary for this rehearsal.

## Current model and commercial status

As checked on 2026-10-27, OpenAI marks gpt-4.1-mini deprecated and lists shutdown on 2027-01-14. Current public price is $0.40 per million input tokens, $0.10 per million cached input tokens, and $1.60 per million output tokens. The account's model entitlement, project limits, actual rate tier, and spend controls were not inspected.

A token-per-million comparison does not establish cost per valid merchant task. EasyModerator has no current live-task distribution, token sample, successful-task denominator, edit-burden measure, or quality evaluation for this model. No OpenAI call was made.

## API contract issues

- Chat Completions remains supported for this model.
- The request uses max_tokens, which the current API reference marks deprecated in favor of max_completion_tokens. This should be corrected in a separately tested compatibility change.
- Structured outputs/function calling are available at the provider level, but adding them is not required to preserve this application contract.
- The model is deprecated with a published shutdown date. Plan an owner-reviewed replacement and regression battery before 2027-01-14 if the fallback remains enabled in any AI path.
- Do not switch to a replacement based only on the provider's recommendation. Evaluate against synthetic Bangla/Banglish cases, grounding, fallback, latency, cost, and the existing application validation.

## Privacy and keys

OpenAI states API data is not used to train or improve models unless the customer opts in. Chat Completions abuse-monitoring logs can retain data for 30 days by default, with endpoint-specific exceptions; the endpoint's application-state retention is listed as none. OpenAI also states image and file inputs are scanned for CSAM and may be retained for manual review if the classifier detects potential CSAM, even when Zero Data Retention (ZDR), Modified Abuse Monitoring (MAM), or private retention with Private Safety Processing (PSP) is enabled. This is a limited safety exception, not a claim that all images are retained. The source permits customer-photo extraction to fall back to OpenAI with the image attached, so confirm the project's actual data controls and owner-approved data classes before enabling that path with real customer photos.

No key was sent to a browser, mobile app, log, screenshot, or rehearsal container. There was no live request and no OpenAI spend.

## Evidence links

- [GPT-4.1 mini model card, endpoints, features, and pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [OpenAI API deprecations and the 2027-01-14 shutdown date](https://developers.openai.com/api/docs/deprecations)
- [Chat Completions API reference, including max_tokens deprecation](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI API data controls and retention](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits)

OPENAI_API_FEASIBILITY=SOURCE_COMPATIBLE; ACCOUNT_ACCESS_AND_BILLING_UNKNOWN.
