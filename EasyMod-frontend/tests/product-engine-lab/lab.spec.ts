import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshotRoot = resolve(process.cwd(), '../docs/ai/product-experience-v1-1/artifacts/playwright/screenshots');
const runUuid = (value: string) => value.match(/[a-f0-9]{8}-[a-f0-9-]{27}/i)?.[0] || '';
mkdirSync(screenshotRoot, { recursive: true });

const startUiRun = async (page: import('@playwright/test').Page, buttonName: string, timeoutMs = 180_000) => {
  const summary = page.locator('#active-run-summary');
  const previousId = runUuid(await summary.textContent() || '');
  await page.getByRole('button', { name: buttonName }).click();
  await expect.poll(async () => runUuid(await summary.textContent() || ''), { timeout: 15_000 }).not.toBe(previousId);
  await expect(summary).toContainText('completed', { timeout: timeoutMs });
  return runUuid(await summary.textContent() || '');
};

const selectComparisonRuns = async (page: import('@playwright/test').Page, baselineId: string, candidateId: string) => {
  const baseline = page.locator('#baseline-run');
  const candidate = page.locator('#candidate-run');
  await expect(baseline.locator(`option[value="${baselineId}"]`)).toHaveCount(1, { timeout: 30_000 });
  await expect(candidate.locator(`option[value="${candidateId}"]`)).toHaveCount(1, { timeout: 30_000 });
  await baseline.selectOption(baselineId);
  await candidate.selectOption(candidateId);
  await expect(baseline).toHaveValue(baselineId);
  await expect(candidate).toHaveValue(candidateId);
};

