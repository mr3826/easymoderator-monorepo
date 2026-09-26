import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Response } from '@playwright/test';

const require = createRequire(import.meta.url);
const backendRequire = createRequire(fileURLToPath(new URL('../../../EasyMod-backend/package.json', import.meta.url)));
const { hotp } = require('../../../EasyMod-backend/src/modules/auth/totp.service.js') as {
  hotp: (secret: string, counter: number) => string;
};

export interface E2EUser {
  id: string;
  email: string;
  phone?: string;
  password: string;
  role: string | null;
  totpSecret?: string;
}

export interface E2EProspect {
  id: string;
  businessName: string;
  source: string;
  status: string;
}

export interface E2EFixtures {
  version: number;
  password: string;
  privateMarker: string;
  privateTimelineReason: string;
  tenant: { id: string; name: string };
  shop: { id: string; name: string; shopName: string; uniqueCode: string };
  emails: Record<string, string>;
  totp: { superUser: string; legacy: string };
  totpAlgorithm: string;
  totpIssuer: string;
  totpPeriod: number;
  totpDigits: number;
  users: Record<'super' | 'growth' | 'legacy' | 'staleSession' | 'merchant', E2EUser>;
  prospects: Record<string, E2EProspect>;
}

const fixturePath = fileURLToPath(new URL('./.fixtures.json', import.meta.url));
export const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as E2EFixtures;

export const AUTH_STATE_DIR = path.join(os.tmpdir(), 'easymod-growth-e2e-auth');
fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

export type AuthRole = 'super' | 'growth' | 'legacyFounder' | 'merchant';

export function authStatePath(role: AuthRole): string {
  return path.join(AUTH_STATE_DIR, `${role}.json`);
}

export function runStamp(): string {
  return `${Date.now()}`;
}

// datetime-local strings for Growth scheduling must carry the Asia/Dhaka
// business calendar (the app's canonical contract), never the runner host's
// local zone — otherwise the harness replicates the very defect it tests.
export function businessDateTimeLocal(value: Date, hour = 9, minute = 0): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${day}T${pad(hour)}:${pad(minute)}`;
}

export function dateTimeLocalPlus(offsetMs: number): string {
  const value = new Date(Date.now() + offsetMs);
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(value));
  const minute = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    minute: '2-digit',
  }).format(value));
  return businessDateTimeLocal(value, hour, minute);
}

export function uniquePhone(seed = Date.now()): string {
  // 01XXXXXXXXX shape required by the BD-normalizer in the identity code.
  return `019${String(seed).slice(-9)}`;
}

// The backend marks a TOTP code as used for 90 seconds per user, so repeating
// the same authenticator window for the same secret is a replay (400). Track
// the last computed code per secret and wait one window when it would collide.
const lastTotpCode = new Map<string, string>();

async function freshTotpCode(secret: string): Promise<string> {
  const period = fixtures.totpPeriod || 30;
  let counter = Math.floor(Date.now() / 1000 / period);
  let code = hotp(secret, counter);
  if (lastTotpCode.get(secret) === code) {
    const nextWindowStart = (counter + 1) * period * 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextWindowStart - Date.now()) + 200));
    counter = Math.floor(Date.now() / 1000 / period);
    code = hotp(secret, counter);
  }
  lastTotpCode.set(secret, code);
  return code;
}

export interface SignInOptions {
  assertAuthorized?: boolean;
  expectSigninDenied?: boolean;
}

export interface SignInResult {
  signinStatus: number;
  signinBody: {
    message?: string;
    code?: string;
    requiresPasswordChange?: boolean;
    data?: { requiresPasswordChange?: boolean };
  } | null;
}

export async function signIn(
  page: Page,
  user: E2EUser,
  { assertAuthorized = true, expectSigninDenied = false }: SignInOptions = {},
): Promise<SignInResult> {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);

  const signinResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/auth/signin')
  ));
  const sessionResponsePromise = expectSigninDenied
    ? null
    : page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/internal/growth-os/session')
      && [200, 403, 503].includes(response.status())
    ));
  await page.getByRole('button', { name: 'Sign in' }).click();
  const signinResponse = await signinResponsePromise;
  const signinBody = await signinResponse.json().catch(() => null) as SignInResult['signinBody'];

  if (expectSigninDenied) {
    return { signinStatus: signinResponse.status(), signinBody };
  }

  if (user.totpSecret) {
    await expect(page.getByLabel('Verification code')).toBeVisible();
    await page.getByLabel('Verification code').fill(await freshTotpCode(user.totpSecret));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
  }

  if (signinBody?.requiresPasswordChange || signinBody?.data?.requiresPasswordChange) {
    await expect(page).toHaveURL(/\/change-password$/);
    return { signinStatus: signinResponse.status(), signinBody };
  }

  if (sessionResponsePromise) await sessionResponsePromise;

  // LoginPage handles the success redirect, while denied sessions are routed
  // by ProtectedRoute. Re-entering the root makes both outcomes deterministic.
  await page.goto('/');
  if (assertAuthorized) {
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  }
  return { signinStatus: signinResponse.status(), signinBody };
}

export async function pageRequest(
  page: Page,
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
) {
  return page.evaluate(async ({ requestPath, requestMethod, requestBody }) => {
    const isMutation = requestMethod !== 'GET';
    const headers: Record<string, string> = {};
    if (isMutation) {
      const csrfResponse = await fetch('/api/csrf', { credentials: 'include' });
      const csrfPayload = await csrfResponse.json().catch(() => null);
      if (typeof csrfPayload?.csrfToken === 'string') {
        headers['X-CSRF-Token'] = csrfPayload.csrfToken;
      }
      if (requestBody !== undefined) headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(requestPath, {
      method: requestMethod,
      credentials: 'include',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    const responseBody = await response.json().catch(() => null);
    return { status: response.status, body: responseBody };
  }, { requestPath: path, requestMethod: method, requestBody: body });
}

export async function bumpTokenVersion(userId: string) {
  const { Client } = backendRequire('pg') as {
    Client: new (options: { connectionString: string; ssl: false }) => {
      connect: () => Promise<void>;
      query: (sql: string, values: string[]) => Promise<unknown>;
      end: () => Promise<void>;
    };
  };
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
  } finally {
    await client.end();
  }

  const Redis = backendRequire('ioredis') as new (
    url: string,
    options: { db: number },
  ) => {
    del: (key: string) => Promise<number>;
    quit: () => Promise<string>;
    disconnect: () => void;
  };
  const redis = new Redis(process.env.REDIS_URL, {
    db: Number(process.env.REDIS_CACHE_DB || '1'),
  });
  try {
    await redis.del(`user:${userId}:token_version`);
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }
}

export async function waitForResponseJson(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  return { status: response.status(), body: await response.json().catch(() => null) };
}
