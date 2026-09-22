import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, merchantsApi, type MerchantAdminRow, type MerchantInsightRow } from '@/api/client';
import { usePermission } from '@/auth/usePermission';
import { MerchantsPage } from './MerchantsPage';

vi.mock('@/auth/usePermission', () => ({
  usePermission: vi.fn(),
}));

const reportApiError = vi.fn(() => false);
vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

const permissionMock = vi.mocked(usePermission);

const adminRow: MerchantAdminRow = {
  id: 'shop-1',
  shopName: 'Luna Tech',
  owner: { name: 'Maya Osei', email: 'owner@lunatech.test', phone: null },
  plan: 'growth_monthly',
  status: 'active',
  channelCount: 2,
  conversationsUsed: 120,
  conversationsLimit: 500,
  createdAt: '2026-07-01T10:00:00.000Z',
};

const insightRow: MerchantInsightRow = {
  shopId: 'shop-9',
  merchantName: 'Quiet Tide Studio',
  signupDate: '2026-06-01T10:00:00.000Z',
  planName: 'Growth',
  activatedAt: null,
  facebookConnected: false,
  linkedProspects: ['North Star Retail'],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/merchants']}>
      <MerchantsPage />
    </MemoryRouter>,
  );
}

describe('MerchantsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders the admin table with owner identity and usage limits', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(merchantsApi, 'list').mockResolvedValue({
      items: [adminRow],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderPage();

    expect(await screen.findByRole('link', { name: 'Luna Tech' })).toHaveAttribute('href', '/merchants/shop-1');
    expect(screen.getByText('owner@lunatech.test')).toBeInTheDocument();
    expect(screen.getByText('120 of 500')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.queryByText(/Limited, masked merchant context/)).not.toBeInTheDocument();
  });

  it('renders the masked insight table for growth users without admin columns', async () => {
    permissionMock.mockReturnValue(false);
    vi.spyOn(merchantsApi, 'list').mockResolvedValue({
      items: [insightRow],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    renderPage();

    expect(await screen.findByText(/Limited, masked merchant context for growth work/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quiet Tide Studio' })).toHaveAttribute('href', '/merchants/shop-9');
    expect(screen.getByText(/Owner contact details, shop identifiers, and usage limits are hidden/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Conversations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Owner' })).not.toBeInTheDocument();
    expect(screen.queryByText('owner@lunatech.test')).not.toBeInTheDocument();
  });

  it('applies the search to the list request on submit', async () => {
    const user = userEvent.setup();
    permissionMock.mockReturnValue(true);
    const list = vi.spyOn(merchantsApi, 'list').mockResolvedValue({
      items: [adminRow],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderPage();
    await screen.findByRole('link', { name: 'Luna Tech' });
    list.mockClear();

    await user.type(screen.getByLabelText('Search merchants'), 'luna');
    await user.click(screen.getByRole('button', { name: 'Apply search' }));

    await waitFor(() => expect(list).toHaveBeenCalledWith({ search: 'luna', page: 1, pageSize: 25 }));
  });

  it('shows the server error and a retry action when the list fails', async () => {
    permissionMock.mockReturnValue(true);
    vi.spyOn(merchantsApi, 'list').mockRejectedValue(new ApiError('Merchant directory is unavailable.', 409));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Merchant directory is unavailable.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an empty state when no merchants match', async () => {
    permissionMock.mockReturnValue(false);
    vi.spyOn(merchantsApi, 'list').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    renderPage();

    expect(await screen.findByText('No merchants match this search.')).toBeInTheDocument();
  });
});
