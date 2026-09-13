import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type GrowthAnalyticsResponse } from '@/api/client';
import { SourcesPage } from './SourcesPage';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

function makeAnalytics(overrides: Partial<GrowthAnalyticsResponse> = {}): GrowthAnalyticsResponse {
  return {
    windowDays: 90,
    generatedAt: '2026-09-13T08:00:00.000Z',
    funnel: { created: 0, contactedOrBeyond: 0, qualified: 0, onboarding: 0, activated: 0, lost: 0 },
    conversion: { createdToActivated: null },
    byStatus: {},
    bySource: {},
    activatedBySource: {},
    timing: { medianHoursToFirstContact: null, medianHoursCreatedToActivated: null },
    notAvailable: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sources']}>
      <SourcesPage />
    </MemoryRouter>,
  );
}

describe('SourcesPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  it('renders per-source leads, activations, and rates with ledger links', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics({
      bySource: { facebook: 40, manual_entry: 10 },
      activatedBySource: { facebook: 4 },
    }));

    renderPage();

    expect(await screen.findByText('facebook')).toBeInTheDocument();
    expect(screen.getByText('manual entry')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'facebook' })).toHaveAttribute('href', '/prospects?source=facebook');
    expect(screen.getByRole('link', { name: 'manual entry' })).toHaveAttribute('href', '/prospects?source=manual_entry');

    const [facebookRow, manualRow] = screen.getAllByRole('row').slice(1);
    expect(within(facebookRow).getByText('facebook')).toBeInTheDocument();
    expect(within(facebookRow).getByText('40')).toBeInTheDocument();
    expect(within(facebookRow).getByText('4')).toBeInTheDocument();
    expect(within(facebookRow).getByText('10%')).toBeInTheDocument();
    expect(within(manualRow).getByText('10')).toBeInTheDocument();
    expect(within(manualRow).getByText('0%')).toBeInTheDocument();
    expect(screen.getByText(/controlled source value/)).toBeInTheDocument();
  });

  it('shows the empty state when no leads were recorded in the window', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics());

    renderPage();

    expect(await screen.findByText('No leads were recorded in this window.')).toBeInTheDocument();
  });

  it('shows an error state with a retry affordance when analytics loading fails', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockRejectedValue(new ApiError('Analytics unavailable', 500));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Sources unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Analytics unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders a dash when a source row has no recorded leads', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics({
      bySource: {},
      activatedBySource: { event: 2 },
    }));

    renderPage();

    expect(await screen.findByText('event')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
