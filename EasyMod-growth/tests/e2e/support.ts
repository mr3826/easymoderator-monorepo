import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const backendRequire = createRequire(fileURLToPath(new URL('../../../EasyMod-backend/package.json', import.meta.url)));
const { hotp } = require('../../../EasyMod-backend/src/modules/auth/totp.service.js') as {
  hotp: (secret: string, counter: number) => string;
};

export interface E2EUser {
  id: string;
  email: string;
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
  shop: { id: string; name: string; shopName: string };
  users: Record<string, E2EUser>;
  prospects: Record<string, E2EProspect>;
}

const fixturePath = fileURLToPath(new URL('./.fixtures.json', import.meta.url));
export const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as E2EFixtures;

export async function signIn(
  page: Page,
  user: E2EUser,
  { assertAuthorized = true }: { assertAuthorized?: boolean } = {},
) {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);

  const signInResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/auth/signin')
  ));
  const sessionResponse = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response.url().includes('/api/internal/growth-os/session')
    && [200, 403, 503].includes(response.status())
  ));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await signInResponse;

  if (user.totpSecret) {
    await expect(page.getByLabel('Verification code')).toBeVisible();
    const counter = Math.floor(Date.now() / 1000 / 30);
    await page.getByLabel('Verification code').fill(hotp(user.totpSecret, counter));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
  }

  await sessionResponse;

  // LoginPage handles the success redirect, while denied sessions are routed
  // by ProtectedRoute. Re-entering the root makes both outcomes deterministic.
  await page.goto('/');
  if (assertAuthorized) {
    await expect(page.getByRole('heading', { name: 'Prospect foundation ready' })).toBeVisible();
  }
}

export async function pageRequest(
  page: Page,
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
) {
  return page.evaluate(async ({ requestPath, requestMethod, requestBody }) => {
    const response = await fetch(requestPath, {
      method: requestMethod,
      credentials: 'include',
      headers: requestBody === undefined ? undefined : { 'Content-Type': 'application/json' },
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
