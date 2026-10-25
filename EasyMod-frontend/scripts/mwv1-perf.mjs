// Live perf measurement through the real authenticated browser session.
// Run: node scripts/mwv1-perf.mjs  (needs the lab stack up on :3000/:5173)
import { chromium } from '@playwright/test';

const B = 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { try { localStorage.setItem('easymod_lang', 'en'); } catch { /* ignore */ } });
await page.goto('http://localhost:5173/signin');
const emailBox = page.getByRole('textbox', { name: /email/i });
await emailBox.waitFor({ state: 'visible', timeout: 30000 });
await emailBox.pressSequentially('pilot.a.owner@lab.easymod.local', { delay: 5 });
const passBox = page.getByRole('textbox', { name: /password/i });
await passBox.pressSequentially('PilotLab@2026!', { delay: 5 });
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL(/dashboard|inbox/, { timeout: 30000 });
await page.goto('http://localhost:5173/inbox');
await page.waitForTimeout(1500);

const custId = await page.evaluate(async () => {
  const r = await fetch('/api/conversation?limit=50', { credentials: 'include' });
  const j = await r.json();
  return (j?.data?.conversations || []).find((c) => c.customer_id)?.customer_id || null;
});

const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
async function time(label, path, n = 30) {
  const t = [];
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate(async ({ p }) => {
      const s = performance.now();
      const res = await fetch(p, { credentials: 'include' });
      await res.arrayBuffer();
      return Math.round((performance.now() - s) * 10) / 10;
    }, { p: B + path });
    t.push(r);
  }
  console.log(label.padEnd(42), 'median', med(t) + 'ms', 'min', Math.min(...t) + 'ms', 'max', Math.max(...t) + 'ms');
}

await page.evaluate(async () => { await fetch('/api/conversation?limit=50', { credentials: 'include' }); });
await time('GET /api/conversation list(50)', '/api/conversation?limit=50');
await time('GET /api/conversation?customer_id', `/api/conversation?customer_id=${custId}&limit=1`);
await time('GET /api/order?customer_id (context)', `/api/order?customer_id=${custId}&limit=3`);
await time('GET /api/inbox/actions?view=attention', '/api/inbox/actions?view=attention');
await time('GET /api/inbox/actions?view=unassigned', '/api/inbox/actions?view=unassigned');
await time('GET /api/customer/:id/notes', `/api/customer/${custId}/notes`);
await time('GET /api/customer/:id/tags', `/api/customer/${custId}/tags`);
await browser.close();
