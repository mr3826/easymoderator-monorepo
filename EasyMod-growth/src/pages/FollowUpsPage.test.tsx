import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type Followup, type FollowupListResponse } from '@/api/client';
import { FollowUpsPage } from './FollowUpsPage';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

function makeFollowup(overrides: Partial<Followup> = {}): Followup {
  return {
    id: 'followup-1',
    prospectId: 'prospect-1',
    prospectName: 'North Star Retail',
    ownerUserId: 'user-1',
    createdByUserId: 'user-1',
    dueAt: '2026-09-10T09:00:00.000Z',
    action: 'Call back about activation',
    note: 'Ask about Meta page',
    status: 'open',
    completedAt: null,
    overdue: true,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  };
}

function makeList(items: Followup[]): FollowupListResponse {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

function renderPage(scope: 'mine' | 'all' = 'all') {
  return render(
    <MemoryRouter initialEntries={[scope === 'mine' ? '/my-work' : '/follow-ups']}>
      <FollowUpsPage scope={scope} />
    </MemoryRouter>,
  );
}

describe('FollowUpsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  it('lists follow-ups with prospect links and overdue badge, and filters by scoped owner', async () => {
    const list = vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(makeList([
      makeFollowup(),
      makeFollowup({ id: 'followup-2', action: 'Send partnership proposal', prospectName: null, overdue: false }),
    ]));

    renderPage('mine');

    expect(await screen.findByText('Call back about activation')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ state: 'open', owner: 'me', page: 1, pageSize: 50 });
    expect(screen.getByRole('link', { name: 'North Star Retail' })).toHaveAttribute('href', '/prospects/prospect-1');
    expect(screen.getByRole('link', { name: 'View prospect' })).toBeInTheDocument();
    expect(screen.getAllByText('overdue')).toHaveLength(1);
    expect(screen.getByText('1 overdue in this view.')).toBeInTheDocument();
  });

  it('completes a follow-up and reschedules it with an inline due date editor', async () => {
    const user = userEvent.setup();
    vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(makeList([makeFollowup()]));
    const transition = vi.spyOn(workspaceApi, 'transitionFollowup').mockResolvedValue(makeFollowup({
      status: 'completed',
      overdue: false,
    }));

    renderPage();

    await screen.findByText('Call back about activation');
    await user.click(screen.getByRole('button', { name: 'Complete' }));

    await waitFor(() => expect(transition).toHaveBeenCalledWith('followup-1', 'completed'));

    await user.click(screen.getByRole('button', { name: 'Reschedule' }));
    const dueInput = screen.getByLabelText('New due date');
    expect(dueInput).toBeInTheDocument();
    fireEvent.change(dueInput, { target: { value: '2026-09-20T14:30' } });
    const update = vi.spyOn(workspaceApi, 'updateFollowup').mockResolvedValue(makeFollowup());
    await user.click(screen.getByRole('button', { name: 'Save due date' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('followup-1', { dueAt: new Date('2026-09-20T14:30').toISOString() }));
  });

  it('switches the state filter tab and requests the selected state', async () => {
    const list = vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(makeList([]));

    renderPage();

    await screen.findByText('No follow-ups in this view.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Overdue' }));

    await waitFor(() => expect(list).toHaveBeenCalledWith({ state: 'overdue', owner: undefined, page: 1, pageSize: 50 }));
  });

  it('shows an inline error with retry when the list request fails', async () => {
    vi.spyOn(workspaceApi, 'listFollowups').mockRejectedValue(new ApiError('Workspace unavailable', 500));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('surfaces action errors inline when a transition mutation fails', async () => {
    vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(makeList([makeFollowup()]));
    vi.spyOn(workspaceApi, 'transitionFollowup').mockRejectedValue(new ApiError('Follow-up already closed', 409));

    renderPage();

    await screen.findByText('Call back about activation');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Follow-up already closed');
  });
});
