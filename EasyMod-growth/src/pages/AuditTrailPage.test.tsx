import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, adminApi, type PrivilegedAuditEntry } from '@/api/client';
import { AuditTrailPage } from './AuditTrailPage';

const reportApiError = vi.fn(() => false);
vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

const entry: PrivilegedAuditEntry = {
  id: 'audit-1',
  actor: { userId: 'user-1', name: 'Ada Mensah' },
  action: 'merchant.status.suspend',
  resourceType: 'GROWTH_OS_ADMIN_MERCHANT',
  resourceId: 'shop-1',
  shopId: 'shop-1',
  ipAddress: '10.0.0.5',
  createdAt: '2026-09-10T15:20:00.000Z',
  oldValues: { isActive: true, token: 'redacted' },
  newValues: { isActive: false },
  reason: 'Repeated policy violations reported by Meta',
};

function makeResult(overrides: Partial<{ items: PrivilegedAuditEntry[]; total: number }> = {}) {
  return {
    items: overrides.items ?? [entry],
    total: overrides.total ?? 1,
    page: 1,
    pageSize: 50,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/audit']}>
      <AuditTrailPage />
    </MemoryRouter>,
  );
}

describe('AuditTrailPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders actor, action, resource, and the reason column', async () => {
    vi.spyOn(adminApi, 'auditLogs').mockResolvedValue(makeResult());
    const { container } = renderPage();

    expect(await screen.findByText('Repeated policy violations reported by Meta')).toBeInTheDocument();
    expect(screen.getByText('merchant.status.suspend')).toBeInTheDocument();
    expect(screen.getByText('Ada Mensah')).toBeInTheDocument();
    expect(screen.getByText('GROWTH_OS_ADMIN_MERCHANT')).toBeInTheDocument();
    expect(screen.getAllByText('shop-1').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('10.0.0.5')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by GROWTH_OS_ADMIN_MERCHANT' })).toBeInTheDocument();
    expect(container.querySelector('details')).not.toBeNull();
  });

  it('passes resourceType to the API only when a filter button is chosen', async () => {
    const user = userEvent.setup();
    const logs = vi.spyOn(adminApi, 'auditLogs').mockResolvedValue(makeResult());
    renderPage();
    await screen.findByText('merchant.status.suspend');

    expect(logs).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 });

    logs.mockResolvedValue(makeResult({ items: [], total: 0 }));
    await user.click(screen.getByRole('button', { name: 'Filter by growth_os_prospect' }));
    await waitFor(() => expect(logs).toHaveBeenLastCalledWith({
      resourceType: 'growth_os_prospect',
      page: 1,
      pageSize: 50,
    }));

    logs.mockResolvedValue(makeResult());
    await user.click(screen.getByRole('button', { name: 'All resources' }));
    await waitFor(() => expect(logs).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 }));
  });

  it('applies the action search on submit', async () => {
    const user = userEvent.setup();
    const logs = vi.spyOn(adminApi, 'auditLogs').mockResolvedValue(makeResult());
    renderPage();
    await screen.findByText('merchant.status.suspend');
    logs.mockClear();

    await user.type(screen.getByLabelText('Search by action'), 'suspend');
    await user.click(screen.getByRole('button', { name: 'Apply search' }));

    await waitFor(() => expect(logs).toHaveBeenCalledWith({ search: 'suspend', page: 1, pageSize: 50 }));
  });

  it('shows the server error with retry when the trail cannot load', async () => {
    vi.spyOn(adminApi, 'auditLogs').mockRejectedValue(new ApiError('Audit store unavailable.', 500));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Audit store unavailable.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an empty state when no entries match', async () => {
    vi.spyOn(adminApi, 'auditLogs').mockResolvedValue(makeResult({ items: [], total: 0 }));
    renderPage();

    expect(await screen.findByText('No privileged actions match these filters.')).toBeInTheDocument();
  });
});
