# Playwright E2E Report

## Execution

- Receipt: `artifacts/playwright/execution.json`.
- Run: `0a2e2320-569e-479d-9878-2a40030a0519`.
- Source revision: `dd04c079f2b752725d372e879cb1549a8459b8d1`.
- Local URL during the run: `http://127.0.0.1:3411`.
- Result: 6/6 tests passed; two journeys (full workflow and shell smoke) in each of Chromium, Firefox, and WebKit.
- Browser observations: 0 page errors, 0 console errors, and 0 failed requests across the six runs.
- Axe: zero serious/critical violations across nine Lab sections in each engine. Automated axe coverage is not a full accessibility audit.

## Coverage and limits

The run exercised the local Lab journeys, source metadata/scenario view, replay and export flow, route comparison, evidence/cost/triage/navigation surfaces, and responsive controls as represented by the Playwright receipt. Candidate provenance is current for this browser run. The receipt says `realGeminiTraceUi=false`; it did not replay or load the real-Gemini trace inside this execution. Separate saved trace crops show the actual redacted Gemini candidate and validated reply.

Twelve browser PNG screenshots were visually inspected. Raster inspection was visual, not OCR; the privacy report counts 17 standalone raster artifacts as not OCR-scanned. Raw trace archives are excluded; sanitized archives remain with their raster members removed. Browser output establishes local UI behavior only, not factual AI quality.

## Timing correction

An earlier WebKit export check expired because its download-event waiter began before slow navigation and axe scans. The waiter now starts immediately before the export click. The corrected three-engine run passed without page, console, or request failures.
