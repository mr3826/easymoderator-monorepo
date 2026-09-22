import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { growthApi, type ProspectListItem, type ProspectListResponse, type ProspectStatus } from '@/api/client';
import { PipelinePage } from './PipelinePage';

const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

function makeProspect(id: string, businessName: string, overrides: Partial<ProspectListItem> = {}): ProspectListItem {
  return {
    id,
    businessName,
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
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function listFor(items: ProspectListItem[]): ProspectListResponse {
  return { items, total: items.length, page: 1, pageSize: 25, totalPages: 1 };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/pipeline']}>
      <PipelinePage />
    </MemoryRouter>,
  );
}

describe('PipelinePage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
  });

  function mockColumns(overrides: Partial<Record<ProspectStatus, ProspectListResponse>> = {}) {
    const empty = listFor([]);
    return vi.spyOn(growthApi, 'getProspects').mockImplementation((filters) => {
      const status = (filters?.status ?? '') as ProspectStatus | '';
      if (status && overrides[status]) return Promise.resolve(overrides[status]);
      return Promise.resolve(empty);
    });
  }

  it('renders six stage columns with counts and prospect links showing owner presence', async () => {
    mockColumns({
      qualified: { ...listFor([
        makeProspect('p-1', 'North Star Retail', { status: 'qualified', ownerUserId: 'user-9' }),
      ]), total: 37 },
      onboarding: listFor([makeProspect('p-2', 'Rahim Fashion', { status: 'onboarding' })]),
    });

    renderPage();

    const northStar = await screen.findByRole('link', { name: 'North Star Retail' });
    expect(northStar).toHaveAttribute('href', '/prospects/p-1');
    expect(screen.getByRole('heading', { name: /^Qualified 37$/ })).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 37.')).toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Converted 0$/ })).toBeInTheDocument();
  });

  it('keeps other columns rendered when one column request fails', async () => {
    vi.spyOn(growthApi, 'getProspects').mockImplementation((filters) => (
      filters?.status === 'contacted'
        ? Promise.reject(new Error('Column unavailable'))
        : Promise.resolve(listFor([makeProspect('p-1', 'North Star Retail')]))
    ));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Column unavailable');
    expect(screen.getByRole('heading', { name: /^New 1$/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'North Star Retail' }).length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the lost section collapsed until it is shown and lists disqualified prospects', async () => {
    mockColumns({
      disqualified: listFor([makeProspect('p-9', 'Closed Shop', { status: 'disqualified' })]),
    });

    renderPage();

    const show = await screen.findByRole('button', { name: 'Show' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Closed Shop')).not.toBeInTheDocument();
    await userEvent.setup().click(show);

    expect(await screen.findByText('Closed Shop')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lost (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('routes an authentication failure reported while loading columns through the auth provider', async () => {
    reportApiError.mockReturnValue(true);
    vi.spyOn(growthApi, 'getProspects').mockImplementation((filters) => (
      filters?.status === 'new'
        ? Promise.reject(new Error('Expired'))
        : Promise.resolve(listFor([makeProspect('p-1', 'North Star Retail')]))
    ));

    renderPage();

    await waitFor(() => expect(reportApiError).toHaveBeenCalled());
    expect(screen.getAllByRole('link', { name: 'North Star Retail' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
