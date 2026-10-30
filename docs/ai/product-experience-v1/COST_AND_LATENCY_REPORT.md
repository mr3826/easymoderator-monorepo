# Cost and latency report

## Observed local route mix

The mocked production route replay processed 200 turns per pass: **140 deterministic route results (70%)** and **60 fake-model routes (30%)**. The fake model was invoked 60 times per pass (120 across the two reproducibility passes). Its unsupported price and delivery claim was blocked on all 60 model routes per pass. No real model or vision call occurred, so actual token usage and provider spend were zero.

The final production-router replay measured local route-code latency with local mocks: p50 **1.015 ms**, p95 **2.837 ms**, mean **1.301 ms** across 200 calls. This measures the local JavaScript path and mocked adapters only. It excludes DB, Redis, queue, network, provider, worker, and Messenger latency; it is not a production SLO measurement. At the automatic-send boundary, product facts, active same-shop FAQ evidence, and current operating-context facts are re-read; those reads use mocks in this replay, so their production database cost and latency are not measured. Generic non-FAQ RAG lacks a verifiable same-shop source snapshot and is held from automatic send.

## Illustrative provider pricing

Prices were checked against the official pages on 2026-10-20. The current code defaults are Gemini 3.1 Flash-Lite primary, Gemini 3.1 Pro Preview second tier, and GPT-4.1 mini final fallback. The GPT-4.1 mini page currently marks that model deprecated; no provider configuration was changed.

Assumption: **2,000 input tokens + 200 output tokens per model call**, text only, standard tier, no cache, tools, retries, images, or fallback calls.

| Model | Input / output per million tokens | Estimated per call | Estimated for 60 calls in one replay | Estimated for one synthetic 10-turn conversation* |
| --- | ---: | ---: | ---: | ---: |
| Gemini 3.1 Flash-Lite | $0.25 / $1.50 | $0.00080 | $0.048 | $0.00240 |
| GPT-4.1 mini | $0.40 / $1.60 | $0.00112 | $0.0672 | $0.00336 |
| Gemini 3.1 Pro Preview (under 200K context) | $2 / $12 | $0.00640 | $0.384 | $0.01920 |

These are estimates, not observed cost. *The 10-turn estimate uses the synthetic replay's mean of 3 fake-model calls per 10-turn persona, projected at the assumed token counts. Neither this estimate nor the 60-call figure is a representative production distribution or a monthly per-merchant estimate. Image inference, retry behavior, provider fallback, cached tokens, context length, and regional billing are excluded. Cost per successfully resolved product inquiry is not established: only one simulator turn matched a specific catalog fixture in this evidence set.

Sources: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI GPT-4.1 mini model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
