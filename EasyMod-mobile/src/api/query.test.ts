import { z } from 'zod';

import { toQueryFn, retryNormalizedError } from './query';
import { apiRequest } from './client';
import type { NormalizedError } from './errors';

jest.mock('./client', () => ({
  apiRequest: jest.fn(),
}));

const mockedApiRequest = jest.mocked(apiRequest);

beforeEach(() => {
  mockedApiRequest.mockReset();
});

describe('toQueryFn', () => {
  const schema = z.object({ ok: z.boolean() });

  it('resolves with the unwrapped data on an ok result', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true, data: { ok: true } });

    const queryFn = toQueryFn('/api/mobile/today', schema);
    await expect(queryFn()).resolves.toEqual({ ok: true });
    expect(mockedApiRequest).toHaveBeenCalledWith('/api/mobile/today', schema, {}, {});
  });

  it('throws the NormalizedError on a failed result, so TanStack Query treats it as an error', async () => {
    const error: NormalizedError = { kind: 'server', message: 'Boom', retryable: true };
    mockedApiRequest.mockResolvedValue({ ok: false, error });

    const queryFn = toQueryFn('/api/mobile/today', schema);
    await expect(queryFn()).rejects.toEqual(error);
  });
});

describe('retryNormalizedError', () => {
  it('retries a retryable error up to 2 times', () => {
    const error: NormalizedError = { kind: 'network', message: 'x', retryable: true };
    expect(retryNormalizedError(0, error)).toBe(true);
    expect(retryNormalizedError(1, error)).toBe(true);
    expect(retryNormalizedError(2, error)).toBe(false);
  });

  it('never retries a non-retryable error (e.g. validation/unauthorized)', () => {
    const error: NormalizedError = { kind: 'validation', message: 'x', retryable: false };
    expect(retryNormalizedError(0, error)).toBe(false);
  });

  it('never retries a non-NormalizedError thrown value', () => {
    expect(retryNormalizedError(0, new Error('unexpected'))).toBe(false);
  });
});
