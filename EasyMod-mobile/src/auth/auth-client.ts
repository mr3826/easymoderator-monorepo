import { z } from 'zod';

import { fetchTransport, type Transport } from '@/api/transport';
import { normalizeApiError, type NormalizedError } from '@/api/errors';
import { getAccessToken, setAccessToken } from './token-store';
import { getRefreshToken, setRefreshToken, clearRefreshToken } from './secure-store';

/**
 * Native auth client (ADR M-004).
 *
 * Phase 2 contract-reconciliation correction: Phase 1 wrote this client against the *documented*
 * contract only — the backend endpoints it calls did not exist yet, and this module was
 * unit-tested exclusively with a fake `Transport` that returned whatever shape these schemas
 * happened to expect (`auth-client.test.ts`). No test ever crossed the real HTTP boundary, so
 * three real drifts from the actual backend shipped unnoticed: every response is wrapped as
 * `{ success, message, data }` (`native-auth.controller.js`), not raw; refresh requires the body
 * field `refresh_token` (snake_case, `native.validator.js`), not `refreshToken`; and `shopId` is
 * returned at the top level of `data`, never nested under `user` (the backend's `safeUser()` has
 * no `shopId` field at all). All three are fixed below.
 *
 * The durable fix is mechanical, not just this patch: `__fixtures__/native-auth-fixture.test.ts`
 * loads the real response bodies the backend's own integration suite writes to a committed JSON
 * fixture (`EasyMod-backend/.../__fixtures__/native-auth-responses.json`) and parses them with
 * these exact production schemas. If either side drifts again, that test fails immediately.
 */

/** Matches `native-auth.service.js`'s `safeUser(user)` exactly — no `shopId` field lives here. */
const backendUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  profile_picture: z.string().nullable(),
});

/**
 * The shape mobile actually wants to carry around: the backend's user record plus the shopId that
 * the server returns as a SIBLING of `user` in the response envelope, not a field on it. Read it
 * from `data.shopId`, never from `user.shopId` (that field does not exist server-side).
 */
export type AuthUser = z.infer<typeof backendUserSchema> & { shopId: string | null };

/**
 * Every EasyMod-backend success response is wrapped as `{ success, message, data }`
 * (`native-auth.controller.js`'s `res.json({ success, message, data: {...} })`). Error envelopes
 * are flat, not wrapped (see `api/errors.ts`'s six documented shapes), so this only ever needs to
 * run on the `res.ok` path, before schema validation.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

/**
 * `signin` and `2fa/verify` return an identical `data` shape on success
 * (`native-auth.controller.js`) — this schema is exported so
 * `native-auth-contract.test.ts` can parse the committed backend fixture with the exact same
 * production schema both request functions use to validate real responses.
 */
export const signinDataSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  sid: z.string().optional(),
  shopId: z.string().nullable(),
  user: backendUserSchema,
});

/** The backend's successful password step when TOTP verification is still required. */
export const requires2faDataSchema = z.object({
  requires2fa: z.literal(true),
  tempToken: z.string().min(1),
});
export type TwoFactorRequired = z.infer<typeof requires2faDataSchema>;

/** Sign-in has two successful response states: a session, or an explicit MFA handoff. */
export const signinResponseDataSchema = z.union([signinDataSchema, requires2faDataSchema]);

/** Exported for the same reason as `signinDataSchema` above. */
export const refreshDataSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  // Additive on the backend (Phase 2): refresh now returns the same shopId + safeUser shape
  // signin/2fa-verify do, so a cold-start refresh can fully restore session context.
  shopId: z.string().nullable(),
  user: backendUserSchema,
});

/** Exported for the same reason as `signinDataSchema` above. */
export { unwrapEnvelope };

/** What a successful refresh hands back to callers that need to restore session context. */
export interface RefreshedSession {
  accessToken: string;
  user: AuthUser;
}

export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: NormalizedError };
export type SignInResult = AuthResult<AuthUser | TwoFactorRequired>;

export interface AuthClientDeps {
  transport?: Transport;
}

