/**
 * CSRF Integration — Vitest
 *
 * These tests exercise the REAL httpClient (axios) request/response interceptors
 * by swapping the axios *adapter* (the lowest layer that actually performs the
 * request). Mocking at the adapter level keeps the CSRF-injection and
 * 403-handling interceptors in play, so the assertions verify genuine behaviour
 * rather than a stubbed method.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpClient } from '@/shared/lib/http/client';
import CSRFErrorHandler from '@/shared/components/CSRFErrorHandler';

const axiosInstance = httpClient.getAxiosInstance();
const originalAdapter = axiosInstance.defaults.adapter;

/** Install a controllable axios adapter; returns the spy that receives each final config. */
function setAdapter(handler: (config: any) => unknown) {
  const adapter = vi.fn((config: any) => Promise.resolve(handler(config)) as any);
  (axiosInstance.defaults as any).adapter = adapter;
  return adapter;
}

function ok(config: any, data: unknown, status = 200) {
  return { data, status, statusText: 'OK', headers: {}, config };
}

function fail(config: any, status: number, data: unknown) {
  const err: any = new Error(`Request failed with status ${status}`);
  err.config = config;
  err.isAxiosError = true;
  err.response = { status, data, statusText: '', headers: {}, config };
  return Promise.reject(err);
}

/** Default adapter: serve a CSRF token for /api/csrf, echo success otherwise. */
function tokenThenEcho(config: any) {
  if (config.url === '/api/csrf') return ok(config, { csrfToken: 'test-csrf-token-123' });
  return ok(config, { success: true });
}

describe('CSRF Integration', () => {
  beforeEach(() => {
    httpClient.clearCsrfToken();
    httpClient.setAccessToken(null);
    setAdapter(tokenThenEcho);
  });

  afterEach(() => {
    (axiosInstance.defaults as any).adapter = originalAdapter;
    vi.restoreAllMocks();
  });

  describe('CSRF Token Initialization', () => {
    it('should fetch a CSRF token from /api/csrf on init', async () => {
      const adapter = setAdapter(tokenThenEcho);

      await httpClient.initCsrfToken();

      expect(adapter).toHaveBeenCalledTimes(1);
      expect(adapter.mock.calls[0][0].url).toBe('/api/csrf');
    });

    it('should not throw when CSRF initialization fails', async () => {
      // 400 (not 5xx) so the request-retry/backoff path stays out of this test.
      setAdapter((config) => fail(config, 400, {}));

      await expect(httpClient.initCsrfToken()).resolves.toBeUndefined();
    });
  });

  describe('CSRF Token Injection', () => {
    it('should inject the X-CSRF-Token header on mutating requests', async () => {
      const adapter = setAdapter(tokenThenEcho);
      await httpClient.initCsrfToken();

      await httpClient.post('/api/test', { data: 'test' });

      const postCall = adapter.mock.calls.find(([c]) => c.url === '/api/test');
      expect(postCall?.[0].headers['X-CSRF-Token']).toBe('test-csrf-token-123');
    });

    it('should not inject the X-CSRF-Token header on GET requests', async () => {
      const adapter = setAdapter(tokenThenEcho);
      await httpClient.initCsrfToken();

      await httpClient.get('/api/test');

      const getCall = adapter.mock.calls.find(([c]) => c.url === '/api/test');
      expect(getCall?.[0].headers['X-CSRF-Token']).toBeUndefined();
    });
  });

  describe('CSRF Error Handling', () => {
    it('should clear the CSRF token and emit csrf:invalid on a 403 invalid-csrf response', async () => {
      const onInvalid = vi.fn();
      window.addEventListener('csrf:invalid', onInvalid);

      const adapter = setAdapter((config) => {
        if (config.url === '/api/csrf') return ok(config, { csrfToken: 'test-csrf-token-123' });
        return fail(config, 403, { error: { message: 'invalid csrf token' } });
      });

      await httpClient.initCsrfToken();
      await expect(httpClient.post('/api/test', { data: 'test' })).rejects.toBeDefined();

      expect(onInvalid).toHaveBeenCalled();
      window.removeEventListener('csrf:invalid', onInvalid);

      // The token was cleared, so the next mutation must re-fetch /api/csrf.
      adapter.mockClear();
      const refetch = setAdapter(tokenThenEcho);
      await httpClient.post('/api/test2', {});
      expect(refetch.mock.calls.some(([c]) => c.url === '/api/csrf')).toBe(true);
    });
  });

  describe('CSRF Error Handler Component', () => {
    it('should display the session-expired message for a CSRF error', () => {
      render(
        <CSRFErrorHandler error={new Error('invalid csrf token')} onRetry={vi.fn()} className="test-class" />
      );

      expect(screen.getByText('Session Expired')).toBeInTheDocument();
      expect(
        screen.getByText('Your session has expired. Please refresh the page and try again.')
      ).toBeInTheDocument();
      expect(screen.getByText('Refresh Page')).toBeInTheDocument();
    });

    it('should call onRetry when the refresh button is clicked', async () => {
      const onRetry = vi.fn();
      render(<CSRFErrorHandler error={new Error('invalid csrf token')} onRetry={onRetry} />);

      await userEvent.click(screen.getByText('Refresh Page'));

      expect(onRetry).toHaveBeenCalled();
    });
  });

  describe('End-to-End CSRF Flow', () => {
    it('should initialize then send a mutation carrying the CSRF token', async () => {
      const adapter = setAdapter(tokenThenEcho);

      await httpClient.initCsrfToken();
      const response = await httpClient.post('/api/test', { data: 'test payload' });

      expect(response.data).toEqual({ success: true });
      const postCall = adapter.mock.calls.find(([c]) => c.url === '/api/test');
      expect(postCall?.[0].headers['X-CSRF-Token']).toBe('test-csrf-token-123');
    });
  });
});
