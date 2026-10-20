import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  growthApi,
  workspaceApi,
  type FollowupListResponse,
  type HomeResponse,
  type ProspectListResponse,
} from '@/api/client';
import { HomePage } from './HomePage';

const reportApiError = vi.fn(() => false);
const sessionPermissions = {
  value: [
    'growth_os.session.read',
    'growth_os.prospects.read_all',
    'growth_os.prospects.manage_all',
    'growth_os.followups.manage',
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
      followupsOverdueMine: 2,
      followupsOpenMine: 5,
      prospectsAssignedToMe: 9,
    },
    growthAttention: {
      newLeadsLast7d: 12,
      qualifiedOpen: 4,
      unassignedQualified: 1,
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

function makeFollowupList(overrides: Partial<FollowupListResponse> = {}): FollowupListResponse {
  return {
    items: [{
      id: 'fu-1',
      prospectId: 'p-1',
      prospectName: 'Rima Boutique',
      ownerUserId: 'me',
      createdByUserId: 'me',
      dueAt: '2026-09-11T04:00:00.000Z',
      action: 'Call about first reply setup',
      note: null,
      status: 'open',
      completedAt: null,
      overdue: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    }],
    total: 2,
    page: 1,
    pageSize: 5,
    ...overrides,
  };
}

function makeProspectList(overrides: Partial<ProspectListResponse> = {}): ProspectListResponse {
  return {
    items: [{
      id: 'p-2',
      businessName: 'Dhaka Dairy Bazar',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      pageUrl: null,
      niche: null,
      notes: null,
      source: 'manual_entry',
      sourceDetail: null,
      sourceReference: null,
      sourceRecordedAt: '2026-09-05T10:00:00.000Z',
      status: 'qualified',
      statusChangedAt: '2026-09-05T10:00:00.000Z',
      disqualifiedReason: null,
      ownerUserId: null,
      assignedAt: null,
      assignedBy: null,
      linkedShopId: null,
      linkedUserId: null,
      linkedAt: null,
      mergedIntoId: null,
      mergedAt: null,
      createdBy: null,
      metadata: {},
      createdAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-05T10:00:00.000Z',
    }],
    total: 1,
    page: 1,
    pageSize: 5,
    totalPages: 1,
    ...overrides,
  };
}

function mockWorkspaceReads() {
  vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());
  vi.spyOn(workspaceApi, 'listFollowups').mockImplementation(async (filters) => (
    filters?.state === 'overdue'
      ? makeFollowupList()
      : makeFollowupList({ items: [], total: 0 })
  ));
  vi.spyOn(growthApi, 'getProspects').mockImplementation(async (filters) => {
    if (filters?.status === 'qualified') return makeProspectList();
    return makeProspectList({ items: [], total: 0 });
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage action queue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
    sessionPermissions.value = [
      'growth_os.session.read',
      'growth_os.prospects.read_all',
      'growth_os.prospects.manage_all',
      'growth_os.followups.manage',
    ];
  });

  it('renders the ordered queue segments backed by real list rows', async () => {
    mockWorkspaceReads();

    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    const queue = screen.getByRole('region', { name: 'Action queue' });
    const headings = within(queue).getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual([
      'Overdue follow-ups',
      'Due today',
      'Qualified leads without an owner',
      'Onboarding stalled 15+ days',
      'Other open leads to start',
    ]);

    const overdueSection = within(queue).getByRole('region', { name: 'Overdue follow-ups' });
    expect(await within(overdueSection).findByRole('link', { name: 'Rima Boutique' }))
      .toHaveAttribute('href', '/prospects/p-1');
    expect(within(overdueSection).getByText(/Overdue by \d+ days/)).toBeInTheDocument();
    expect(within(overdueSection).getByText('Showing 1 of 2')).toBeInTheDocument();
    expect(within(overdueSection).getByRole('link', { name: 'View all' }))
      .toHaveAttribute('href', '/my-work?state=overdue');

    const qualifiedSection = within(queue).getByRole('region', { name: 'Qualified leads without an owner' });
    expect(await within(qualifiedSection).findByRole('link', { name: 'Dhaka Dairy Bazar' }))
      .toHaveAttribute('href', '/prospects/p-2');
    expect(within(qualifiedSection).getByRole('link', { name: 'View all' }))
      .toHaveAttribute('href', '/prospects?status=qualified&owner=unassigned');
  });

  it('fetches each queue segment from its exact canonical query', async () => {
    mockWorkspaceReads();

    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    await waitFor(() => expect(workspaceApi.listFollowups).toHaveBeenCalled());

    expect(workspaceApi.listFollowups).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'overdue', owner: 'me', pageSize: 5 }),
    );
    expect(workspaceApi.listFollowups).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'due_today', owner: 'me', pageSize: 5 }),
    );
    expect(growthApi.getProspects).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'qualified', owner: 'unassigned' }),
    );
    expect(growthApi.getProspects).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'onboarding', stalledBefore: '2026-08-29T08:00:00.000Z' }),
    );
    expect(growthApi.getProspects).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'new', owner: 'unassigned' }),
    );
  });

  it('keeps the truthful weekly summary with the AI activation semantic', async () => {
    mockWorkspaceReads();

    renderPage();

    expect(await screen.findByText('This week')).toBeInTheDocument();
    const activatedLink = screen.getByText('AI activated (last 7 days)').closest('a');
    expect(activatedLink?.getAttribute('href')).toContain('activated=true');
    expect(screen.getByText(/first successful AI reply — it is not a paid subscription claim/))
      .toBeInTheDocument();
  });

  it('hides follow-up segments for sessions without follow-up manage permission', async () => {
    sessionPermissions.value = ['growth_os.session.read', 'growth_os.prospects.read_all'];
    vi.spyOn(workspaceApi, 'home').mockResolvedValue(makeHome());
    const listSpy = vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(makeFollowupList({ items: [], total: 0 }));
    vi.spyOn(growthApi, 'getProspects').mockResolvedValue(makeProspectList({ items: [], total: 0 }));

    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(screen.queryByRole('region', { name: 'Overdue follow-ups' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Due today' })).not.toBeInTheDocument();
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('recovers one failed segment without discarding the rest of the queue', async () => {
    mockWorkspaceReads();
    vi.mocked(workspaceApi.listFollowups).mockImplementation(async (filters) => {
      if (filters?.state === 'overdue') throw new ApiError('Segment unavailable', 500);
      return makeFollowupList({ items: [], total: 0 });
    });

    renderPage();

    const queue = await screen.findByRole('region', { name: 'Action queue' });
    const overdueSection = within(queue).getByRole('region', { name: 'Overdue follow-ups' });
    expect(await within(overdueSection).findByText('Segment unavailable')).toBeInTheDocument();
    // Other segments still render.
    expect(await within(
      within(queue).getByRole('region', { name: 'Qualified leads without an owner' }),
    ).findByRole('link', { name: 'Dhaka Dairy Bazar' })).toBeInTheDocument();

    vi.mocked(workspaceApi.listFollowups).mockImplementation(async () => makeFollowupList());
    const user = userEvent.setup();
    await user.click(within(overdueSection).getByRole('button', { name: 'Retry this list' }));
    await waitFor(() =>
      expect(within(overdueSection).getByRole('link', { name: 'Rima Boutique' })).toBeInTheDocument());
  });

  it('routes endpoint authentication failures through the auth provider', async () => {
    vi.spyOn(workspaceApi, 'home').mockRejectedValue(new ApiError('Expired', 401, 'AUTH_REQUIRED'));
    reportApiError.mockReturnValue(true);

    renderPage();

    await waitFor(() => expect(reportApiError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 })));
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('shows an error state and retries when the home windows fail', async () => {
    const home = vi.spyOn(workspaceApi, 'home').mockRejectedValue(new ApiError('Growth workspace unavailable', 500));
    vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(makeFollowupList({ items: [], total: 0 }));
    vi.spyOn(growthApi, 'getProspects').mockResolvedValue(makeProspectList({ items: [], total: 0 }));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Today is unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Growth workspace unavailable')).toBeInTheDocument();

    const user = userEvent.setup();
    home.mockResolvedValue(makeHome());
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(home).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('This week')).toBeInTheDocument();
  });
});
