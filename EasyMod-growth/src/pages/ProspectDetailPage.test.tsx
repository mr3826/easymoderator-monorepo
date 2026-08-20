import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, growthApi, type Prospect } from '@/api/client';
import { usePermission } from '@/auth/usePermission';
import { ProspectDetailPage } from './ProspectDetailPage';

vi.mock('@/auth/usePermission', () => ({
  usePermission: vi.fn(),
}));

const permissionMock = vi.mocked(usePermission);
const reportApiError = vi.fn(() => false);

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

const PROSPECT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: PROSPECT_ID,
    businessName: 'North Star Retail',
    contactName: 'Owner',
    contactPhone: '01700000000',
    contactEmail: 'owner@example.com',
    pageUrl: null,
    niche: 'retail',
    notes: 'Follow up next week',
    source: 'manual_entry',
    sourceDetail: null,
    sourceReference: null,
    sourceRecordedAt: null,
    status: 'qualified',
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
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/prospects/${PROSPECT_ID}`]}>
      <Routes>
        <Route path="/prospects/:prospectId" element={<ProspectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe('ProspectDetailPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function setup(prospect = makeProspect()) {
    permissionMock.mockReturnValue(true);
    reportApiError.mockReturnValue(false);
    vi.spyOn(growthApi, 'getProspect').mockResolvedValue(prospect);
    vi.spyOn(growthApi, 'getProspectLinkageSuggestions').mockResolvedValue([]);
  }

  it('offers only legal next statuses and caps reason fields', async () => {
    setup();
    renderPage();

    await screen.findByRole('heading', { name: 'North Star Retail' });
    const options = screen.getByLabelText('Move to status').querySelectorAll('option');
    expect([...options].map((option) => option.value)).toEqual([
      'qualified',
      'converted',
      'disqualified',
      'unreachable',
    ]);
    expect(screen.getByLabelText(/Reason.*required for disqualification/)).toHaveAttribute('maxLength', '200');
  });

  it('rejects malformed UUID owners before the mutation request', async () => {
    const user = userEvent.setup();
    setup();
    const assign = vi.spyOn(growthApi, 'assignProspect');
    renderPage();

    await screen.findByRole('heading', { name: 'North Star Retail' });
    await user.type(screen.getByLabelText('Owner user ID'), 'not-a-uuid');
    await user.type(document.getElementById('assignment-reason') as HTMLTextAreaElement, 'Assign safely');
    await user.click(screen.getByRole('button', { name: 'Save owner' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Owner user ID must be a valid UUID.');
    expect(assign).not.toHaveBeenCalled();
  });

  it('disables assignment controls while the mutation is pending', async () => {
    const user = userEvent.setup();
    setup();
    let resolveAssignment: (() => void) | undefined;
    const assign = vi.spyOn(growthApi, 'assignProspect').mockReturnValue(new Promise((resolve) => {
      resolveAssignment = () => resolve(makeProspect({ ownerUserId: OWNER_ID }));
    }));
    renderPage();

    await screen.findByRole('heading', { name: 'North Star Retail' });
    await user.type(screen.getByLabelText('Owner user ID'), OWNER_ID);
    await user.type(document.getElementById('assignment-reason') as HTMLTextAreaElement, 'Assign safely');
    await user.click(screen.getByRole('button', { name: 'Save owner' }));

    expect(assign).toHaveBeenCalledWith(PROSPECT_ID, {
      ownerUserId: OWNER_ID,
      reason: 'Assign safely',
    });
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
    resolveAssignment?.();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving' })).not.toBeInTheDocument());
  });

  it('submits legal status transitions with their reason', async () => {
    const user = userEvent.setup();
    setup();
    const transition = vi.spyOn(growthApi, 'transitionProspectStatus').mockResolvedValue(makeProspect({
      status: 'converted',
    }));
    renderPage();

    await screen.findByRole('heading', { name: 'North Star Retail' });
    await user.selectOptions(screen.getByLabelText('Move to status'), 'converted');
    await user.type(screen.getByLabelText(/Reason.*required for disqualification/), 'Shop linkage verified');
    await user.click(screen.getByRole('button', { name: 'Update lifecycle' }));

    expect(transition).toHaveBeenCalledWith(PROSPECT_ID, {
      status: 'converted',
      reason: 'Shop linkage verified',
    });
  });

  it('submits validated manual linkage', async () => {
    const user = userEvent.setup();
    setup();
    const link = vi.spyOn(growthApi, 'linkProspect').mockResolvedValue(makeProspect({
      linkedShopId: OWNER_ID,
    }));
    renderPage();

    await screen.findByRole('heading', { name: 'North Star Retail' });
    await user.type(screen.getByLabelText('Shop ID'), OWNER_ID);
    await user.type(document.getElementById('link-reason') as HTMLTextAreaElement, 'Verified shop');
    await user.click(screen.getByRole('button', { name: 'Save linkage' }));

    expect(link).toHaveBeenCalledWith(PROSPECT_ID, {
      shopId: OWNER_ID,
      reason: 'Verified shop',
    });
  });

  it('clears existing linkage through the nullable link payload', async () => {
    const user = userEvent.setup();
    setup(makeProspect({ linkedShopId: OWNER_ID }));
    const link = vi.spyOn(growthApi, 'linkProspect').mockResolvedValue(makeProspect());
    renderPage();

    await screen.findByRole('heading', { name: 'North Star Retail' });
    await user.type(document.getElementById('link-reason') as HTMLTextAreaElement, 'Remove stale linkage');
    await user.click(screen.getByRole('button', { name: 'Clear linkage' }));

    expect(link).toHaveBeenCalledWith(PROSPECT_ID, {
      shopId: null,
      userId: null,
      reason: 'Remove stale linkage',
    });
  });

  it('redirects to the merge target after a successful merge', async () => {
    const user = userEvent.setup();
    setup();
    vi.spyOn(growthApi, 'mergeProspect').mockResolvedValue({
      mergedProspect: makeProspect({ status: 'merged', mergedIntoId: OWNER_ID }),
      targetProspect: makeProspect({ id: OWNER_ID, businessName: 'Target Prospect' }),
    });
    render(
      <MemoryRouter initialEntries={[`/prospects/${PROSPECT_ID}`]}>
        <Routes>
          <Route path="/prospects/:prospectId" element={<ProspectDetailPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'North Star Retail' });
    await user.type(screen.getByLabelText('Target prospect ID'), OWNER_ID);
    await user.type(document.getElementById('merge-reason') as HTMLTextAreaElement, 'Duplicate record');
    await user.click(screen.getByRole('button', { name: 'Merge record' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/prospects/${OWNER_ID}`));
  });

  it('locks merged records against edit and mutation controls', async () => {
    setup(makeProspect({ status: 'merged', mergedIntoId: OWNER_ID, mergedAt: '2026-08-20T00:00:00.000Z' }));
    renderPage();

    await screen.findByRole('heading', { name: 'North Star Retail' });
    expect(screen.queryByRole('link', { name: 'Edit prospect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save owner' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Merged records cannot be changed.')).toHaveLength(2);
  });

  it('routes endpoint authentication failures through the auth provider', async () => {
    setup();
    vi.spyOn(growthApi, 'getProspect').mockRejectedValue(new ApiError('Expired', 401, 'AUTH_REQUIRED'));
    reportApiError.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(reportApiError).toHaveBeenCalledWith(expect.objectContaining({ status: 401 })));
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('reports a linkage suggestion authentication failure only once', async () => {
    setup();
    vi.spyOn(growthApi, 'getProspectLinkageSuggestions').mockRejectedValue(new ApiError('Expired', 401, 'AUTH_REQUIRED'));
    reportApiError.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(reportApiError).toHaveBeenCalledTimes(1));
  });
});
