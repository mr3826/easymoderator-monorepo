import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('SSEClient tenant binding', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('never sends a user-controlled shop selector to the authenticated SSE route', async () => {
    const { SSEClient } = await import('./sse-client');
    const client = new SSEClient({
      shopId: 'shop-forged',
      baseUrl: 'https://app.example.test',
    });

    const url = new URL((client as unknown as { _buildUrl: () => string })._buildUrl());

    expect(url.pathname).toBe('/api/conversation/events');
    expect(url.searchParams.has('shop_id')).toBe(false);
  });

  it('uses the clean API origin in production', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.easymod.tech');
    vi.stubEnv('VITE_APP_URL', 'https://app.easymod.tech');
    vi.stubEnv('VITE_MARKETING_URL', 'https://easymod.tech');
    const { SSEClient } = await import('./sse-client');
    const client = new SSEClient({ shopId: 'shop-1' });

    const url = new URL((client as unknown as { _buildUrl: () => string })._buildUrl());

    expect(url.origin).toBe('https://api.easymod.tech');
    expect(url.pathname).toBe('/conversation/events');
  });
});
