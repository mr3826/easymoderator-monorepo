import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type HomeResponse } from '@/api/client';
import { AdminHome } from './AdminHome';

const reportApiError = vi.fn(() => false);
const sessionPermissions = {
  value: [
    'growth_os.session.read',
    'growth_os.prospects.read_all',
    'growth_os.admin.operations.read',
    'growth_os.admin.merchants.read',
    'growth_os.admin.merchants.mutate',
    'growth_os.admin.users.read',
    'growth_os.admin.audit.read',
  ] as string[],
};

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({
    reportApiError,
    session: { permissions: sessionPermissions.value },
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
      followupsOverdueMine: 0,
      followupsOpenMine: 1,
      prospectsAssignedToMe: 2,
    },
    growthAttention: {
      newLeadsLast7d: 5,
      qualifiedOpen: 3,
      unassignedQualified: 1,
      onboardingOpen: 2,
      onboardingStalledOver15d: 4,
      qualifiedStalledOver15d: 1,
      convertedLast7d: 0,
      followupsOverdueInScope: 2,
      followupsDueTodayInScope: 1,
    },
    merchantAttention: { merchantsTotal: 37 },
    platformAttention: {
      metaChannelsUnhealthy: 3,
      paymentTransactionsStuckOver24h: 5,
      subscriptionsSuspended: 2,
    },
    recentPrivilegedActions: [{
      id: 'entry-1',
      actor: { userId: 'su-1', name: 'Ayesha Super' },
      action: 'growth_os:merchant_status',
      resourceType: 'GROWTH_OS_ADMIN_MERCHANT',
      createdAt: '2026-09-12T10:00:00.000Z',
      reason: 'Repeated billing failures',
    }],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AdminHome />
    </MemoryRouter>,
  );
}

describe('AdminHome attention landing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
    sessionPermissions.value = [
      'growth_os.session.read',
      'growth_os.prospects.read_all',
      'growth_os.admin.operations.read',
      'growth_os.admin.merchants.read',
      'growth_os.admin.merchants.mutate',
      'growth_os.admin.users.read',
      'growth_os.admin.audit.read',
    ];
  });

  it('keeps unsupported aggregates honest while linking supported drilldowns', async () => {
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());

    renderPage();

    const signals = await screen.findByRole('region', { name: 'Operational attention' });
    expect(within(signals).getByText('Payment transactions stuck over 24h')).toBeInTheDocument();
    expect(within(signals).getByText(/No record-level merchant identification is available/))
      .toBeInTheDocument();
    const paymentsCard = within(signals).getByText('Payment transactions stuck over 24h').closest('div')!;
    expect(within(paymentsCard).getByRole('link', { name: 'Open Operations' }))
      .toHaveAttribute('href', '/operations');

    const suspendedCard = within(signals).getByText('Subscriptions suspended').closest('div')!;
    expect(within(suspendedCard).getByRole('link', { name: 'Open merchants' }))
      .toHaveAttribute('href', '/merchants');
  });

  it('links stalled-before-activation cohorts to the exact counted population', async () => {
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());

    renderPage();

    const stuck = await screen.findByRole('region', { name: 'Merchants needing support investigation' });
    const stalledCard = within(stuck).getByText('Onboarding stalled 15+ days').closest('div')!;
    expect(within(stalledCard).getByRole('link', { name: 'View stalled cohort' }))
      .toHaveAttribute('href', `/prospects?status=onboarding&stalledBefore=${encodeURIComponent('2026-08-29T08:00:00.000Z')}`);
  });

  it('groups staff management behind Team & Access with audit access', async () => {
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());

    renderPage();

    const team = await screen.findByRole('region', { name: 'Team & access' });
    expect(within(team).getByRole('link', { name: /Manage growth staff/ })).toHaveAttribute('href', '/growth-users');
    expect(within(team).getByRole('link', { name: /Review access model/ })).toHaveAttribute('href', '/access-control');
    expect(within(team).getByRole('link', { name: /Open audit trail/ })).toHaveAttribute('href', '/audit');

    const trail = await screen.findByRole('region', { name: 'Recent privileged actions' });
    expect(within(trail).getByText('growth_os:merchant_status')).toBeInTheDocument();
    expect(within(trail).getByText('Reason: Repeated billing failures')).toBeInTheDocument();
  });

  it('hides team links for sessions without staff read permission', async () => {
    sessionPermissions.value = ['growth_os.admin.operations.read', 'growth_os.prospects.read_all'];
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());

    renderPage();

    await screen.findByRole('region', { name: 'Operational attention' });
    expect(screen.queryByRole('region', { name: 'Team & access' })).not.toBeInTheDocument();
  });

  it('omits privileged sections the payload does not authorize', async () => {
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome({
      merchantAttention: undefined,
      platformAttention: undefined,
      recentPrivilegedActions: undefined,
    }));

    renderPage();

    expect(await screen.findByRole('region', { name: 'Merchants needing support investigation' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Operational attention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recent privileged actions' })).not.toBeInTheDocument();
  });

  it('shows an error state with retry when the overview fails', async () => {
    const home = vi.spyOn(workspaceApi, 'home').mockRejectedValue(new ApiError('Overview unavailable', 500));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Attention overview is unavailable' })).toBeInTheDocument();
    home.mockResolvedValue(makeHome());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: 'Operational attention' });
  });
});
