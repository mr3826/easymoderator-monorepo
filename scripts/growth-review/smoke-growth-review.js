'use strict';

/**
 * HTTP-level founder-review smoke against the owned local stack. It exercises
 * the REAL authentication + MFA + Growth authorization path end to end
 * (browser E2E remains a separate gate via npm run test:growthos:e2e).
 * Secrets are read only from the gitignored local receipt; nothing is logged.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const stateDir = path.join(__dirname, '..', '..', '.growth-review');
const currentPath = path.join(stateDir, 'current.json');

function die(message, code = 1) {
  console.error(message);
  process.exitCode = code;
  throw new Error(message);
}

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
  const sections = [...text.matchAll(/### (\w+)\b([\s\S]*?)(?=###|\n## |$)/g)];
  for (const [, name, body] of sections) {
    accounts[name] = {
      email: /Email: (\S+)/.exec(body)?.[1] || null,
      password: /Password: (\S+)/.exec(body)?.[1] || null,
      totpSecret: /TOTP secret \(base32\): ([A-Z2-7=]+)/i.exec(body)?.[1] || null,
    };
  }
  return accounts;
}

class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.csrfToken = null;
  }

  applyCookies(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(method, urlPath, body, { csrf = false, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.cookies.size) headers.Cookie = this.cookieHeader();
    if (csrf && this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    const response = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.applyCookies(response);
    let payload = null;
    const text = await response.text();
    try { payload = JSON.parse(text); } catch (_error) { /* non-JSON body */ }
    return { status: response.status, payload, text };
  }

  async loadCsrf() {
    const response = await this.request('GET', '/api/csrf');
    this.csrfToken = response.payload?.csrfToken || response.payload?.data?.csrfToken || null;
    if (!this.csrfToken) throw new Error(`CSRF bootstrap failed (status ${response.status})`);
  }

  async signIn(account) {
    await this.loadCsrf();
    const signin = await this.request('POST', '/api/auth/signin', {
      email: account.email,
      password: account.password,
    }, { csrf: true });
    if (signin.status !== 200 || !signin.payload?.success) {
      throw new Error(`signin failed for ${account.email}: status ${signin.status} code ${signin.payload?.code}`);
    }
    const data = signin.payload.data;
    if (data.requires2fa) {
      const code = totpCode(account.totpSecret, Math.floor(Date.now() / 1000 / 30));
      const verify = await this.request('POST', '/api/auth/2fa/verify', {
        tempToken: data.tempToken,
        token: code,
      });
      if (verify.status !== 200 || !verify.payload?.success) {
        throw new Error(`MFA verify failed for ${account.email}: status ${verify.status} code ${verify.payload?.code}`);
      }
      await this.loadCsrf();
    }
    return data;
  }
}

