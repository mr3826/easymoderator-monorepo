import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FeatureGate } from '../FeatureGate';
import { useSubscriptionFeatures } from '@/app/lib/useSubscriptionFeatures';

vi.mock('@/app/lib/useSubscriptionFeatures', () => ({
  useSubscriptionFeatures: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const mockedHook = vi.mocked(useSubscriptionFeatures);

const gated = (
  <MemoryRouter>
    <FeatureGate
      feature="advanced_ai"
      featureLabel="Advanced AI"
      requiredPlan="Growth"
    >
      <div>gated content</div>
    </FeatureGate>
  </MemoryRouter>
);

describe('FeatureGate entitlement failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not present unavailable entitlements as a confirmed upgrade restriction', () => {
    mockedHook.mockReturnValue({
      features: {
        image_understanding: false,
        advanced_ai: false,
        priority_support: false,
        custom_branding: false,
      },
      planName: 'Unavailable',
      plan: null,
      loading: false,
      error: 'Failed to load subscription features',
    });

    render(gated);

    expect(screen.getByTestId('feature-gate-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Feature availability is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/upgrade to unlock/i)).not.toBeInTheDocument();
  });

  it('keeps gated content blocked while entitlements are loading', () => {
    mockedHook.mockReturnValue({
      features: {
        image_understanding: false,
        advanced_ai: false,
        priority_support: false,
        custom_branding: false,
      },
      planName: 'Loading',
      plan: null,
      loading: true,
      error: null,
    });

    render(gated);

    expect(screen.getByTestId('feature-gate-loading')).toBeInTheDocument();
    expect(screen.getByText('Checking feature availability...')).toBeInTheDocument();
  });
});
