import { z } from 'zod';

import { fetchTransport, type Transport } from '@/api/transport';
import { normalizeApiError, type NormalizedError } from '@/api/errors';
import { getAccessToken, setAccessToken } from './token-store';
import { getRefreshToken, setRefreshToken, clearRefreshToken } from './secure-store';

/**
 * Native auth client (ADR M-004).
 *
 * The backend endpoints this calls — `POST /api/auth/native/{signin,refresh,logout}` — are being
 * built by a parallel workstream against the same ADR; they do not exist yet at the time this
 * module is written. This client is written against the documented contract (tokens in the
 * response body, rotating refresh token, `sid` session claim) rather than against a live server,
 * and is unit-tested with a fake `Transport` (see `auth-client.test.ts`) so it does not block on
 * the backend landing. A backend contract test is the eventual source of truth (ADR M-003); if the
 * real response shape differs, only the zod schemas below need to change.
 */

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  shopId: z.string().nullable().optional(),
});

const signinResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userSchema,
});

const refreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type AuthUser = z.infer<typeof userSchema>;

export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: NormalizedError };

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
): Promise<AuthResult<AuthUser>> {
  const transport = deps.transport ?? fetchTransport;

  let res;
  try {
    res = await transport.request('/api/auth/native/signin', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    });
  } catch {
    return { ok: false, error: normalizeApiError({ isNetworkError: true }) };
  }

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    return { ok: false, error: normalizeApiError({ status: res.status, body }) };
  }

  const parsed = signinResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'Unexpected sign-in response shape from server.', retryable: false },
    };
  }

  setAccessToken(parsed.data.accessToken);
  await setRefreshToken(parsed.data.refreshToken);
  return { ok: true, data: parsed.data.user };
}

// --- Single-flight refresh guard -------------------------------------------------------------
//
// Multiple business requests can each receive a 401 at roughly the same moment (e.g. several
// screens fetching in parallel right when the access token expires). Without this guard, each
// would independently call `/api/auth/native/refresh`, racing to rotate the same refresh token —
// the second call would fail the "reuse of an already-rotated token" check on the server and tear
// down the whole session family. `refreshAccessToken` collapses concurrent callers onto one
// in-flight promise so exactly one HTTP call to `/refresh` is made no matter how many callers ask.

let inFlightRefresh: Promise<string | null> | null = null;

async function performRefresh(transport: Transport): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    setAccessToken(null);
    return null;
  }

  try {
    const res = await transport.request('/api/auth/native/refresh', {
      method: 'POST',
      body: { refreshToken },
      skipAuth: true,
    });
    const body = await parseJsonSafe(res);

    if (!res.ok) {
      // Includes the reuse-detected-compromise case (ADR M-004): the server revokes the whole
      // session family, so the client's only correct move is to drop everything and sign out.
      setAccessToken(null);
      await clearRefreshToken();
      return null;
    }

    const parsed = refreshResponseSchema.safeParse(body);
    if (!parsed.success) {
      setAccessToken(null);
      await clearRefreshToken();
      return null;
    }

    setAccessToken(parsed.data.accessToken);
    await setRefreshToken(parsed.data.refreshToken);
    return parsed.data.accessToken;
  } catch {
    // Network failure during refresh: leave the refresh token in place (it may still be valid),
    // but the caller gets no access token for this attempt.
    setAccessToken(null);
    return null;
  }
}

/**
 * Returns a fresh access token, making at most one `/refresh` network call no matter how many
 * concurrent callers invoke this function while a refresh is already in flight.
 */
export function refreshAccessToken(deps: AuthClientDeps = {}): Promise<string | null> {
  if (!inFlightRefresh) {
    const transport = deps.transport ?? fetchTransport;
    inFlightRefresh = performRefresh(transport).finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/** Test-only escape hatch: clears the in-flight refresh promise between tests. */
export function __resetRefreshGuardForTests(): void {
  inFlightRefresh = null;
}

export async function logout(deps: AuthClientDeps = {}): Promise<void> {
  const transport = deps.transport ?? fetchTransport;
  const refreshToken = await getRefreshToken();
  const currentAccessToken = getAccessToken();

  try {
    await transport.request('/api/auth/native/logout', {
      method: 'POST',
      body: { refreshToken },
      headers: currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : undefined,
    });
  } catch {
    // Best-effort: the server-side session is revoked opportunistically. Local state is cleared
    // unconditionally below regardless of whether this call succeeded — a merchant tapping
    // "Logout" must always end up logged out on-device, even if offline.
  }

  setAccessToken(null);
  await clearRefreshToken();
}
