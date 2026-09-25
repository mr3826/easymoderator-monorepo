import { z } from 'zod';

import { apiRequest } from './client';
import type { HttpResponse, Transport } from './transport';

const schema = z.object({ order_count: z.number() });

function transportReturning(response: HttpResponse): Transport {
  return { request: jest.fn(async () => response) };
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

describe('apiRequest failure classification', () => {
  it('classifies a timeout while reading the response body as a retryable timeout', async () => {
    // The transport's AbortController fires after headers arrived but before the body finished.
    const transport = transportReturning({
      status: 200,
      ok: true,
      json: async () => {
        throw abortError();
      },
    });

    const result = await apiRequest('/api/mobile/today', schema, {}, { transport });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: 'timeout', retryable: true }) });
  });

  it('classifies a timeout before any response as a retryable timeout', async () => {
    const transport: Transport = {
      request: jest.fn(async () => {
        throw abortError();
      }),
    };

    const result = await apiRequest('/api/mobile/today', schema, {}, { transport });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: 'timeout', retryable: true }) });
  });

  it('still reports an unparseable 200 body as an unexpected shape, not a timeout', async () => {
    const transport = transportReturning({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });

    const result = await apiRequest('/api/mobile/today', schema, {}, { transport });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: 'unknown', retryable: false }) });
  });

  it('parses a well-formed success envelope', async () => {
    const transport = transportReturning({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: { order_count: 3 } }),
    });

    await expect(apiRequest('/api/mobile/today', schema, {}, { transport })).resolves.toEqual({
      ok: true,
      data: { order_count: 3 },
    });
  });
});
