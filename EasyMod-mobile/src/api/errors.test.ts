import { normalizeApiError } from './errors';

describe('normalizeApiError', () => {
  it('normalizes a transport-level network failure', () => {
    const result = normalizeApiError({ isNetworkError: true });
    expect(result.kind).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('normalizes a client-side timeout', () => {
    const result = normalizeApiError({ isTimeout: true });
    expect(result.kind).toBe('timeout');
    expect(result.retryable).toBe(true);
  });

  // Shape 1: the AppError / global-handler envelope — { success, message, code, requestId, timestamp }.
  it('normalizes the AppError envelope shape', () => {
    const result = normalizeApiError({
      status: 404,
      body: {
        success: false,
        message: 'Order not found',
        code: 'NOT_FOUND',
        requestId: 'req-1',
        timestamp: '2026-09-14T00:00:00.000Z',
      },
    });
    expect(result.kind).toBe('notFound');
    expect(result.message).toBe('Order not found');
    expect(result.retryable).toBe(false);
    expect(result.fieldErrors).toBeUndefined();
  });

  // Shape 2: a nested error object — { success, error: { code, message } }.
  it('normalizes the nested error-object envelope shape', () => {
    const result = normalizeApiError({
      status: 400,
      body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' } },
    });
    expect(result.kind).toBe('validation');
    expect(result.message).toBe('No shop selected. Please login again.');
  });

  // Shape 3: an express-validator array — { success, errors: [{ msg, param, location }] }.
  it('normalizes the express-validator array envelope shape into fieldErrors', () => {
    const result = normalizeApiError({
      status: 400,
      body: {
        success: false,
        errors: [
          { msg: 'Email is required', param: 'email', location: 'body' },
          { msg: 'Phone is invalid', param: 'phone', location: 'body' },
        ],
      },
    });
    expect(result.kind).toBe('validation');
    expect(result.fieldErrors).toEqual([
      { field: 'email', message: 'Email is required' },
      { field: 'phone', message: 'Phone is invalid' },
    ]);
    expect(result.message).toBe('Email is required; Phone is invalid');
  });

  // Shape 4: a bare error string, no `success` flag at all — { error: string } (webhooks).
  it('normalizes the bare error-string envelope shape', () => {
    const result = normalizeApiError({ status: 401, body: { error: 'Invalid webhook signature' } });
    expect(result.kind).toBe('unauthorized');
    expect(result.message).toBe('Invalid webhook signature');
  });

  // Shape 5: a flat string error under `success` — { success, error: string }.
  it('normalizes the flat string-error-under-success envelope shape', () => {
    const result = normalizeApiError({ status: 401, body: { success: false, error: 'Unauthorized' } });
    expect(result.kind).toBe('unauthorized');
    expect(result.message).toBe('Unauthorized');
  });

  // Shape 6: a message-only envelope with no code at all — { success, message }.
  it('normalizes the message-only envelope shape', () => {
    const result = normalizeApiError({ status: 401, body: { success: false, message: 'Invalid admin key' } });
    expect(result.kind).toBe('unauthorized');
    expect(result.message).toBe('Invalid admin key');
  });

  // The INTERNAL_ERROR-default 4xx case: most unhandled 4xx responses default `code` to
  // INTERNAL_ERROR, which must not be trusted — `kind` is classified from HTTP status, not `code`.
  it('classifies by HTTP status rather than trusting a generic INTERNAL_ERROR code on a 4xx', () => {
    const result = normalizeApiError({
      status: 403,
      body: { success: false, message: 'Forbidden', code: 'INTERNAL_ERROR', requestId: 'req-2', timestamp: 'x' },
    });
    expect(result.kind).toBe('forbidden');
    expect(result.retryable).toBe(false);
  });

  it('maps 429 to rateLimited and marks it retryable', () => {
    const result = normalizeApiError({ status: 429, body: { success: false, message: 'Too many requests' } });
    expect(result.kind).toBe('rateLimited');
    expect(result.retryable).toBe(true);
  });

  it('maps 5xx to server and marks it retryable', () => {
    const result = normalizeApiError({ status: 500, body: { success: false, message: 'Boom' } });
    expect(result.kind).toBe('server');
    expect(result.retryable).toBe(true);
  });

  it('falls back to a generic message when no envelope shape matches', () => {
    const result = normalizeApiError({ status: 500, body: {} });
    expect(result.message).toBe('An unexpected error occurred.');
  });
});
