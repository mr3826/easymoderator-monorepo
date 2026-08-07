import type { AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  toastError.mockClear();
});

describe('HTTP public route translation', () => {
  it('removes the internal /api mount before an authenticated production request', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.easymod.tech');
    vi.stubEnv('VITE_APP_URL', 'https://app.easymod.tech');
    vi.stubEnv('VITE_MARKETING_URL', 'https://easymod.tech');
    const { httpClient } = await import('./client');
    const instance = httpClient.getAxiosInstance();
    instance.defaults.adapter = async (requestConfig) => ({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config: requestConfig,
    }) as AxiosResponse;

    const response = await httpClient.get('/api/auth/me');

    expect(response.config.baseURL).toBe('https://api.easymod.tech');
    expect(response.config.url).toBe('/auth/me');
  });
});

describe('anonymous auth 403s stay off the global toast', () => {
  // The backend binds every path in its anonymousAuthPaths set to the exact
  // merchant-app Origin and answers 403 with an operator-facing message. A
  // stale apex-origin tab hitting one during the migration must not surface
  // that message to the merchant — the form renders its own inline error.
  const originGated = [
    '/api/auth/signin',
    '/api/auth/signup',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/2fa/verify',
  ];

  it.each(originGated)('does not toast the origin-gate 403 for %s', async (path) => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.easymod.tech');
    vi.stubEnv('VITE_APP_URL', 'https://app.easymod.tech');
    vi.stubEnv('VITE_MARKETING_URL', 'https://easymod.tech');
    const { httpClient } = await import('./client');
    const instance = httpClient.getAxiosInstance();
    instance.defaults.adapter = async (requestConfig) => {
      // Only the endpoint under test is origin-gated. The CSRF bootstrap GET
      // must succeed, or its own failure would produce the toast instead.
      if (!requestConfig.url?.includes('/auth/')) {
        return {
          data: { csrfToken: 'test-token' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: requestConfig,
        } as AxiosResponse;
      }
      const error = new Error('Request failed with status code 403') as Error & {
        isAxiosError: boolean; config: unknown; response: unknown;
      };
      error.isAxiosError = true;
      error.config = requestConfig;
      error.response = {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: requestConfig,
        data: { message: 'Authentication requests must originate from the merchant app.' },
      };
      throw error;
    };

    await expect(httpClient.post(path, {})).rejects.toBeDefined();
    expect(toastError).not.toHaveBeenCalled();
  });
});
