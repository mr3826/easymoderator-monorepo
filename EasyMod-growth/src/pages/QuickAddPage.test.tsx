import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  growthApi,
  workspaceApi,
  type ProspectListItem,
} from '@/api/client';
import { QuickAddPage } from './QuickAddPage';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));
vi.mock('@/auth/usePermission', () => ({
  usePermission: () => true,
}));

function makeProspect(overrides: Partial<ProspectListItem> = {}): ProspectListItem {
  return {
    id: 'prospect-9',
    businessName: 'Rahim Fashion',
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    pageUrl: null,
    niche: null,
    notes: null,
    source: 'manual_entry',
    sourceDetail: null,
    sourceReference: null,
    sourceRecordedAt: null,
    status: 'new',
    statusChangedAt: null,
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
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/quick-add']}>
      <QuickAddPage />
    </MemoryRouter>,
  );
}

describe('QuickAddPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  it('blocks submission without a contact channel', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(growthApi, 'createProspect');
    renderPage();

    await user.type(screen.getByLabelText(/Business name/), 'Rahim Fashion');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('At least one of phone, email, or page URL is required.');
    expect(create).not.toHaveBeenCalled();
  });

  it('preflights duplicates and blocks creation until the identity is changed', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({
      matches: [{ prospectId: 'existing-1', businessName: 'Existing Rahim', status: 'qualified', matchedFields: ['contactPhone'] }],
    });
    const create = vi.spyOn(growthApi, 'createProspect').mockResolvedValue(makeProspect());
    renderPage();

    await user.type(screen.getByLabelText(/Business name/), 'Rahim Fashion');
    await user.type(screen.getByLabelText('Contact phone'), '01700000000');
    fireEvent.blur(screen.getByLabelText('Contact phone'));

    expect(await screen.findByText('Possible duplicate prospect')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Existing Rahim' })).toHaveAttribute('href', '/prospects/existing-1');
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText(/Creation is blocked while the identity matches/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create anyway|continue and create/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create prospect' }));
    await waitFor(() => expect(create).not.toHaveBeenCalled());
  });

  it('captures a default source and schedules the first follow-up from the success panel', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    const create = vi.spyOn(growthApi, 'createProspect').mockResolvedValue(makeProspect({ source: 'facebook' }));
    const createFollowup = vi.spyOn(workspaceApi, 'createFollowup').mockResolvedValue({
      id: 'followup-1',
      prospectId: 'prospect-9',
      prospectName: 'Rahim Fashion',
      ownerUserId: null,
      createdByUserId: null,
      dueAt: '2026-09-14T00:00:00.000Z',
      action: 'Call',
      note: null,
      status: 'open',
      completedAt: null,
      overdue: false,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    });
    renderPage();

    await user.type(screen.getByLabelText(/Business name/), 'Rahim Fashion');
    await user.type(screen.getByLabelText('Page URL'), 'https://facebook.com/rahim');
    await user.selectOptions(screen.getByLabelText('Source *'), 'facebook');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    await screen.findByRole('heading', { name: 'Prospect created' });
    expect(screen.getByText('facebook')).toBeInTheDocument();
    expect(screen.getByLabelText('Action *')).toHaveValue('Call');

    // The selected wall-clock must be interpreted as Asia/Dhaka business time
    // regardless of the browser zone: 20:00 BST === 14:00Z, host-independently.
    await user.clear(screen.getByLabelText('Due date *'));
    await user.type(screen.getByLabelText('Due date *'), '2026-09-27T20:00');
    await user.click(screen.getByRole('button', { name: 'Schedule follow-up' }));

    await waitFor(() => expect(createFollowup).toHaveBeenCalledWith(expect.objectContaining({
      prospectId: 'prospect-9',
      action: 'Call',
      dueAt: '2026-09-27T14:00:00.000Z',
    })));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ source: 'facebook', pageUrl: 'https://facebook.com/rahim' }));
    expect(await screen.findByText(/First follow-up scheduled/)).toBeInTheDocument();
  });

  it('surfaces a conflicting prospect id from a 409 response', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    vi.spyOn(growthApi, 'createProspect').mockRejectedValue(new ApiError(
      'A prospect with the same normalized identity already exists.',
      409,
      'GROWTH_OS_PROSPECT_DUPLICATE',
      { conflictingProspectId: 'conflict-7' },
    ));
    renderPage();

    await user.type(screen.getByLabelText(/Business name/), 'Rahim Fashion');
    await user.type(screen.getByLabelText('Contact email'), 'owner@example.test');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByText('This identity already exists')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the conflicting prospect' })).toHaveAttribute('href', '/prospects/conflict-7');
  });

  it('shows an inline error when the create mutation fails for another reason', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    vi.spyOn(growthApi, 'createProspect').mockRejectedValue(new ApiError('Growth store unavailable', 500));
    renderPage();

    await user.type(screen.getByLabelText(/Business name/), 'Rahim Fashion');
    await user.type(screen.getByLabelText('Contact phone'), '01700000000');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Growth store unavailable');
  });
});
