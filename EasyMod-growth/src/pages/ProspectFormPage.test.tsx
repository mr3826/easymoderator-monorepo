import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, growthApi, type Prospect } from '@/api/client';
import { ProspectFormPage } from './ProspectFormPage';

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError: vi.fn() }),
}));

function renderEditForm() {
  render(
    <MemoryRouter initialEntries={['/prospects/prospect-1/edit']}>
      <Routes>
        <Route path="/prospects/:prospectId/edit" element={<ProspectFormPage />} />
        <Route path="/prospects/:prospectId" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderCreateForm() {
  render(
    <MemoryRouter initialEntries={['/prospects/new']}>
      <Routes>
        <Route path="/prospects/new" element={<ProspectFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProspectFormPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires at least one contact channel before saving', async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/Business name/), 'Rahim Fashion');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    expect(screen.getByText('At least one of phone, email, or page URL is required.')).toBeInTheDocument();
  });

  it('requires a source selection while preserving the lowercase source values', async () => {
    const user = userEvent.setup();
    renderCreateForm();

    await user.type(screen.getByLabelText(/Business name/), 'Rahim Fashion');
    await user.selectOptions(screen.getByLabelText('Source *'), '');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    expect(screen.getByText('Source is required.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'manual entry' })).toHaveValue('manual_entry');
  });

  it('renders redacted contact channels as non-editable role-hidden values', async () => {
    vi.spyOn(growthApi, 'getProspect').mockResolvedValue({
      id: 'prospect-1',
      businessName: 'Private shop',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      pageUrl: null,
      niche: 'retail',
      notes: null,
      source: 'event',
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
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      eligibleForNextPhase: false,
      redacted: true,
       timeline: [],
       timelinePagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
     } satisfies Prospect);
    vi.spyOn(growthApi, 'getProspectLinkageSuggestions').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/prospects/prospect-1/edit']}>
        <Routes>
          <Route path="/prospects/:prospectId/edit" element={<ProspectFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findAllByText('Hidden for your role')).toHaveLength(4);
    expect(screen.queryByLabelText('Contact name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contact phone')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contact email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Page URL')).not.toBeInTheDocument();
  });

  it('stops at duplicate preflight and links the matching prospect for review', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({
      matches: [{
        prospectId: 'existing-prospect',
        businessName: 'Existing North Star',
        status: 'qualified',
        matchedFields: ['contactEmail'],
      }],
    });
    const createProspect = vi.spyOn(growthApi, 'createProspect').mockResolvedValue({
      id: 'new-prospect',
      businessName: 'North Star',
      contactName: null,
      contactPhone: '01700000000',
      contactEmail: 'owner@example.com',
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
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      eligibleForNextPhase: false,
    });
    renderCreateForm();

    await user.type(screen.getByLabelText(/Business name/), 'North Star');
    await user.type(screen.getByLabelText('Contact email'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByText('Possible duplicate prospect')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Existing North Star' })).toHaveAttribute(
      'href',
      '/prospects/existing-prospect',
    );
    expect(createProspect).not.toHaveBeenCalled();
  });

  it('links the server conflict record when create races duplicate preflight', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    vi.spyOn(growthApi, 'createProspect').mockRejectedValue(new ApiError(
      'A prospect with the same normalized identity already exists.',
      409,
      'GROWTH_OS_PROSPECT_DUPLICATE',
      { conflictingProspectId: 'conflict-prospect' },
    ));
    renderCreateForm();

    await user.type(screen.getByLabelText(/Business name/), 'North Star');
    await user.type(screen.getByLabelText('Contact phone'), '01700000000');
    await user.click(screen.getByRole('button', { name: 'Create prospect' }));

    expect(await screen.findByText('A prospect with the same normalized identity already exists.'))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the conflicting prospect' })).toHaveAttribute(
      'href',
      '/prospects/conflict-prospect',
    );
  });

  it('sends null for cleared optional fields during an edit', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthApi, 'getProspect').mockResolvedValue({
      id: 'prospect-1',
      businessName: 'North Star',
      contactName: 'Owner',
      contactPhone: '01700000000',
      contactEmail: 'owner@example.com',
      pageUrl: null,
      niche: 'retail',
      notes: 'Existing note',
      source: 'manual_entry',
      sourceDetail: 'Campaign',
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
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      eligibleForNextPhase: false,
      timeline: [],
      timelinePagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } satisfies Prospect);
    vi.spyOn(growthApi, 'checkProspectDuplicates').mockResolvedValue({ matches: [] });
    const update = vi.spyOn(growthApi, 'updateProspect').mockResolvedValue({
      id: 'prospect-1',
      businessName: 'North Star',
      contactName: 'Owner',
      contactPhone: '01700000000',
      contactEmail: 'owner@example.com',
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
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      eligibleForNextPhase: false,
    });
    renderEditForm();

    await screen.findByRole('heading', { name: 'Edit prospect' });
    await user.clear(screen.getByLabelText('Prospect notes'));
    await user.clear(screen.getByLabelText('Niche'));
    await user.clear(screen.getByLabelText('Source detail'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('prospect-1', expect.objectContaining({
      notes: null,
      niche: null,
      sourceDetail: null,
    })));
  });
});