async function parseJsonSafe(res: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function signIn(
  email: string,
  password: string,
  deps: AuthClientDeps = {},
): Promise<SignInResult> {
  const requestEpoch = beginAuthTransition();
  const transport = deps.transport ?? fetchTransport;

  let res;
  try {
    res = await transport.request('/api/auth/native/signin', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    });
  } catch (error) {
    finishAuthTransition(requestEpoch);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return { ok: false, error: normalizeApiError(isTimeout ? { isTimeout: true } : { isNetworkError: true }) };
  }

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    finishAuthTransition(requestEpoch);
    return { ok: false, error: normalizeApiError({ status: res.status, body }) };
  }

  const parsed = signinResponseDataSchema.safeParse(unwrapEnvelope(body));
  if (!parsed.success) {
    finishAuthTransition(requestEpoch);
    return {
      ok: false,
      error: { kind: 'unknown', message: 'Unexpected sign-in response shape from server.', retryable: false },
    };
  }

  if ('requires2fa' in parsed.data) {
    if (!isCurrentAuthEpoch(requestEpoch)) {
      return { ok: false, error: supersededAuthError };
    }
    // The temporary credential is returned to the caller only as an explicit contract state. Clear
    // any previous session before the caller presents the dedicated verification screen.
    setAccessToken(null);
    await clearRefreshTokenForEpoch(requestEpoch);
    finishAuthTransition(requestEpoch);
    return { ok: true, data: parsed.data };
  }

  const { accessToken, refreshToken, shopId, user } = parsed.data;
  if (!isCurrentAuthEpoch(requestEpoch)) {
    return { ok: false, error: supersededAuthError };
  }

  try {
    setAccessToken(accessToken);
    await writeRefreshTokenForEpoch(requestEpoch, refreshToken);
  } catch (error) {
    finishAuthTransition(requestEpoch);
    throw error;
  }
  if (!isCurrentAuthEpoch(requestEpoch)) {
    return { ok: false, error: supersededAuthError };
  }

  refreshBlocked = false;
  return { ok: true, data: { ...user, shopId } };
}

/**
 * Completes the native password/TOTP handoff. The tempToken stays in the caller's memory only;
 * this function installs a session only after the server returns the full token response.
 */
export async function verifyTwoFactor(
  tempToken: string,
  token: string,
  deps: AuthClientDeps = {},
): Promise<AuthResult<AuthUser>> {
  const requestEpoch = beginAuthTransition();
  const transport = deps.transport ?? fetchTransport;

  let res;
  try {
    res = await transport.request('/api/auth/native/2fa/verify', {
      method: 'POST',
      body: { tempToken, token },
      skipAuth: true,
    });
  } catch (error) {
    finishAuthTransition(requestEpoch);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return { ok: false, error: normalizeApiError(isTimeout ? { isTimeout: true } : { isNetworkError: true }) };
  }

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    finishAuthTransition(requestEpoch);
    return { ok: false, error: normalizeApiError({ status: res.status, body }) };
  }

  const parsed = signinDataSchema.safeParse(unwrapEnvelope(body));
  if (!parsed.success) {
    finishAuthTransition(requestEpoch);
    return {
      ok: false,
      error: { kind: 'unknown', message: 'Unexpected two-factor response shape from server.', retryable: false },
    };
  }

  const { accessToken, refreshToken, shopId, user } = parsed.data;
  if (!isCurrentAuthEpoch(requestEpoch)) {
    return { ok: false, error: supersededAuthError };
  }

  try {
    setAccessToken(accessToken);
    await writeRefreshTokenForEpoch(requestEpoch, refreshToken);
  } catch (error) {
    finishAuthTransition(requestEpoch);
    throw error;
  }
  if (!isCurrentAuthEpoch(requestEpoch)) {
    return { ok: false, error: supersededAuthError };
  }

  refreshBlocked = false;
  return { ok: true, data: { ...user, shopId } };
}

/** Invalidates a pending native MFA request without creating a session or calling another auth path. */
/**
 * Resolves `true` only when this cancellation is still the latest auth transition once its
 * SecureStore write settles; `false` means a newer sign-in superseded it and owns the auth state.
 */
export async function cancelTwoFactor(): Promise<boolean> {
  const requestEpoch = beginAuthTransition();
  setAccessToken(null);
  await clearRefreshTokenForEpoch(requestEpoch);
  finishAuthTransition(requestEpoch);
  return isCurrentAuthEpoch(requestEpoch);
}

// --- Single-flight refresh guard -------------------------------------------------------------
//
// Multiple business requests can each receive a 401 at roughly the same moment (e.g. several
// screens fetching in parallel right when the access token expires). Without this guard, each
// would independently call `/api/auth/native/refresh`, racing to rotate the same refresh token —
// the second call would fail the "reuse of an already-rotated token" check on the server and tear
// down the whole session family. `refreshAccessToken` collapses concurrent callers onto one
// in-flight promise so exactly one HTTP call to `/refresh` is made no matter how many callers ask.

let inFlightRefresh: Promise<RefreshedSession | null> | null = null;
let authEpoch = 0;
let refreshBlocked = false;
let secureStoreWrite: Promise<void> = Promise.resolve();

const supersededAuthError: NormalizedError = {
  kind: 'unknown',
  message: 'Authentication state changed before the request completed.',
  retryable: false,
};

/** Invalidates work from the previous auth state and prevents refresh until the transition settles. */
function beginAuthTransition(): number {
  authEpoch += 1;
  refreshBlocked = true;
  inFlightRefresh = null;
  return authEpoch;
}

function isCurrentAuthEpoch(epoch: number): boolean {
  return authEpoch === epoch;
}

function finishAuthTransition(epoch: number): void {
  if (isCurrentAuthEpoch(epoch)) refreshBlocked = false;
}

async function isCurrentRefresh(epoch: number, refreshToken: string): Promise<boolean> {
  if (!isCurrentAuthEpoch(epoch) || refreshBlocked) return false;
  const currentRefreshToken = await getRefreshToken();
  return isCurrentAuthEpoch(epoch) && !refreshBlocked && currentRefreshToken === refreshToken;
}

