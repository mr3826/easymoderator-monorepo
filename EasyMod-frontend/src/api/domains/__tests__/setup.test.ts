import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as setup from '../setup';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
  },
}));

describe('Setup Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns setup status from the backend source of truth', async () => {
    const mockResponse = {
      data: {
        data: {
          isComplete: false,
          completedCount: 2,
          totalCount: 4,
          progressPercent: 50,
          tasks: [],
          counts: {
            connectedFacebookPages: 1,
            webhookVerifiedFacebookPages: 0,
            activeProducts: 0,
            activeFaqs: 1,
            knowledgeDocuments: 0,
          },
          generatedAt: '2026-07-04T00:00:00.000Z',
        },
      },
    };
    (httpClient.get as any).mockResolvedValue(mockResponse);

    const result = await setup.getSetupStatus();

    expect(httpClient.get).toHaveBeenCalledWith('/api/setup/status');
    expect(result.completedCount).toBe(2);
    expect(result.isComplete).toBe(false);
  });
});