test('local Test Lab journeys, data boundaries, run history, and responsive controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The complete replay workflow is run once in Chromium; alternate browsers receive shell smoke coverage.');
  mkdirSync(screenshotRoot, { recursive: true });
  const pageErrors: string[] = [];
  const accessibilitySections: Array<{ section: string; violations: Array<{ id: string; impact: string | null; help: string; helpUrl: string; targets: string[][] }> }> = [];
  const inspectAccessibility = async (section: string) => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    accessibilitySections.push({
      section,
      violations: result.violations.map(violation => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        targets: violation.nodes.map(node => node.target.map(String)),
      })),
    });
  };
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/Founder Test Lab/);
  await expect(page.locator('#service-status')).toContainText('ready');
  await expect(page.locator('#dataset-stats')).toContainText('20');
  await expect(page.locator('#dataset-stats')).toContainText('200');
  await inspectAccessibility('Overview');

  const available = await page.evaluate(async () => {
    const response = await fetch('/__lab/api/dataset');
    const data = await response.json();
    return { status: response.status, personas: data.personas.length, turns: data.source.scenarioCount, json: JSON.stringify(data) };
  });
  expect(available).toMatchObject({ status: 200, personas: 20, turns: 200 });
  expect(available.json).not.toMatch(/customerMessage|simulatedAttachment|expectedAnswer|sourceHash/i);

  await page.getByRole('tab', { name: /Scenario Explorer/ }).click();
  await inspectAccessibility('Scenario Explorer');
  await page.locator('#scenario-persona').selectOption('P01');
  await page.getByRole('button', { name: 'Load scenarios' }).click();
  await expect(page.locator('#scenario-results tbody tr')).toHaveCount(10);
  await page.locator('#scenario-search').fill('scenario-01-03');
  await expect(page.locator('#scenario-results tbody tr')).toHaveCount(1);
  await expect(page.locator('#scenario-results')).toContainText('scenario-01-03');
  await page.locator('#scenario-search').fill('');
  const classification = await page.locator('#scenario-filter option').nth(1).getAttribute('value');
  if (classification) {
    await page.locator('#scenario-filter').selectOption(classification);
    await expect(page.locator('#scenario-results tbody tr').first()).toBeVisible();
  }
  await page.locator('#scenario-filter').selectOption('');
  await page.screenshot({ path: resolve(screenshotRoot, `${testInfo.project.name}-scenario-explorer.png`), fullPage: true });

  await page.getByRole('tab', { name: /Evidence Inspector/ }).click();
  await inspectAccessibility('Evidence Inspector');
  await page.locator('#evidence-id').fill('targeted-price-a');
  await page.getByRole('button', { name: 'Inspect evidence' }).click();
  await expect(page.locator('#evidence-results')).toContainText('ANSWERABLE');
  await expect(page.locator('#evidence-results')).toContainText('fixture-shop-a');
  await expect(page.locator('#evidence-results')).toContainText('900');
  await page.locator('#evidence-id').fill('targeted-unknown');
  await page.getByRole('button', { name: 'Inspect evidence' }).click();
  await expect(page.locator('#evidence-results')).toContainText('NOT_ANSWERABLE');
  await expect(page.locator('#evidence-results')).toContainText('SAFE_FALLBACK_OR_HANDOFF');

  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.locator('#run-persona').selectOption('P01');
  await page.locator('#run-mode').selectOption('candidate');
  const candidateId = await startUiRun(page, 'Run selected persona');
  expect(candidateId).toBeTruthy();
  await expect(page.locator('#replay-results .turn-card')).toHaveCount(10);
  await expect(page.locator('#replay-results')).toContainText('scenario-01-01');
  await expect(page.locator('#replay-results')).toContainText('scenario-01-10');
  const candidateReceipt = await page.evaluate(async id => {
    const token = document.querySelector<HTMLMetaElement>('meta[name="lab-token"]')?.content;
    const response = await fetch(`/__lab/api/runs/${id}`, { headers: { 'X-Lab-Token': token || '' } });
    return response.json();
  }, candidateId);
  expect(candidateReceipt).toMatchObject({ scope: 'persona', personaId: 'P01', mode: 'candidate', status: 'completed' });
  expect(candidateReceipt.dataset.executedTurns).toBe(10);
  expect(candidateReceipt.turns[0].scenarioId).toBe('scenario-01-01');
  expect(candidateReceipt.turns[9].scenarioId).toBe('scenario-01-10');
  expect(candidateReceipt.turns.map((turn: { scenarioId: string }) => turn.scenarioId)).toEqual(
    Array.from({ length: 10 }, (_, index) => `scenario-01-${String(index + 1).padStart(2, '0')}`),
  );
  expect(candidateReceipt.turns.every((turn: { scenarioId: string; traceId: string }) => turn.traceId === turn.scenarioId)).toBe(true);
  expect(new Set(candidateReceipt.turns.map((turn: { traceId: string }) => turn.traceId)).size).toBe(10);
  expect(candidateReceipt.turns.every((turn: { responseTextStored?: boolean }) => turn.responseTextStored === false)).toBe(true);
  expect(JSON.stringify(candidateReceipt)).not.toMatch(/responsePreview|responseDigest|customerMessage|sourceHash/i);
  await page.screenshot({ path: resolve(screenshotRoot, `${testInfo.project.name}-conversation-replay.png`), fullPage: true });

  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.locator('#run-mode').selectOption('baseline');
  const baselineId = await startUiRun(page, 'Run selected persona');
  expect(baselineId).toBeTruthy();
  expect(baselineId).not.toBe(candidateId);
  await page.getByRole('tab', { name: /Baseline vs Candidate/ }).click();
  await inspectAccessibility('Baseline vs Candidate');
  await selectComparisonRuns(page, baselineId, candidateId);
  await page.getByRole('button', { name: 'Compare runs' }).click();
  await expect(page.locator('#comparison-results')).toContainText('Baseline selection');
  await expect(page.locator('#comparison-results')).toContainText('Candidate selection');
  await expect(page.locator('#comparison-results')).toContainText(candidateId);
  await expect(page.locator('#comparison-results')).toContainText(baselineId);
  await expect(page.locator('#comparison-results')).toContainText('same dataset source hash');

  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.locator('#run-mode').selectOption('baseline');
  const fullBaselineId = await startUiRun(page, 'Run full dataset', 300_000);
  expect(fullBaselineId).toBeTruthy();
  const fullBaselineReceipt = await page.evaluate(async id => {
    const response = await fetch(`/__lab/api/runs/${id}`);
    return response.json();
  }, fullBaselineId);
  expect(fullBaselineReceipt).toMatchObject({ scope: 'full', mode: 'baseline', status: 'completed', dataset: { sourceTurns: 200, sourcePersonas: 20, executedTurns: 200, completeDatasetExecuted: true, rawSourceMessagesPersisted: false } });
  expect(fullBaselineReceipt.engineSourceRevision).toContain('c8981c4df9ea84d47c35f2541884fd55afd64bae+backend-src-sha256:');
  expect(fullBaselineReceipt.engineSourceRevision).toContain(fullBaselineReceipt.engineSourceSha256);
  expect(fullBaselineReceipt.engineSourceSha256).toMatch(/^[a-f0-9]{64}$/i);

  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.locator('#run-mode').selectOption('candidate');
  const fullCandidateId = await startUiRun(page, 'Run full dataset', 300_000);
  expect(fullCandidateId).toBeTruthy();
  const fullReceipt = await page.evaluate(async id => {
    const response = await fetch(`/__lab/api/runs/${id}`);
    return response.json();
  }, fullCandidateId);
  expect(fullReceipt).toMatchObject({ scope: 'full', status: 'completed', dataset: { sourceTurns: 200, sourcePersonas: 20, executedTurns: 200, completeDatasetExecuted: true, rawSourceMessagesPersisted: false } });
  expect(fullReceipt.mode).toBe('candidate');
  expect(fullReceipt.turns).toHaveLength(200);
  expect(new Set(fullReceipt.turns.map((turn: { scenarioId: string }) => turn.scenarioId)).size).toBe(200);
  expect(fullReceipt.turns.every((turn: { scenarioId: string; traceId: string; responseTextStored: boolean }) =>
    turn.traceId === turn.scenarioId && turn.responseTextStored === false)).toBe(true);
  expect(new Set(fullReceipt.turns.map((turn: { traceId: string }) => turn.traceId)).size).toBe(200);
  expect(fullReceipt.summary.presentationContractsValid).toBe(200);
  expect(fullReceipt.summary).toMatchObject({ businessMutations: 0, messengerSends: 0 });
  expect(fullReceipt.provenance).toMatchObject({ realProvider: false, realVision: false, realMeta: false, outboundNetworkCalls: 0 });
  expect(fullReceipt.dataset.sha256).toBe(fullBaselineReceipt.dataset.sha256);
  expect(fullReceipt.engineSourceSha256).not.toBe(fullBaselineReceipt.engineSourceSha256);

  await page.getByRole('tab', { name: /Baseline vs Candidate/ }).click();
  await selectComparisonRuns(page, fullBaselineId, fullCandidateId);
  await page.getByRole('button', { name: 'Compare runs' }).click();
  await expect(page.locator('#comparison-results')).toContainText('Baseline selection');
  await expect(page.locator('#comparison-results')).toContainText('Candidate selection');
  await expect(page.locator('#comparison-results')).toContainText('same dataset source hash');

  await page.getByRole('tab', { name: /Cost & Latency/ }).click();
  await inspectAccessibility('Cost & Latency');
  await expect(page.locator('#cost-results')).toContainText('mock');
  await expect(page.locator('#cost-results')).toContainText('Unavailable when not measured');
  await page.getByRole('tab', { name: /Failure Triage/ }).click();
  await inspectAccessibility('Failure Triage');
  await expect(page.locator('#triage-results')).toContainText('unsafe-price-claim');
  await expect(page.locator('#triage-results')).toContainText('P1');
  await page.getByRole('button', { name: 'Rerun fixture' }).click();
  await expect(page.locator('#triage-results')).toContainText('BLOCKED_BY_GROUNDING', { timeout: 120_000 });
  await page.getByRole('tab', { name: /Run History/ }).click();
  await inspectAccessibility('Run History');
  await expect(page.locator('#history-results')).toContainText(fullCandidateId);

  const exportDir = resolve(screenshotRoot, '../exports');
  mkdirSync(exportDir, { recursive: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('tab', { name: /Conversation Replay/ }).click();
      await inspectAccessibility('Conversation Replay');
      await page.getByRole('link', { name: 'Export JSON' }).click();
    })(),
  ]);
  const exportPath = resolve(exportDir, `${fullCandidateId}.json`);
  await download.saveAs(exportPath);
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile(exportPath, 'utf8'));
  expect(exported.runId).toBe(fullCandidateId);
  expect(exported.turns).toHaveLength(200);
  expect(JSON.stringify(exported)).not.toMatch(/sourceHash|customerMessage|simulatedAttachment|expectedAnswer/i);

  await page.getByRole('tab', { name: /Playground/ }).click();
  await inspectAccessibility('Playground');
  const playgroundButtonLabels = await page.getByRole('button').allTextContents();
  expect(playgroundButtonLabels.join(' ')).not.toMatch(/\b(?:purchase|place order|checkout|pay now|confirm order)\b/i);
  await page.locator('#tenant-id').fill('merchant-a');
  await page.locator('#session-id').fill('session-e2e-lab');
  await page.locator('#playground-message').fill('Test Everyday T-Shirt er dam koto?');
  await page.getByRole('button', { name: 'Run test turn' }).click();
  await expect(page.locator('#playground-results')).toContainText('900', { timeout: 120_000 });
  await page.locator('#playground-message').fill('Eta ki stock e ache?');
  await page.getByRole('button', { name: 'Run test turn' }).click();
  await expect(page.locator('#playground-results')).toContainText('fixture-shop-a-cotton-tee', { timeout: 120_000 });
  await page.locator('#playground-message').fill('Show me the Cargo Pant.');
  await page.getByRole('button', { name: 'Run test turn' }).click();
  await expect(page.locator('#playground-results')).toContainText('fixture-shop-a-cargo-pant', { timeout: 120_000 });
  await page.locator('#tenant-id').fill('merchant-b');
  await page.locator('#playground-message').fill('Test Everyday T-Shirt er dam koto?');
  await page.getByRole('button', { name: 'Run test turn' }).click();
  await expect(page.locator('#playground-results')).toContainText('1050', { timeout: 120_000 });
  await expect(page.locator('#playground-results')).toContainText('Tenant context reset');
  await expect(page.locator('#playground-results')).toContainText('true');
  await page.locator('#image-fixture').fill('fixture-shirt-front');
  await page.locator('#playground-message').fill('Ei chobite ki product ache?');
  await page.getByRole('button', { name: 'Run test turn' }).click();
  await expect(page.locator('#playground-results')).toContainText(/image|photo|clarif|evidence/i, { timeout: 120_000 });
  const safeImageText = await page.locator('#playground-results').innerText();
  expect(safeImageText).not.toMatch(/identified from (the )?image|vision matched/i);
  await page.getByRole('button', { name: 'Reset session' }).click();
  await expect(page.locator('#playground-results')).toContainText('Session reset');
  await page.reload();
  await page.getByRole('tab', { name: /Run History/ }).click();
  await expect(page.locator('#history-results')).toContainText(fullCandidateId);

  const inputLabels = await page.locator('input, textarea, select').evaluateAll(elements => elements.map(element => {
    const id = element.id;
    return Boolean(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
  }));
  expect(inputLabels.every(Boolean)).toBe(true);
  await page.getByRole('tab', { name: /Overview/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Scenario Explorer/ })).toHaveAttribute('aria-selected', 'true');

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('tab', { name: /Overview/ }).click();
    await expect(page.locator('#service-status')).toContainText('ready');
    const metrics = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
  }

  expect(pageErrors).toEqual([]);
  const accessibilityReport = {
    schemaVersion: 1,
    status: accessibilitySections.some(section => section.violations.some(violation => ['critical', 'serious'].includes(violation.impact || '')))
      ? 'FAIL_CRITICAL_OR_SERIOUS'
      : 'PASS_NO_CRITICAL_OR_SERIOUS',
    browser: testInfo.project.name,
    scannedSections: accessibilitySections,
    criticalOrSeriousViolationCount: accessibilitySections.reduce((count, section) =>
      count + section.violations.filter(violation => ['critical', 'serious'].includes(violation.impact || '')).length, 0),
  };
  const axeReportPath = process.env.LAB_AXE_REPORT_PATH
    ? resolve(process.env.LAB_AXE_REPORT_PATH)
    : resolve(screenshotRoot, '../axe-accessibility-report.json');
  writeFileSync(axeReportPath, `${JSON.stringify(accessibilityReport, null, 2)}\n`);
  expect(accessibilityReport.criticalOrSeriousViolationCount).toBe(0);
});

test('loads the real Lab shell on every installed browser engine', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make every answer inspectable.' })).toBeVisible();
  await expect(page.locator('#service-status')).toContainText('ready');
  await expect(page.getByRole('tablist', { name: 'Test Lab sections' }).getByRole('tab')).toHaveCount(9);
  await page.screenshot({ path: resolve(screenshotRoot, `${testInfo.project.name}-startup.png`), fullPage: true });
});
