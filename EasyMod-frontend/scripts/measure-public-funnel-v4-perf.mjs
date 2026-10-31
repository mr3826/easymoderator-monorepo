import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4283';
const outputPath = resolve(process.cwd(), '..', 'docs', 'merchant-redesign', 'public-funnel-v4', 'qa', 'performance-sample.json');
const browser = await chromium.launch({ headless: true });
const result = [];

for (const width of [390, 1440]) {
  for (let trial = 1; trial <= 3; trial += 1) {
    const mobile = width <= 390;
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 1.6 * 1024 * 1024 / 8,
      uploadThroughput: 750 * 1024 / 8,
      connectionType: 'cellular4g',
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      window.__v4Vitals = { lcp: null, lcpTag: '', lcpText: '', lcpSize: 0, cls: 0, lcpEntries: [], longTasks: [] };
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          window.__v4Vitals.lcp = entry.startTime;
          window.__v4Vitals.lcpTag = entry.element?.tagName || '';
          window.__v4Vitals.lcpText = entry.element?.textContent?.trim().slice(0, 100) || '';
          window.__v4Vitals.lcpSize = entry.size;
          window.__v4Vitals.lcpEntries.push({ startTime: entry.startTime, tag: entry.element?.tagName || '', size: entry.size });
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          window.__v4Vitals.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          if (!entry.hadRecentInput) window.__v4Vitals.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    const response = await page.goto(`${baseUrl}/?lang=en`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const metrics = await page.evaluate(({ includeResources }) => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      const paints = performance.getEntriesByType('paint');
      return {
        lcpMs: window.__v4Vitals.lcp,
        lcpTag: window.__v4Vitals.lcpTag,
        lcpText: window.__v4Vitals.lcpText,
        lcpSize: window.__v4Vitals.lcpSize,
        cls: window.__v4Vitals.cls,
        lcpEntries: window.__v4Vitals.lcpEntries,
        longTasks: window.__v4Vitals.longTasks,
        paintTimingsMs: Object.fromEntries(paints.map((entry) => [entry.name, entry.startTime])),
        ttfbMs: navigation.responseStart,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadMs: navigation.loadEventEnd,
        resourceTransferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
        resourceCount: resources.length,
        largestResources: resources
          .sort((left, right) => right.transferSize - left.transferSize)
          .slice(0, 6)
          .map((resource) => ({
            url: new URL(resource.name).pathname,
            transferBytes: resource.transferSize,
            durationMs: resource.duration,
          })),
        ...(includeResources ? {
          resources: resources.map((resource) => ({
            url: new URL(resource.name).pathname,
            initiatorType: resource.initiatorType,
            transferBytes: resource.transferSize,
            durationMs: resource.duration,
            startTimeMs: resource.startTime,
          })),
        } : {}),
      };
    }, { includeResources: trial === 1 });
    result.push({ trial, viewportWidth: width, mobileEmulation: mobile, httpStatus: response?.status(), ...metrics });
    await context.close();
  }
}

await browser.close();
const report = {
  measuredAt: new Date().toISOString(),
  url: `${baseUrl}/?lang=en`,
  environment: {
    browser: 'Chromium via Playwright',
    network: '150 ms latency, 1.6 Mbps download, 750 Kbps upload (CDP cellular4g emulation)',
    cpuThrottleRate: 4,
    fieldData: false,
  },
  runs: result,
};
mkdirSync(resolve(outputPath, '..'), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
