import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type Followup, type FollowupListResponse } from '@/api/client';
import { FollowUpsPanel } from './FollowUpsPanel';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError, session: { internalUserId: 'user-1' } }),
}));
vi.mock('@/auth/usePermission', () => ({
  usePermission: () => true,
}));

function makeFollowup(overrides: Partial<Followup> = {}): Followup {
  return {
    id: 'followup-1',
    prospectId: 'prospect-1',
    prospectName: 'North Star Retail',
    ownerUserId: 'user-1',
    createdByUserId: 'user-1',
    dueAt: '2026-09-10T09:00:00.000Z',
    action: 'WhatsApp pricing',
    note: 'Share starter plan',
    status: 'open',
    completedAt: null,
    overdue: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function list(items: Followup[]): FollowupListResponse {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

function renderPanel() {
  return render(<FollowUpsPanel prospectId="prospect-1" />);
}

describe('FollowUpsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  it('lists open and overdue follow-ups with complete actions', async () => {
    vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(list([
      makeFollowup(),
      makeFollowup({ id: 'followup-2', action: 'Call back', note: null, overdue: false }),
    ]));

    renderPanel();

    expect(await screen.findByText('WhatsApp pricing')).toBeInTheDocument();
    expect(screen.getByText('Call back')).toBeInTheDocument();
    expect(screen.getByText('overdue')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Complete' })).toHaveLength(2);
    expect(workspaceApi.listFollowups).toHaveBeenCalledWith({ prospectId: 'prospect-1', state: 'open' });
  });

  it('completes a follow-up and refreshes the list', async () => {
    const listSpy = vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(list([makeFollowup()]));
    const transition = vi.spyOn(workspaceApi, 'transitionFollowup').mockResolvedValue(makeFollowup({ status: 'completed', overdue: false }));

    renderPanel();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Complete' }));

    await waitFor(() => expect(transition).toHaveBeenCalledWith('followup-1', 'completed'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('schedules a new follow-up through the create mini-form', async () => {
    vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(list([]));
    const create = vi.spyOn(workspaceApi, 'createFollowup').mockResolvedValue(makeFollowup());

    renderPanel();

    expect(await screen.findByText('No open follow-ups for this prospect.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule follow-up' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      prospectId: 'prospect-1',
      action: 'Call',
      dueAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    })));
  });

  it('shows an inline error when scheduling fails', async () => {
    vi.spyOn(workspaceApi, 'listFollowups').mockResolvedValue(list([]));
    vi.spyOn(workspaceApi, 'createFollowup').mockRejectedValue(new ApiError('Prospect not found', 404));

    renderPanel();

    await screen.findByText('No open follow-ups for this prospect.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Schedule follow-up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Prospect not found');
  });

  it('shows a retryable error state when the initial load fails', async () => {
    const listSpy = vi.spyOn(workspaceApi, 'listFollowups').mockRejectedValueOnce(new ApiError('Follow-ups unavailable', 500));

    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Follow-ups unavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });
});