async function main() {
  if (!fs.existsSync(currentPath)) die('No owned review stack recorded. Run npm run growth:review:up first.');
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  if (!current.receiptFile) die('Review stack is not seeded. Run npm run growth:review:seed first.');
  const baseUrl = `http://127.0.0.1:${current.frontendPort}`;
  const accounts = parseReceipt(fs.readFileSync(path.join(__dirname, '..', '..', current.receiptFile), 'utf8'));

  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
      console.log(`PASS  ${name}`);
    } catch (error) {
      results.push({ name, pass: false, detail: error.message });
      console.log(`FAIL  ${name} — ${error.message}`);
    }
  };

  const expectStatus = (response, status, label) => {
    if (response.status !== status) {
      throw new Error(`${label}: expected ${status}, got ${response.status} (${response.payload?.code || 'no code'})`);
    }
    return response;
  };

  const anonymous = new Session(baseUrl);
  await check('unauthenticated Growth API → 401', async () => {
    expectStatus(await anonymous.request('GET', '/api/internal/growth-os/home', undefined, { auth: false }), 401, 'home');
  });

  const admin = new Session(baseUrl);
  await check('super admin completes password + TOTP sign-in', async () => {
    await admin.signIn(accounts.admin);
    const session = expectStatus(await admin.request('GET', '/api/internal/growth-os/session'), 200, 'session');
    if (session.payload.data.role !== 'SUPER_ADMIN') throw new Error(`role ${session.payload.data.role}`);
  });

  await check('admin home carries platform attention aggregates', async () => {
    const home = expectStatus(await admin.request('GET', '/api/internal/growth-os/home'), 200, 'home');
    const data = home.payload.data;
    if (!data.platformAttention) throw new Error('platformAttention missing for SUPER_ADMIN');
    if (typeof data.platformAttention.subscriptionsSuspended !== 'number') throw new Error('subscriptionsSuspended missing');
  });

  await check('admin operations detail + staff list reachable', async () => {
    expectStatus(await admin.request('GET', '/api/internal/growth-os/admin/operations?window=7'), 200, 'operations');
    expectStatus(await admin.request('GET', '/api/internal/growth-os/admin/users'), 200, 'users');
  });

  await check('admin performs a reason-bearing channel reconnect request and finds it in the audit', async () => {
    const merchants = expectStatus(await admin.request('GET', '/api/internal/growth-os/merchants?search=Chandke'), 200, 'merchant list');
    const row = merchants.payload.data.items.find((item) => /Chandke/.test(String(item.shopName || item.name || '')));
    if (!row) throw new Error('seeded F-commerce shop not found in admin merchant list');
    const detail = expectStatus(await admin.request('GET', `/api/internal/growth-os/merchants/${row.id}`), 200, 'merchant 360');
    if (!detail.payload.data.subscription) throw new Error('SUPER_ADMIN did not receive the full 360 shape');
    const channel = detail.payload.data.facebook?.channels?.[0];
    if (!channel) throw new Error('no channels in 360 facebook section');
    const reconnect = expectStatus(await admin.request('POST',
      `/api/internal/growth-os/admin/merchants/${row.id}/channels/${channel.id}/reconnect-request`, {
        reason: 'smoke: local review reconnect request',
        confirm: 'RECONNECT',
      }, { csrf: true }), 200, 'reconnect request');
    if (!reconnect.payload.success) throw new Error('reconnect request not successful');
    const audit = expectStatus(await admin.request('GET', '/api/internal/growth-os/admin/audit?pageSize=20'), 200, 'audit');
    const found = audit.payload.data.items.some(
      (entry) => entry.action === 'growth_os:merchant_channel_reconnect_requested',
    );
    if (!found) throw new Error('reconnect audit receipt missing');
  });

  const sales = new Session(baseUrl);
  await check('growth user completes password + TOTP sign-in', async () => {
    await sales.signIn(accounts.sales);
    const session = expectStatus(await sales.request('GET', '/api/internal/growth-os/session'), 200, 'session');
    if (session.payload.data.role !== 'GROWTH_USER') throw new Error(`role ${session.payload.data.role}`);
  });

  await check('growth user blocked from every admin API (403 by the server)', async () => {
    for (const [label, pathName] of [
      ['users', '/api/internal/growth-os/admin/users'],
      ['operations', '/api/internal/growth-os/admin/operations'],
      ['audit', '/api/internal/growth-os/admin/audit'],
    ]) {
      expectStatus(await sales.request('GET', pathName), 403, label);
    }
    expectStatus(await sales.request('POST', '/api/internal/growth-os/admin/users', {
      email: 'evil@example.test', fullName: 'Evil', role: 'SUPER_ADMIN', reason: 'escalation attempt',
    }, { csrf: true }), 403, 'admin user creation');
  });

  await check('sales creates and completes a follow-up with a typed outcome (persisted + audited)', async () => {
    const prospects = expectStatus(await sales.request('GET', '/api/internal/growth-os/prospects?owner=me&pageSize=1'), 200, 'prospects');
    const prospect = prospects.payload.data.items[0];
    if (!prospect) throw new Error('no prospects assigned to the sales identity');
    const created = expectStatus(await sales.request('POST', '/api/internal/growth-os/followups', {
      prospectId: prospect.id,
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      action: 'Local review smoke follow-up',
    }, { csrf: true }), 201, 'followup create');
    const done = expectStatus(await sales.request('POST', `/api/internal/growth-os/followups/${created.payload.data.id}/status`, {
      status: 'completed', outcome: 'reached', reason: 'smoke: reached owner',
    }, { csrf: true }), 200, 'transition');
    if (done.payload.data.status !== 'completed') throw new Error(`status ${done.payload.data.status}`);
    const timeline = expectStatus(await sales.request(
      'GET', `/api/internal/growth-os/prospects/${prospect.id}`,
    ), 200, 'prospect detail');
    const completion = timeline.payload.data.timeline.find(
      (event) => event.eventType === 'followup_completed' && event.metadata?.followup_id === created.payload.data.id,
    );
    if (!completion) throw new Error('completion event missing from timeline');
    if (completion.metadata?.outcome !== 'reached') throw new Error(`outcome ${completion.metadata?.outcome}`);
  });

  await check('duplicate preflight rejects a known contact channel before creation', async () => {
    const dup = expectStatus(await sales.request('POST', '/api/internal/growth-os/prospects/duplicate-check', {
      contactPhone: '+880 1710-000-199',
    }), 200, 'duplicate-check');
    if (!dup.payload.data.matches.length) throw new Error('anchor phone did not match');
    const create = await sales.request('POST', '/api/internal/growth-os/prospects', {
      businessName: 'Smoke Duplicate Attempt',
      contactPhone: '+880 1710-000-199',
      source: 'manual_entry',
    }, { csrf: true });
    expectStatus(create, 409, 'duplicate create');
    if (create.payload.code !== 'GROWTH_OS_PROSPECT_DUPLICATE') throw new Error(`code ${create.payload.code}`);
  });

  const merchant = new Session(baseUrl);
  await check('ordinary merchant cannot reach Growth workspace (403 with sanitized code)', async () => {
    await merchant.signIn({ ...accounts.merchant, totpSecret: null });
    const session = await merchant.request('GET', '/api/internal/growth-os/session');
    if (session.status !== 403) throw new Error(`expected 403, got ${session.status}`);
    if (!['GROWTH_OS_FORBIDDEN', 'GROWTH_OS_MERCHANT_CONTEXT_FORBIDDEN'].includes(session.payload?.code)) {
      throw new Error(`code ${session.payload?.code}`);
    }
  });

  await check('masked Merchant insight never returns admin-only 360 sections for sales', async () => {
    const merchants = expectStatus(await sales.request('GET', '/api/internal/growth-os/merchants'), 200, 'merchants');
    const row = merchants.payload.data.items.find((item) => item.shopId || item.id);
    if (!row) throw new Error('no insight rows seeded');
    const targetId = row.shopId || row.id;
    const detail = expectStatus(await sales.request('GET', `/api/internal/growth-os/merchants/${targetId}`), 200, 'detail');
    const data = detail.payload.data;
    if (data.subscription?.invoices || data.facebook?.channels || data.overview || data.billing || data.notes) {
      throw new Error('admin-only 360 sections leaked into masked insight');
    }
    const raw = JSON.stringify(data);
    if (/token/i.test(raw)) throw new Error('token material present in insight payload');
  });

  const failed = results.filter((entry) => !entry.pass);
  if (failed.length) {
    console.error(`Smoke failed: ${failed.length}/${results.length} checks.`);
    process.exitCode = 1;
  } else {
    console.log(`Smoke passed: ${results.length} real-authorization checks against ${baseUrl}.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Review smoke crashed: ${error.message}`);
    process.exitCode = process.exitCode || 1;
  });
}

module.exports = { runSmoke: main };
