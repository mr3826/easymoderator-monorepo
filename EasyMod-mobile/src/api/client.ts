import type { ZodType } from 'zod';

import { fetchTransport, type RequestOptions, type Transport } from './transport';
import { normalizeApiError, type NormalizedError } from './errors';
import { refreshAccessToken } from '@/auth/auth-client';

/**
 * Typed API client (ADR M-003). One module attaches `Authorization: Bearer` and `X-EM-Client`
 * (both handled by `Transport`, see `transport.ts`), validates every response with a `zod`
 * schema, and normalizes every failure (transport-level, HTTP-level, or shape-mismatch) into the
 * one `{ kind, message, retryable, fieldErrors? }` shape from `errors.ts`.
 *
 * On a 401, this client makes exactly one attempt to refresh the access token (via the
 * single-flight guard in `auth-client.ts`) and retries the original request once with the new
 * token before giving up and surfacing an `unauthorized` error.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: NormalizedError };

export interface ApiClientDeps {
  transport?: Transport;
}

const BODY_TIMED_OUT = Symbol('bodyTimedOut');

/**
 * `undefined` for an unreadable body; `BODY_TIMED_OUT` when the transport's timeout aborted the
 * body read, so a stalled response is reported as a retryable timeout rather than as a
 * non-retryable "unexpected response shape".
 */
async function parseJsonSafe(res: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch (err) {
    return err instanceof Error && err.name === 'AbortError' ? BODY_TIMED_OUT : undefined;
  }
}

/**
 * Every successful EasyMod-backend response is wrapped as
 * `{ success, message, data }` (e.g. `native-auth.controller.js`'s
 * `res.json({ success, message, data: {...} })`). Error envelopes are NOT
 * wrapped this way (see `errors.ts`'s six documented shapes, all flat), so
 * this only ever needs to run on the `res.ok` path, before schema
 * validation. A body with no `data` key falls back to itself, so this stays
 * harmless if it is ever pointed at a genuinely unenveloped response.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
  deps: ApiClientDeps = {},
): Promise<ApiResult<T>> {
  const transport = deps.transport ?? fetchTransport;

  let res;
  try {
    res = await transport.request(path, options);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: normalizeApiError(isTimeout ? { isTimeout: true } : { isNetworkError: true }) };
  }

  if (res.status === 401 && !options.skipAuth) {
    // `refreshAccessToken` now resolves a `{ accessToken, user } | null` (Phase 2: refresh also
    // restores session context) — this call site only needs the truthiness check.
    const refreshed = await refreshAccessToken({ transport });
    if (refreshed) {
      try {
        res = await transport.request(path, options);
      } catch {
        return { ok: false, error: normalizeApiError({ isNetworkError: true }) };
      }
    }
  }

  const body = await parseJsonSafe(res);

  if (body === BODY_TIMED_OUT) {
    return { ok: false, error: normalizeApiError({ isTimeout: true }) };
  }

  if (!res.ok) {
    return { ok: false, error: normalizeApiError({ status: res.status, body }) };
  }

  const parsed = schema.safeParse(unwrapEnvelope(body));
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'Unexpected response shape from server.',
        retryable: false,
      },
    };
  }

  return { ok: true, data: parsed.data };
}
