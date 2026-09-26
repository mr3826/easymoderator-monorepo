import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { growthApi, type ProspectListItem, type ProspectListResponse } from '@/api/client';
import { usePermission } from '@/auth/usePermission';
import { ProspectListPage } from './ProspectListPage';

vi.mock('@/auth/usePermission', () => ({
  usePermission: vi.fn(),
}));
vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError: vi.fn() }),
}));

const permissionMock = vi.mocked(usePermission);

const prospect: ProspectListItem = {
  id: 'prospect-1',
  businessName: 'North Star Retail',
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  pageUrl: null,
  niche: 'retail',
  notes: 'Internal note',
  source: 'manual_entry',
  sourceDetail: 'Campaign A',
  sourceReference: null,
  sourceRecordedAt: null,
  status: 'qualified',
  statusChangedAt: null,
  disqualifiedReason: null,
  ownerUserId: 'owner-1',
  ownerDisplayName: 'Owner One',
  ownerEmail: 'owner@example.test',
  assignedAt: null,
  assignedBy: null,
  linkedShopId: null,
  linkedUserId: null,
  linkedAt: null,
  mergedIntoId: null,
  mergedAt: null,
  createdBy: 'founder-1',
  metadata: {},
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const result: ProspectListResponse = {
  items: [prospect],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

function renderPage(route = '/prospects') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ProspectListPage />
    </MemoryRouter>,
  );
}

describe('ProspectListPage', () => {
  beforeEach(() => {
    vi.spyOn(growthApi, 'getEligibleAssignees').mockResolvedValue([{
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Owner One',
      email: 'owner@example.test',
      role: 'GROWTH_USER',
    }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders permission-scoped rows', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(growthApi, 'getProspects').mockResolvedValue(result);

    renderPage();

    expect(await screen.findByRole('link', { name: 'North Star Retail' })).toBeInTheDocument();
    expect(screen.getAllByText('manual entry')).toHaveLength(2);
    expect(screen.getAllByText('Not provided')).toHaveLength(2);
    expect(screen.queryByText('Hidden for your role')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New prospect' })).toHaveAttribute('href', '/prospects/new');
    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeInTheDocument();
    expect(screen.getAllByText('Owner One').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not linked').length).toBeGreaterThanOrEqual(1);
  });

  it('preloads status and source filters from URL search params', async () => {
    permissionMock.mockReturnValue(true);
    const getProspects = vi.spyOn(growthApi, 'getProspects').mockResolvedValue(result);

    renderPage('/prospects?status=qualified&source=manual_entry');

    await waitFor(() => expect(getProspects).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: 'qualified',
      source: 'manual_entry',
    }));
    expect(screen.getByLabelText('Lifecycle status')).toHaveValue('qualified');
    expect(screen.getByLabelText('Source')).toHaveValue('manual_entry');
  });

  it('hydrates the canonical activated drill, frozen stalled boundary, linkage, and page', async () => {
    permissionMock.mockReturnValue(true);
    const getProspects = vi.spyOn(growthApi, 'getProspects').mockResolvedValue(result);

    renderPage('/prospects?activated=true&stalledBefore=2026-08-29T08%3A00%3A00.000Z&linked=false&page=2&pageSize=50');

    await waitFor(() => expect(getProspects).toHaveBeenCalledWith({
      page: 2,
      pageSize: 50,
      activated: true,
      stalledBefore: '2026-08-29T08:00:00.000Z',
      linked: false,
    }));
  });

  it('reset clears URL-derived drill bounds instead of restoring them', async () => {
    const user = userEvent.setup();
    permissionMock.mockReturnValue(true);
    const getProspects = vi.spyOn(growthApi, 'getProspects').mockResolvedValue(result);

    renderPage('/prospects?status=qualified&stalledBefore=2026-08-29T08%3A00%3A00.000Z');
    await screen.findByRole('link', { name: 'North Star Retail' });
    getProspects.mockClear();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(getProspects).toHaveBeenCalledWith({ page: 1, pageSize: 20 }));
  });

  it('ignores unknown search param values', async () => {
    permissionMock.mockReturnValue(true);
    const getProspects = vi.spyOn(growthApi, 'getProspects').mockResolvedValue(result);

    renderPage('/prospects?status=bogus&source=not_a_source');

    await waitFor(() => expect(getProspects).toHaveBeenCalledWith({ page: 1, pageSize: 20 }));
  });

  it('serializes lower-case list filters after applying the filter form', async () => {
    const user = userEvent.setup();
    permissionMock.mockReturnValue(true);
    const getProspects = vi.spyOn(growthApi, 'getProspects').mockResolvedValue(result);
    renderPage();
    await screen.findByRole('link', { name: 'North Star Retail' });
    getProspects.mockClear();

    await user.type(screen.getByLabelText('Search'), 'North Star');
    await user.selectOptions(screen.getByLabelText('Lifecycle status'), 'qualified');
    await user.selectOptions(screen.getByLabelText('Source'), 'manual_entry');
     await user.selectOptions(screen.getByLabelText('Owner'), '11111111-1111-4111-8111-111111111111');
    await user.selectOptions(screen.getByLabelText('Linkage'), 'true');
    await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => expect(getProspects).toHaveBeenCalledWith({
      q: 'North Star',
      status: 'qualified',
      source: 'manual_entry',
       owner: '11111111-1111-4111-8111-111111111111',
      linked: 'true',
      page: 1,
      pageSize: 50,
    }));
  });

  it('hides create actions when the role cannot manage all prospects', async () => {
    permissionMock.mockReturnValue(false);
    vi.spyOn(growthApi, 'getProspects').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    renderPage();

    expect(await screen.findByText('No prospects match these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New prospect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create a prospect' })).not.toBeInTheDocument();
  });

  it('shows a loading state while the list request is pending', () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(growthApi, 'getProspects').mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(screen.getByRole('heading', { name: 'Loading prospects' })).toBeInTheDocument();
  });

  it('shows an empty state when the filtered list has no rows', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(growthApi, 'getProspects').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    renderPage();

    expect(await screen.findByText('No prospects match these filters.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a prospect' })).toHaveAttribute('href', '/prospects/new');
  });

  it('shows the server error and retry action when the list request fails', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(growthApi, 'getProspects').mockRejectedValue(new Error('Growth store unavailable'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Growth store unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
