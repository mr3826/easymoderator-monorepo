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
      convertedLast7d: 2,
      followupsOverdueInScope: 6,
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
    expect(screen.getByText('Overdue follow-ups in scope')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review in My Work' })).toHaveAttribute('href', '/my-work');
    expect(screen.getByRole('link', { name: 'Open prospects' })).toHaveAttribute('href', '/prospects?owner=me');
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
