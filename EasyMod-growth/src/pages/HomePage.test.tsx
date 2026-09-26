import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type HomeResponse } from '@/api/client';
import { HomePage } from './HomePage';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({
    reportApiError,
    session: { permissions: ['growth_os.followups.manage'] },
  }),
}));

function makeHome(overrides: Partial<HomeResponse> = {}): HomeResponse {
  return {
    generatedAt: '2026-09-13T08:00:00.000Z',
    windows: {
      attentionSince: '2026-09-06T08:00:00.000Z',
      attentionUntil: '2026-09-13T08:00:00.000Z',
      stalledBefore: '2026-08-29T08:00:00.000Z',
      businessTimeZone: 'Asia/Dhaka',
    },
    myWork: {
      followupsOverdueMine: 2,
      followupsOpenMine: 5,
      prospectsAssignedToMe: 9,
    },
    growthAttention: {
      newLeadsLast7d: 12,
      qualifiedOpen: 4,
      unassignedQualified: 0,
      onboardingOpen: 3,
      onboardingStalledOver15d: 1,
      qualifiedStalledOver15d: 2,
      convertedLast7d: 2,
      followupsOverdueInScope: 6,
      followupsDueTodayInScope: 3,
    },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  it('renders my work counts and attention metrics with truthful header copy', async () => {
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());

    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Operational overview')).toBeInTheDocument();
    await screen.findByText('open follow-ups assigned to you');
    expect(screen.getByText('prospects assigned to you')).toBeInTheDocument();
    expect(screen.getByText('New leads (last 7 days)')).toBeInTheDocument();
    expect(screen.getAllByText('12')).toHaveLength(1);
    expect(screen.getByText('Onboarding stalled (15+ days)')).toBeInTheDocument();
    expect(screen.getByText('Qualified stalled (15+ days)')).toBeInTheDocument();
    expect(screen.getByText('Overdue follow-ups in scope')).toBeInTheDocument();
    expect(screen.getByText('Due today in scope')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review in My Work' })).toHaveAttribute('href', '/my-work?state=overdue');
    expect(screen.getByRole('link', { name: 'Open My Work' })).toHaveAttribute('href', '/my-work?state=open');
    expect(screen.getByRole('link', { name: 'Open prospects' })).toHaveAttribute('href', '/prospects?owner=me');
    const overdueScopeLink = screen.getByText('Overdue follow-ups in scope').closest('a');
    expect(overdueScopeLink).toHaveAttribute('href', '/follow-ups?state=overdue');
    const dueTodayLink = screen.getByText('Due today in scope').closest('a');
    expect(dueTodayLink).toHaveAttribute('href', '/follow-ups?state=due_today');
    const newLeadsLink = screen.getByText('New leads (last 7 days)').closest('a');
    expect(newLeadsLink?.getAttribute('href')).toContain('status=new');
    expect(newLeadsLink?.getAttribute('href')).toContain('createdAfter=');
    expect(newLeadsLink?.getAttribute('href')).toContain('createdBefore=');
    const activatedLink = screen.getByText('Activated (last 7 days)').closest('a');
    expect(activatedLink?.getAttribute('href')).toContain('activated=true');
    expect(activatedLink?.getAttribute('href')).toContain('statusChangedAfter=');
    expect(activatedLink?.getAttribute('href')).toContain('statusChangedBefore=');
    const stalledOnboardingLink = screen.getByText('Onboarding stalled (15+ days)').closest('a');
    expect(stalledOnboardingLink?.getAttribute('href'))
      .toBe(`/prospects?status=onboarding&stalledBefore=${encodeURIComponent('2026-08-29T08:00:00.000Z')}`);
    const stalledQualifiedLink = screen.getByText('Qualified stalled (15+ days)').closest('a');
    expect(stalledQualifiedLink?.getAttribute('href'))
      .toBe(`/prospects?status=qualified&stalledBefore=${encodeURIComponent('2026-08-29T08:00:00.000Z')}`);
  });

  it('keeps super-admin sections hidden when the payload has no privileged fields', async () => {
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());

    renderPage();

    expect(await screen.findByText('Growth attention')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Merchant attention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Platform attention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent privileged actions' })).not.toBeInTheDocument();
  });

  it('renders privileged sections when the SUPER_ADMIN payload includes them', async () => {
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome({
      merchantAttention: { merchantsTotal: 41 },
      platformAttention: {
        metaChannelsUnhealthy: 1,
        paymentTransactionsStuckOver24h: 0,
        subscriptionsSuspended: 2,
      },
      recentPrivilegedActions: [{
        id: 'entry-1',
        actor: { userId: 'su-1', name: 'Dana Founder' },
        action: 'growth_os:user_role_changed',
        resourceType: 'GROWTH_OS_ROLE',
        createdAt: '2026-09-12T10:00:00.000Z',
        reason: 'Role rotation for cover week',
      }],
    }));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Merchant attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Platform attention' })).toBeInTheDocument();
    expect(screen.getByText('Merchants total')).toBeInTheDocument();
    expect(screen.getByText('Meta channels unhealthy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent privileged actions' })).toBeInTheDocument();
    expect(screen.getByText('growth_os:user_role_changed')).toBeInTheDocument();
    expect(screen.getByText('Dana Founder · GROWTH_OS_ROLE')).toBeInTheDocument();
    expect(screen.getByText('Reason: Role rotation for cover week')).toBeInTheDocument();
  });

  it('routes endpoint authentication failures through the auth provider', async () => {
    vi.spyOn(workspaceApi, 'home').mockRejectedValue(new ApiError('Expired', 401, 'AUTH_REQUIRED'));
    reportApiError.mockReturnValue(true);

    renderPage();

    await waitFor(() => expect(reportApiError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 })));
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('shows an error state and retries on a plain server failure', async () => {
    const home = vi.spyOn(workspaceApi, 'home').mockRejectedValue(new ApiError('Growth workspace unavailable', 500));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Today is unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Growth workspace unavailable')).toBeInTheDocument();

    const user = userEvent.setup();
    home.mockResolvedValue(makeHome());
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(home).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Growth attention')).toBeInTheDocument();
  });
});
