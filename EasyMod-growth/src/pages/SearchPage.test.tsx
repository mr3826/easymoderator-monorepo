import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi, type SearchResults } from '@/api/client';
import { SearchPage } from './SearchPage';

const reportApiError = vi.fn(() => false);
let sessionRole = 'SUPER_ADMIN';

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError, session: { role: sessionRole, permissions: [] } }),
}));

function renderAt(query: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/search', state: { query } }]}>
      <SearchPage />
    </MemoryRouter>,
  );
}

describe('SearchPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    reportApiError.mockReturnValue(false);
    sessionRole = 'SUPER_ADMIN';
  });

  it('renders prospect, merchant, and user groups for a super admin', async () => {
    const results: SearchResults = {
      prospects: [{
        prospectId: 'p-1', businessName: 'North Star Retail', status: 'qualified',
        source: 'manual_entry', ownerUserId: 'u-1',
        contactName: 'Ana', contactPhone: null, contactEmail: 'ana@example.test',
      }],
      merchants: [{
        shopId: 's-1', merchantName: 'North Star', uniqueCode: 'STAR1',
        planName: 'Shuru', subscriptionStatus: 'active',
        owner: { name: 'Ana', email: 'ana@m.example' },
      }],
      users: [{ userId: 'u-9', email: 'growth@easymod.tech', displayName: 'Growth Ops' }],
    };
    const search = vi.spyOn(workspaceApi, 'search').mockResolvedValue(results);

    renderAt('north');

    expect(await screen.findByText('North Star Retail')).toBeInTheDocument();
    expect(screen.getByText(/ana@m\.example/)).toBeInTheDocument();
    expect(screen.getByText('Growth Ops')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'North Star' })).toHaveAttribute('href', '/merchants/s-1');
    expect(screen.getByRole('link', { name: 'Growth Ops' })).toHaveAttribute('href', '/growth-users');
    await waitFor(() => expect(search).toHaveBeenCalledWith('north'));
  });

  it('shows only masked merchant fields for a growth user and never renders the user group', async () => {
    sessionRole = 'GROWTH_USER';
    vi.spyOn(workspaceApi, 'search').mockResolvedValue({
      prospects: [],
      merchants: [{
        shopId: 's-2', merchantName: 'Comet Shop', planName: 'Growth',
        activated: false, signupDate: '2026-08-01T00:00:00.000Z',
      }],
      users: [{ userId: 'u-secret', email: 'hidden@easymod.tech', displayName: 'Hidden' }],
    });

    renderAt('comet');

    expect(await screen.findByText('Comet Shop')).toBeInTheDocument();
    expect(screen.getByText(/not activated/)).toBeInTheDocument();
    expect(screen.queryByText(/Shuru/)).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('hidden@easymod.tech')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('does not call the API for queries shorter than two characters', async () => {
    const search = vi.spyOn(workspaceApi, 'search');

    renderAt('a');

    expect(await screen.findByText('Enter at least 2 characters.')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it('caps queries at the backend validation length and describes searchable fields', async () => {
    const search = vi.spyOn(workspaceApi, 'search').mockResolvedValue({ prospects: [], merchants: [], users: [] });
    renderAt('x'.repeat(120));

    expect(screen.getByLabelText('Search query')).toHaveAttribute('placeholder', 'Business, contact, phone, email, page URL, or code');
    expect(screen.getByLabelText('Search query')).toHaveAttribute('maxLength', '100');
    await waitFor(() => expect(search).toHaveBeenCalledWith('x'.repeat(100)));
  });

  it('surfaces server validation messages and routes auth failures through the provider', async () => {
    vi.spyOn(workspaceApi, 'search').mockRejectedValue(
      new ApiError('query must be 100 characters or fewer.', 400, 'GROWTH_OS_SEARCH_QUERY_INVALID'),
    );
    renderAt('shop');
    expect(await screen.findByRole('alert')).toHaveTextContent('100 characters');

    reportApiError.mockReturnValue(true);
    vi.mocked(workspaceApi.search).mockRejectedValue(new ApiError('Expired', 401));
    renderAt('store');
    await waitFor(() => expect(reportApiError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 })));
  });

  it('shows the empty-scoped feedback when no group has results', async () => {
    vi.spyOn(workspaceApi, 'search').mockResolvedValue({ prospects: [], merchants: [], users: [] });

    renderAt('zzzz');

    expect(await screen.findByText('Nothing matched within your access scope. Try an exact email, phone digits, or unique shop code.')).toBeInTheDocument();
  });
});
