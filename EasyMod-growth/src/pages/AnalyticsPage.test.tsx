import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type GrowthAnalyticsResponse } from '@/api/client';
import { AnalyticsPage } from './AnalyticsPage';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

function makeAnalytics(overrides: Partial<GrowthAnalyticsResponse> = {}): GrowthAnalyticsResponse {
  return {
    windowDays: 90,
    generatedAt: '2026-09-13T08:00:00.000Z',
    funnel: { created: 100, contactedOrBeyond: 60, qualified: 25, onboarding: 8, activated: 5, lost: 12 },
    conversion: { createdToActivated: 5 },
    byStatus: { new: 40, contacted: 20, qualified: 5, onboarding: 8, converted: 5 },
    bySource: { facebook: 60 },
    activatedBySource: { facebook: 5 },
    sourceToActivation: { facebook: 8.3 },
    lostReasons: { price: 4 },
    timing: { medianHoursToFirstContact: 6.5, medianHoursToQualification: null, medianHoursToFirstFollowup: null, medianHoursCreatedToActivated: null },
    leadToActivation: 5,
    followupDiscipline: {
      total: 9, open: 3, completed: 5, cancelled: 1,
      completedOnTime: 4, completedLate: 1, overdueOpen: 2, onTimeRatePct: 80,
    },
    byOwner: [{
      ownerUserId: 'owner-1',
      displayName: 'Rumi Operator',
      created: 4,
      qualified: 2,
      converted: 1,
      qualificationRatePct: 50,
      activationRatePct: 25,
    }],
    unassigned: { openCount: 2, oldestSourceRecordedAt: '2026-09-01T06:00:00.000Z', oldestAgeDays: 12 },
    cohort: {
      basis: 'source_recorded_at',
      importedAt: 'created_at',
      eventAt: 'prospect_events.created_at',
      sourceRecordedFrom: '2026-06-15T08:00:00.000Z',
      sourceRecordedTo: '2026-09-13T08:00:00.000Z',
    },
    notAvailable: ['outreach_volume', 'reply_rate', 'cac', 'cohort_retention'],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analytics']}>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

describe('AnalyticsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  it('renders funnel steps, conversion, timing metrics, and the not reported panel', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics());

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Growth funnel' })).toBeInTheDocument();
    expect(screen.getByText('Contacted or beyond')).toBeInTheDocument();
    expect(screen.getByText('Qualified or beyond')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('6.5 h')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Not reported' })).toBeInTheDocument();
    expect(screen.getByText('outreach volume')).toBeInTheDocument();
    expect(screen.getAllByText('No source data is recorded for this measure yet.')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Prospects by status' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('drills through to the exact cohort window rather than an unfiltered ledger', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics());

    renderPage();

    await screen.findByRole('heading', { name: 'Growth funnel' });
    const qualifiedLink = screen.getByRole('link', { name: '25' });
    expect(qualifiedLink).toHaveAttribute(
      'href',
      '/prospects?stage=qualified&sourceRecordedAfter=2026-06-15T08%3A00%3A00.000Z&sourceRecordedBefore=2026-09-13T08%3A00%3A00.000Z',
    );
    const statusLink = screen.getByRole('link', { name: '40' });
    expect(statusLink.getAttribute('href')).toContain('status=new');
    expect(statusLink.getAttribute('href')).toContain('sourceRecordedAfter=');
    expect(statusLink.getAttribute('href')).toContain('sourceRecordedBefore=');
    const activatedLink = screen.getAllByRole('link')
      .find((link) => (link.getAttribute('href') ?? '').includes('activated=true'));
    expect(activatedLink?.getAttribute('href')).toBe(
      '/prospects?activated=true&sourceRecordedAfter=2026-06-15T08%3A00%3A00.000Z&sourceRecordedBefore=2026-09-13T08%3A00%3A00.000Z',
    );
    const createdLink = screen.getAllByRole('link')
      .find((link) => (link.getAttribute('href') ?? '').startsWith('/prospects?sourceRecordedAfter='));
    expect(createdLink).toBeDefined();
    expect(createdLink?.textContent).toBe('100');
  });

  it('renders follow-up discipline, owner performance, and unassigned age', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics());

    renderPage();

    await screen.findByRole('heading', { name: 'Follow-up discipline' });
    expect(screen.getByText('80%')).toBeInTheDocument();
    const ownerLink = screen.getByRole('link', { name: 'Rumi Operator' });
    expect(ownerLink).toHaveAttribute('href', '/prospects?owner=owner-1');
    expect(screen.getByText(/2 unassigned live prospects · oldest 12 days/)).toBeInTheDocument();
  });

  it('scales funnel bars proportionally to the largest stage', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics());

    renderPage();

    await screen.findByRole('heading', { name: 'Growth funnel' });
    const bars = screen.getAllByRole('listitem');
    const createdRow = bars[0];
    const qualifiedRow = bars[2];
    expect(createdRow.querySelector('.funnel-bar')).toHaveStyle({ width: '100%' });
    expect(qualifiedRow.querySelector('.funnel-bar')).toHaveStyle({ width: '25%' });
  });

  it('refetches when a different window is selected', async () => {
    const analytics = vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics({ windowDays: 30 }));

    renderPage();

    await screen.findByRole('heading', { name: 'Growth funnel' });
    analytics.mockClear();
    await userEvent.setup().click(screen.getByRole('button', { name: '30 days' }));

    expect(analytics).toHaveBeenCalledWith(30);
    expect(await screen.findByText('Last 30 days')).toBeInTheDocument();
  });

  it('shows dashes for null conversion and timing values', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockResolvedValue(makeAnalytics({
      conversion: { createdToActivated: null },
      timing: { medianHoursToFirstContact: null, medianHoursToQualification: null, medianHoursToFirstFollowup: null, medianHoursCreatedToActivated: null },
    }));

    renderPage();

    const nulls = await screen.findAllByText('—');
    expect(nulls.length).toBeGreaterThanOrEqual(3);
  });

  it('shows an error state with retry when analytics loading fails', async () => {
    vi.spyOn(workspaceApi, 'growthAnalytics').mockRejectedValue(new ApiError('Analytics service down', 500));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Analytics unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Analytics service down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