/** Serializes SecureStore writes so logout/sign-in cannot reorder an older async write. */
function enqueueSecureStoreWrite(operation: () => Promise<void>): Promise<void> {
  const next = secureStoreWrite.then(operation, operation);
  secureStoreWrite = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function writeRefreshTokenForEpoch(epoch: number, refreshToken: string): Promise<void> {
  return enqueueSecureStoreWrite(async () => {
    if (isCurrentAuthEpoch(epoch)) await setRefreshToken(refreshToken);
  });
}

function clearRefreshTokenForEpoch(epoch: number): Promise<void> {
  return enqueueSecureStoreWrite(async () => {
    if (isCurrentAuthEpoch(epoch)) await clearRefreshToken();
  });
}

async function performRefresh(transport: Transport, epoch: number): Promise<RefreshedSession | null> {
  const refreshToken = await getRefreshToken();
  if (!isCurrentAuthEpoch(epoch)) return null;

  if (!refreshToken) {
    setAccessToken(null);
    return null;
  }

  try {
    // native.validator.js's nativeRefreshValidator requires `refresh_token` (snake_case) — there
    // is no cookie fallback and no `refreshToken` alias on the backend.
    const res = await transport.request('/api/auth/native/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
      skipAuth: true,
    });
    const body = await parseJsonSafe(res);

    if (!(await isCurrentRefresh(epoch, refreshToken))) return null;

    if (!res.ok) {
      // Includes the reuse-detected-compromise case (ADR M-004): the server revokes the whole
      // session family, so the client's only correct move is to drop everything and sign out.
      setAccessToken(null);
      await clearRefreshTokenForEpoch(epoch);
      return null;
    }

    const parsed = refreshDataSchema.safeParse(unwrapEnvelope(body));
    if (!parsed.success) {
      setAccessToken(null);
      await clearRefreshTokenForEpoch(epoch);
      return null;
    }

    if (!(await isCurrentRefresh(epoch, refreshToken))) return null;

    setAccessToken(parsed.data.accessToken);
    await writeRefreshTokenForEpoch(epoch, parsed.data.refreshToken);
    if (!isCurrentAuthEpoch(epoch)) return null;
    return {
      accessToken: parsed.data.accessToken,
      user: { ...parsed.data.user, shopId: parsed.data.shopId },
    };
  } catch {
    // Network failure during refresh: leave the refresh token in place (it may still be valid),
    // but the caller gets no access token for this attempt.
    if (await isCurrentRefresh(epoch, refreshToken)) setAccessToken(null);
    return null;
  }
}

/**
 * Returns a fresh access token AND the user/shop it belongs to, making at most one `/refresh`
 * network call no matter how many concurrent callers invoke this function while a refresh is
 * already in flight. Callers that only need the token for a truthiness check (e.g. `client.ts`'s
 * 401-retry) can ignore the `user` field; `AuthProvider`'s cold-start bootstrap uses it to restore
 * `user` after an app relaunch, since the backend's refresh response now returns it too.
 */
export function refreshAccessToken(deps: AuthClientDeps = {}): Promise<RefreshedSession | null> {
  if (refreshBlocked) return Promise.resolve(null);

  if (!inFlightRefresh) {
    const transport = deps.transport ?? fetchTransport;
    const refreshPromise = performRefresh(transport, authEpoch);
    inFlightRefresh = refreshPromise;
    void refreshPromise.then(
      () => {
        if (inFlightRefresh === refreshPromise) inFlightRefresh = null;
      },
      () => {
        if (inFlightRefresh === refreshPromise) inFlightRefresh = null;
      },
    );
  }
  return inFlightRefresh;
}

/** Test-only escape hatch: invalidates in-flight auth work between tests. */
export function __resetRefreshGuardForTests(): void {
  authEpoch += 1;
  refreshBlocked = false;
  inFlightRefresh = null;
}

/**
 * Resolves `true` when this logout cleared the on-device credentials, `false` when a newer auth
 * transition superseded it (callers must then leave the newer session's state alone).
 */
export async function logout(deps: AuthClientDeps = {}): Promise<boolean> {
  const requestEpoch = beginAuthTransition();
  const transport = deps.transport ?? fetchTransport;
  const currentAccessToken = getAccessToken();
  const refreshToken = await getRefreshToken();
  if (!isCurrentAuthEpoch(requestEpoch)) return false;

  try {
    await transport.request('/api/auth/native/logout', {
      method: 'POST',
      body: { refresh_token: refreshToken },
      headers: currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : undefined,
    });
  } catch {
    // Best-effort: the server-side session is revoked opportunistically. Local state is cleared
    // unconditionally below regardless of whether this call succeeded — a merchant tapping
    // "Logout" must always end up logged out on-device, even if offline.
  }

  if (!isCurrentAuthEpoch(requestEpoch)) return false;

  setAccessToken(null);
  await clearRefreshTokenForEpoch(requestEpoch);
  return isCurrentAuthEpoch(requestEpoch);
}
