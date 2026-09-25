import type { ZodType } from 'zod';

import { apiRequest, type ApiClientDeps } from './client';
import type { RequestOptions } from './transport';
import type { NormalizedError } from './errors';

/**
 * Bridges the `{ok,data} | {ok,error}` `apiRequest` result (ADR M-003) onto TanStack Query's
 * throw-on-error `queryFn` contract, so `useQuery`'s own `data`/`error`/`isPending`/`isError`
 * fields work natively instead of every screen re-deriving them from an `ApiResult`.
 *
 * This is the first real `apiRequest` call site in the app (Phase 2 Home lane) — every later
 * lane's `useQuery`/`useMutation` hook should build its `queryFn`/`mutationFn` with this helper
 * rather than calling `apiRequest` directly, so `error` is always a `NormalizedError` (never a
 * bare `Error` or the raw fetch rejection) no matter which query it is.
 */
export function toQueryFn<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
  deps: ApiClientDeps = {},
): () => Promise<T> {
  return async () => {
    const result = await apiRequest(path, schema, options, deps);
    if (!result.ok) {
      // Thrown, not returned: this is what makes `useQuery`'s `error` field a `NormalizedError`.
      throw result.error;
    }
    return result.data;
  };
}

/**
 * Shared TanStack Query `retry` predicate driven by `NormalizedError.retryable` (ADR M-003) rather
 * than TanStack's default "retry any thrown error a fixed number of times" — a `validation`,
 * `unauthorized`, `forbidden`, or `notFound` error retrying automatically would just repeat the
 * same failure. Caps at 2 automatic retries for a retryable kind (network/timeout/rateLimited/
 * server); anything else fails immediately and surfaces the mapped error state with a manual retry
 * action instead.
 */
export function retryNormalizedError(failureCount: number, error: unknown): boolean {
  const kind = (error as Partial<NormalizedError> | undefined)?.retryable;
  return kind === true && failureCount < 2;
}
