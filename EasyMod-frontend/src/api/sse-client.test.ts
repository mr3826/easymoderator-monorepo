import { beforeEach, describe, expect, it } from 'vitest';
import { SSEClient } from './sse-client';

describe('SSEClient tenant binding', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('never sends a user-controlled shop selector to the authenticated SSE route', () => {
    const client = new SSEClient({
      shopId: 'shop-forged',
      baseUrl: 'https://app.example.test',
    });

    const url = new URL((client as unknown as { _buildUrl: () => string })._buildUrl());

    expect(url.pathname).toBe('/api/conversation/events');
    expect(url.searchParams.has('shop_id')).toBe(false);
  });
});
