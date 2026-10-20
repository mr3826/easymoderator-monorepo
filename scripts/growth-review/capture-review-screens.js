'use strict';

/**
 * Captures founder-review screenshots from the OWNED local review stack.
 * Reads credentials only from the gitignored receipt; writes images to
 * .growth-review/screenshots/ (gitignored). Not part of CI.
 * Usage: node scripts/growth-review/capture-review-screens.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const currentPath = path.join(repoRoot, '.growth-review', 'current.json');
const outDir = path.join(repoRoot, '.growth-review', 'screenshots');

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of value.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totpCode(base32Secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(base32Secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

function parseReceipt(text) {
  const accounts = {};
  for (const [, name, body] of text.matchAll(/### (\w+)\b([\s\S]*?)(?=###|\n## |$)/g)) {
    accounts[name] = {
      email: /Email: (\S+)/.exec(body)?.[1] || null,
      password: /Password: (\S+)/.exec(body)?.[1] || null,
      totpSecret: /TOTP secret \(base32\): ([A-Z2-7=]+)/i.exec(body)?.[1] || null,
    };
  }
  return accounts;
}

async function signIn(page, baseUrl, account) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (account.totpSecret) {
    await page.getByLabel('Verification code').waitFor();
    await page.getByLabel('Verification code').fill(totpCode(account.totpSecret, Math.floor(Date.now() / 1000 / 30)));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

async function main() {
  if (!fs.existsSync(currentPath)) throw new Error('No review stack recorded.');
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  if (!current.receiptFile) throw new Error('Review stack not seeded.');
  const baseUrl = `http://127.0.0.1:${current.frontendPort}`;
  const accounts = parseReceipt(fs.readFileSync(path.join(repoRoot, current.receiptFile), 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  try {
    // Admin Control context.
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const adminPage = await adminContext.newPage();
    await signIn(adminPage, baseUrl, accounts.admin);
    await adminPage.goto(`${baseUrl}/admin`);
    await adminPage.getByRole('heading', { name: 'Attention', exact: true }).waitFor();
    await adminPage.screenshot({ path: path.join(outDir, 'admin-attention-1440.png'), fullPage: true });
    await adminPage.getByRole('group', { name: 'Workspace context' })
      .getByRole('button', { name: 'Sales & Growth' }).click();
    await adminPage.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await adminPage.screenshot({ path: path.join(outDir, 'admin-sales-nav-1440.png'), fullPage: true });
    await adminContext.close();

    // Sales context.
    const salesContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const salesPage = await salesContext.newPage();
    await signIn(salesPage, baseUrl, accounts.sales);
    await salesPage.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await salesPage.screenshot({ path: path.join(outDir, 'sales-today-1440.png'), fullPage: true });

    const prospectLink = salesPage.getByRole('region', { name: 'Overdue follow-ups' })
      .getByRole('link').first();
    await prospectLink.click();
    await salesPage.waitForURL(/\/prospects\//);
    const panel = salesPage.locator('section[aria-labelledby="followups-panel-title"]');
    const completeButton = panel.getByRole('button', { name: 'Complete' }).first();
    try {
      await completeButton.waitFor({ state: 'visible', timeout: 30_000 });
      await completeButton.click();
      await salesPage.screenshot({ path: path.join(outDir, 'sales-outcome-form-1440.png'), fullPage: true });
    } catch (_error) {
      console.log('outcome form not present on this record; skipping that shot');
    }
    await salesPage.goto(`${baseUrl}/performance?tab=sources`);
    await salesPage.getByRole('heading', { name: 'Growth Performance', exact: true }).waitFor();
    await salesPage.screenshot({ path: path.join(outDir, 'performance-sources-1440.png'), fullPage: true });
    await salesContext.close();

    // Mobile sales queue.
    // Wait past the current 30-second TOTP window so a second sign-in with
    // the same account never reuses a consumed code.
    await new Promise((resolve) => setTimeout(resolve, 31_000));
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    mobilePage.setDefaultNavigationTimeout(90_000);
    await signIn(mobilePage, baseUrl, accounts.sales);
    await mobilePage.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await mobilePage.screenshot({ path: path.join(outDir, 'sales-today-390.png'), fullPage: true });
    await mobileContext.close();
  } finally {
    await browser.close();
  }
  console.log(`Screenshots written to ${path.relative(repoRoot, outDir)} (gitignored local evidence).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
