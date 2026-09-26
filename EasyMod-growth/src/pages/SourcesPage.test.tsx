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
    sourceToActivation: {},
    lostReasons: {},
    timing: { medianHoursToFirstContact: null, medianHoursToQualification: null, medianHoursToFirstFollowup: null, medianHoursCreatedToActivated: null },
    leadToActivation: null,
    cohort: {
      basis: 'source_recorded_at',
      importedAt: 'created_at',
      eventAt: 'prospect_events.created_at',
      sourceRecordedFrom: '2026-06-15T08:00:00.000Z',
      sourceRecordedTo: '2026-09-13T08:00:00.000Z',
    },
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
    expect(screen.getAllByRole('link', { name: 'facebook' })[0].getAttribute('href')).toContain('source=facebook');
    expect(screen.getAllByRole('link', { name: 'facebook' })[0].getAttribute('href')).toContain('sourceRecordedAfter=');
    expect(screen.getAllByRole('link', { name: 'facebook' })[0].getAttribute('href')).toContain('sourceRecordedBefore=');
    expect(screen.getAllByRole('link', { name: 'manual entry' })[0].getAttribute('href')).toContain('source=manual_entry');
    expect(screen.getAllByRole('link', { name: 'manual entry' })[0].getAttribute('href')).toContain('sourceRecordedAfter=');

    const [facebookRow, manualRow] = screen.getAllByRole('row').slice(1);
    expect(within(facebookRow).getByText('facebook')).toBeInTheDocument();
    // Every counted cell drills through to its exact population.
    expect(within(facebookRow).getByRole('link', { name: '40' }).getAttribute('href'))
      .toBe('/prospects?source=facebook&sourceRecordedAfter=2026-06-15T08%3A00%3A00.000Z&sourceRecordedBefore=2026-09-13T08%3A00%3A00.000Z');
    const facebookActivated = within(facebookRow).getByRole('link', { name: '4' });
    expect(facebookActivated.getAttribute('href')).toContain('source=facebook');
    expect(facebookActivated.getAttribute('href')).toContain('activated=true');
    expect(within(facebookRow).getByText('10%')).toBeInTheDocument();
    expect(within(manualRow).getByRole('link', { name: '10' })).toBeInTheDocument();
    expect(within(manualRow).getByRole('link', { name: '0' }).getAttribute('href')).toContain('activated=true');
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
