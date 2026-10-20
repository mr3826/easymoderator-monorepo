# Playwright E2E Report

## Execution

Status: **PASS**. Playwright executed 2 Chromium tests with zero retries and zero failed tests. Receipt: `artifacts/playwright/execution.json`; HTML report: `artifacts/playwright/html-report/index.html`; trace archives: `artifacts/playwright/test-results/`; screenshots: `artifacts/playwright/screenshots/`.

The main journey verified the running Lab shell and health state, 20 personas and 200 sanitized source turns, P01 scenario search/filter, known and unknown evidence inspection, a ten-turn candidate replay and separate ten-turn baseline replay, full baseline and candidate 200-turn replay receipts, distinct pinned run IDs and dataset hashes, same-source comparison, cost labeling for mocks, failure triage and rerun, run history, JSON export parseability, Playground product and follow-up context, tenant reset, image fixture handling without claiming vision, session reset, accessible input labels, keyboard tab navigation, console errors, and no critical horizontal overflow at 1440, 1024, 768, and 390 pixel widths. The replay UI shows a privacy marker in place of free-text response; responses are scored in memory and omitted from saved receipts and exports.

The second test opened the actual local Lab shell and checked its nine-section navigation in every installed browser engine. Chromium was installed; Firefox and WebKit executables were unavailable. The full workflow ran only in Chromium.

## Accessibility and artifact limitations

Automated checks cover accessible names for inputs, tab semantics/keyboard navigation, visible controls, and responsive overflow. `axe-core` was not installed, so no axe scan or full accessibility certification is claimed. The three saved screenshots are `chromium-startup.png`, `chromium-scenario-explorer.png`, and `chromium-conversation-replay.png`. Both traces are available as `trace.zip` under the corresponding test result folders.

The regenerated trace and HTML-report archives (four archives total) were checked against 197 CSV customer-message values of at least 12 characters; exact-match count was 0. They include the Playwright test source, which contains the names of fields that the privacy assertions prohibit; those are test-code identifiers, not source-row values. The Scenario Explorer screenshot shows only IDs, classifications, input-type/language labels, and source-presence metadata. The Conversation Replay screenshot shows the generic privacy marker, not response text.

The browser test covers local mock/synthetic behavior. Its image fixture is not a raster vision evaluation, and its run status is not proof of live product accuracy by itself.
