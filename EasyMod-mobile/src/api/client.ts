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

async function parseJsonSafe(res: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
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
    const newToken = await refreshAccessToken({ transport });
    if (newToken) {
      try {
        res = await transport.request(path, options);
      } catch {
        return { ok: false, error: normalizeApiError({ isNetworkError: true }) };
      }
    }
  }

  const body = await parseJsonSafe(res);

  if (!res.ok) {
    return { ok: false, error: normalizeApiError({ status: res.status, body }) };
  }

  const parsed = schema.safeParse(body);
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
