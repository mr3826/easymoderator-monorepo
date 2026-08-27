import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/api';
import {
  invalidateSubscriptionCache,
  useSubscriptionFeatures,
} from '../useSubscriptionFeatures';

vi.mock('@/api', () => ({
  apiClient: {
    getSubscription: vi.fn(),
  },
}));

const getSubscription = vi.mocked(apiClient.getSubscription);

const waitForResolution = async (result: { current: { loading: boolean } }) => {
  await waitFor(() => expect(result.current.loading).toBe(false));
};

describe('useSubscriptionFeatures', () => {
  beforeEach(() => {
    invalidateSubscriptionCache();
    getSubscription.mockReset();
  });

  it('normalizes the backend subscription envelope and derives features', async () => {
    getSubscription.mockResolvedValue({
      subscription: {
        plan_code: 'database-plan',
        plan_name: 'Database Plan',
        features: {
          image_understanding: true,
          advanced_ai: true,
          priority_support: false,
          custom_branding: true,
        },
      },
      usage: {},
      extra_usage: {},
    } as never);

    const { result } = renderHook(() => useSubscriptionFeatures());
    await waitForResolution(result);

    expect(result.current.error).toBeNull();
    expect(result.current.planName).toBe('Database Plan');
    expect(result.current.features).toEqual({
      image_understanding: true,
      advanced_ai: true,
      priority_support: false,
      custom_branding: true,
    });
  });

  it('retains compatibility with a flat subscription response', async () => {
    getSubscription.mockResolvedValue({
      plan_code: 'database-plan',
      features: {
        image_understanding: false,
        advanced_ai: true,
        priority_support: true,
        custom_branding: false,
      },
    } as never);

    const { result } = renderHook(() => useSubscriptionFeatures());
    await waitForResolution(result);

    expect(result.current.error).toBeNull();
    expect(result.current.features.advanced_ai).toBe(true);
    expect(result.current.features.image_understanding).toBe(false);
  });

  it.each([
    ['rejected API', () => Promise.reject(new Error('network down'))],
    ['null response', () => Promise.resolve(null)],
    ['malformed envelope', () => Promise.resolve({ subscription: null })],
  ])('locks every feature for %s', async (_label, responseFactory) => {
    getSubscription.mockReturnValue(responseFactory() as never);

    const { result } = renderHook(() => useSubscriptionFeatures());
    await waitForResolution(result);

    expect(result.current.error).toBe('Failed to load subscription features');
    expect(result.current.features).toEqual({
      image_understanding: false,
      advanced_ai: false,
      priority_support: false,
      custom_branding: false,
    });
  });
});
