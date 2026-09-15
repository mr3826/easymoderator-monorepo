import fs from 'fs';
import path from 'path';

import {
  signIn,
  refreshAccessToken,
  signinDataSchema,
  unwrapEnvelope,
  __resetRefreshGuardForTests,
} from './auth-client';
import { __resetTokenStoreForTests } from './token-store';
import { clearRefreshToken, setRefreshToken } from './secure-store';
import type { HttpResponse, RequestOptions, Transport } from '@/api/transport';

/**
 * ADR M-003 drift-prevention (Phase 2, mobile/p2-contract).
 *
 * Phase 1 shipped a mobile client and a native-auth backend that were never tested against each
 * other: the backend's own suite asserted against `res.body.data.*` (internally consistent with
 * itself) and this client's tests used a fake `Transport` that returned whatever shape the
 * client's OWN zod schema happened to expect. No test ever crossed the real HTTP boundary, so
 * three real drifts (envelope wrapping, `refresh_token` field naming, `shopId` location) shipped
 * unnoticed while both suites stayed green.
 *
 * This file is the other half of the fix. The fixture below is NOT hand-written — it is generated
 * by `EasyMod-backend/src/modules/auth/native/__tests__/native-auth.integration.test.js`'s
 * "drift-prevention fixture" test, against a REAL Express app and a real disposable
 * Postgres/Redis, then committed to the repo. This test loads that exact file and drives it
 * through the real, exported `signIn/refreshAccessToken` functions (via a fake `Transport` that
 * simply returns the captured body) plus the exported production zod schema for the one response
 * shape (`2fa/verify`) mobile has no dedicated wrapper for yet. If either side's response shape
 * drifts in the future, one of these two suites fails immediately and mechanically — no more
 * silent divergence.
 */

const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'EasyMod-backend',
  'src',
  'modules',
  'auth',
  'native',
  '__tests__',
  '__fixtures__',
  'native-auth-responses.json',
);

interface CapturedEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

interface CapturedUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  profile_picture: string | null;
}

interface CapturedTokenData {
  accessToken: string;
  refreshToken: string;
  sid?: string;
  shopId: string | null;
  user: CapturedUser;
}

interface CapturedTwoFaRequiredData {
  requires2fa: true;
  tempToken: string;
}

interface NativeAuthFixture {
  signin: CapturedEnvelope<CapturedTokenData>;
  refresh: CapturedEnvelope<CapturedTokenData>;
  signin2faRequired: CapturedEnvelope<CapturedTwoFaRequiredData>;
  twoFactorVerify: CapturedEnvelope<CapturedTokenData>;
}

function loadFixture(): NativeAuthFixture {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Native-auth contract fixture not found at ${FIXTURE_PATH}.\n` +
        "Generate it by running the backend's native-auth integration suite against the " +
        "disposable Postgres/Redis stack (e.g. `node scripts/run-backend-integration.js` from " +
        "the repo root) — see the 'drift-prevention fixture (ADR M-003)' test in " +
        'native-auth.integration.test.js. The generated file is committed to the repo, so this ' +
        'should only be missing in a fresh checkout that has never run that suite.',
    );
  }
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as NativeAuthFixture;
}

const fixture = loadFixture();

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function createFakeTransport(handler: (path: string, options?: RequestOptions) => Promise<HttpResponse>): Transport {
  return { request: jest.fn(handler) };
}

beforeEach(async () => {
  __resetTokenStoreForTests();
  __resetRefreshGuardForTests();
  await clearRefreshToken();
});

describe('native-auth contract fixture (real backend responses, ADR M-003 drift prevention)', () => {
  it('the fixture file actually contains all four captured responses (sanity check on the fixture itself)', () => {
    expect(fixture.signin?.data?.accessToken).toEqual(expect.any(String));
    expect(fixture.refresh?.data?.accessToken).toEqual(expect.any(String));
    expect(fixture.signin2faRequired?.data?.requires2fa).toBe(true);
    expect(fixture.twoFactorVerify?.data?.accessToken).toEqual(expect.any(String));
  });

  it('signIn() parses the real signin envelope and reads shopId from data.shopId, not user.shopId', async () => {
    const transport = createFakeTransport(async () => jsonResponse(200, fixture.signin));

    const result = await signIn('irrelevant-for-this-test@example.test', 'irrelevant', { transport });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = fixture.signin.data;
    expect(result.data.id).toBe(expected.user.id);
    expect(result.data.email).toBe(expected.user.email);
    expect(result.data.shopId).toBe(expected.shopId);
    expect(result.data.shopId).not.toBeUndefined();
  });

  it('refreshAccessToken() parses the real refresh envelope, including the now-restored user/shopId', async () => {
    await setRefreshToken('fake-transport-ignores-the-actual-value');
    const transport = createFakeTransport(async () => jsonResponse(200, fixture.refresh));

    const result = await refreshAccessToken({ transport });

    expect(result).not.toBeNull();
    const expected = fixture.refresh.data;
    expect(result?.accessToken).toBe(expected.accessToken);
    expect(result?.user.id).toBe(expected.user.id);
    // This is the Phase 1 bug this whole lane exists to fix: a cold-start refresh must restore
    // shopId, not leave the caller with `undefined` forever.
    expect(result?.user.shopId).toBe(expected.shopId);
    expect(result?.user.shopId).not.toBeUndefined();
  });

  it('the production signinDataSchema also accepts the real 2fa/verify success response (identical data shape to signin)', () => {
    const parsed = signinDataSchema.safeParse(unwrapEnvelope(fixture.twoFactorVerify));
    expect(parsed.success).toBe(true);
  });

  it('documents the requires2fa branch captured in the fixture (mobile has no 2FA UI yet — a pre-existing, separately-tracked gap, not a shape drift)', () => {
    const data = unwrapEnvelope(fixture.signin2faRequired) as CapturedTwoFaRequiredData;
    expect(data.requires2fa).toBe(true);
    expect(typeof data.tempToken).toBe('string');
  });
});
