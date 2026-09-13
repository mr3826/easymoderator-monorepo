/**
 * API error normalization (ADR M-003).
 *
 * `EasyMod-backend` currently produces six distinct JSON error envelope shapes across its route
 * handlers (see `docs/mobile/CURRENT_STATE.md` §11 and, for concrete examples,
 * `EasyMod-backend/src/utils/AppError.js` plus assorted route/middleware error responses):
 *
 *   1. The `AppError`/global-handler shape:      { success: false, message, code, requestId, timestamp }
 *   2. A nested error object:                    { success: false, error: { code, message } }
 *   3. An express-validator array:               { success: false, errors: [{ msg, param, ... }, ...] }
 *   4. A bare error string (mostly webhooks):     { error: string }
 *   5. A flat string error under `success`:       { success: false, error: string }
 *   6. A message-only envelope (no code at all):  { success: false, message: string }
 *
 * Most unhandled 4xx responses default `code` to `INTERNAL_ERROR`, which is meaningless for
 * client branching — this normalizer classifies `kind` from the HTTP status code first, and only
 * falls back to inspecting `code`/message text when the status itself is ambiguous (network
 * failures have no status at all).
 *
 * The single source of truth for whether an assumption here is correct is a backend contract
 * test (ADR M-003) — this module encodes what has been observed, not a guarantee the backend
 * will never add a seventh shape.
 */

export type ErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'rateLimited'
  | 'server'
  | 'unknown';

export interface FieldError {
  field: string;
  message: string;
}

export interface NormalizedError {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
  fieldErrors?: FieldError[];
}

const RETRYABLE_KINDS: ReadonlySet<ErrorKind> = new Set(['network', 'timeout', 'rateLimited', 'server']);

function kindFromStatus(status: number): ErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 422 || status === 400) return 'validation';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'unknown';
  return 'unknown';
}

/** Best-effort extraction of a field name from an express-validator error item. */
function fieldNameOf(item: Record<string, unknown>): string {
  const candidate = item.path ?? item.param ?? item.field;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'unknown';
}

function fieldMessageOf(item: Record<string, unknown>): string {
  const candidate = item.msg ?? item.message;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'Invalid value';
}

interface ExtractedEnvelope {
  message?: string;
  fieldErrors?: FieldError[];
}

/** Tries each of the six known envelope shapes, in order, and returns whatever it can extract. */
function extractEnvelope(body: unknown): ExtractedEnvelope {
  if (!body || typeof body !== 'object') return {};
  const obj = body as Record<string, unknown>;

  // Shape 3: { success: false, errors: [...] } (express-validator array — field-level detail).
  if (Array.isArray(obj.errors)) {
    const fieldErrors = obj.errors
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({ field: fieldNameOf(item), message: fieldMessageOf(item) }));
    if (fieldErrors.length > 0) {
      return { message: fieldErrors.map((f) => f.message).join('; '), fieldErrors };
    }
  }

  // Shape 2: { success: false, error: { code, message } } (nested error object).
  if (obj.error && typeof obj.error === 'object') {
    const nested = obj.error as Record<string, unknown>;
    if (typeof nested.message === 'string' && nested.message.length > 0) {
      return { message: nested.message };
    }
  }

  // Shape 5: { success: false, error: 'string' } (flat string error under `success`).
  if (typeof obj.error === 'string' && obj.error.length > 0) {
    return { message: obj.error };
  }

  // Shapes 1 and 6: { success: false, message, code?, ... } — AppError envelope or message-only.
  if (typeof obj.message === 'string' && obj.message.length > 0) {
    return { message: obj.message };
  }

  return {};
}

export interface NormalizeApiErrorInput {
  /** HTTP status code, or `undefined` for a transport-level failure (no response at all). */
  status?: number;
  /** Parsed JSON response body, if any was received. */
  body?: unknown;
  /** Set when the failure was a network/connectivity error (fetch rejected, no response). */
  isNetworkError?: boolean;
  /** Set when the failure was a client-side request timeout (AbortController fired). */
  isTimeout?: boolean;
}

const FALLBACK_MESSAGE = 'An unexpected error occurred.';

export function normalizeApiError(input: NormalizeApiErrorInput): NormalizedError {
  const { status, body, isNetworkError, isTimeout } = input;

  if (isTimeout) {
    return { kind: 'timeout', message: 'The request timed out.', retryable: true };
  }
  if (isNetworkError || status === undefined) {
    return { kind: 'network', message: 'Could not reach the server.', retryable: true };
  }

  const kind = kindFromStatus(status);
  const extracted = extractEnvelope(body);
  const message = extracted.message ?? FALLBACK_MESSAGE;

  return {
    kind,
    message,
    retryable: RETRYABLE_KINDS.has(kind),
    ...(extracted.fieldErrors ? { fieldErrors: extracted.fieldErrors } : {}),
  };
}
