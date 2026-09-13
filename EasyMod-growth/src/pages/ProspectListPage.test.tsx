import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders permission-scoped rows without a next-phase column', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(growthApi, 'getProspects').mockResolvedValue(result);

    renderPage();

    expect(await screen.findByRole('link', { name: 'North Star Retail' })).toBeInTheDocument();
    expect(screen.getAllByText('manual entry')).toHaveLength(2);
    expect(screen.getAllByText('Not provided')).toHaveLength(2);
    expect(screen.queryByText('Hidden for your role')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New prospect' })).toHaveAttribute('href', '/prospects/new');
    expect(screen.queryByRole('columnheader', { name: 'Next phase' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeInTheDocument();
    expect(screen.getByText('owner-1')).toBeInTheDocument();
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
    await user.type(screen.getByLabelText('Owner user ID'), '11111111-1111-4111-8111-111111111111');
    await user.selectOptions(screen.getByLabelText('Linkage'), 'true');
    await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => expect(getProspects).toHaveBeenCalledWith({
      q: 'North Star',
      status: 'qualified',
      source: 'manual_entry',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
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
