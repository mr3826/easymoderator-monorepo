import type { AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
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
