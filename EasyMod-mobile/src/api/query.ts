import type { ZodType } from 'zod';

import { apiRequest, type ApiClientDeps } from './client';
import type { NormalizedError } from './errors';
import type { RequestOptions } from './transport';

/** Adapts the shared result-based API client to TanStack Query's throwing queryFn contract. */
export function toQueryFn<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
  deps: ApiClientDeps = {},
): () => Promise<T> {
  return async () => {
    const result = await apiRequest(path, schema, options, deps);
    if (!result.ok) throw result.error;
    return result.data;
  };
}

/** Retries only normalized transient failures; auth, validation, and shape errors fail fast. */
export function retryNormalizedError(failureCount: number, error: unknown): boolean {
  const retryable = (error as Partial<NormalizedError> | undefined)?.retryable;
  return retryable === true && failureCount < 2;
}
