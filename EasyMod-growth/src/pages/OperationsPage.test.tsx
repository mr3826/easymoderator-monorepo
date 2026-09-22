import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, adminApi, type OperationsResponse } from '@/api/client';
import { OperationsPage } from './OperationsPage';

const reportApiError = vi.fn(() => false);
vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

function makeOps(overrides: Partial<OperationsResponse> = {}): OperationsResponse {
  return {
    windowDays: 7,
    generatedAt: '2026-09-13T09:00:00.000Z',
    merchants: { total: 260, newInWindow: 18 },
    subscriptions: { active: 210, trialing: 30, cancelled: 12, suspended: 8 },
    payments: { stuckOver24h: 2, failedInWindow: 0 },
    meta: { channelsNeedingAttention: 1 },
    ai: { messagesInWindow: 4800, conversationsInWindow: 190 },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/operations']}>
      <OperationsPage />
    </MemoryRouter>,
  );
}

describe('OperationsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('marks payments and channel problems with the warn metric style when above zero', async () => {
    vi.spyOn(adminApi, 'operations').mockResolvedValue(makeOps());
    const { container } = renderPage();

    expect(await screen.findByText('Subscription states')).toBeInTheDocument();
    const warnMetrics = container.querySelectorAll('.metric.warn');
    expect(warnMetrics).toHaveLength(2);
    expect(warnMetrics[0]).toHaveTextContent('2');
    expect(warnMetrics[1]).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'Investigate merchants' })).toHaveAttribute('href', '/merchants');
    expect(screen.getByText('Stuck over 24h — attention needed when above zero.')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders a truthful zero-safe snapshot without warn styling', async () => {
    vi.spyOn(adminApi, 'operations').mockResolvedValue(makeOps({
      merchants: { total: 0, newInWindow: 0 },
      subscriptions: {},
      payments: { stuckOver24h: 0, failedInWindow: 0 },
      meta: { channelsNeedingAttention: 0 },
      ai: { messagesInWindow: null, conversationsInWindow: 0 },
    }));
    const { container } = renderPage();

    expect(await screen.findByText('No new merchants in the window.')).toBeInTheDocument();
    expect(screen.getByText('Not measured')).toBeInTheDocument();
    expect(screen.getByText('No subscription states were reported in this snapshot.')).toBeInTheDocument();
    expect(container.querySelectorAll('.metric.warn')).toHaveLength(0);
  });

  it('reloads the snapshot when switching to the 30-day window', async () => {
    const user = userEvent.setup();
    const operations = vi.spyOn(adminApi, 'operations').mockResolvedValue(makeOps({ windowDays: 7 }));
    renderPage();

    expect(await screen.findByText('Subscription states')).toBeInTheDocument();
    expect(operations).toHaveBeenCalledWith(7);
    operations.mockResolvedValue(makeOps({ windowDays: 30 }));

    await user.click(screen.getByRole('button', { name: 'Last 30 days' }));
    await waitFor(() => expect(operations).toHaveBeenCalledWith(30));
    expect(await screen.findByText(/Snapshot generated .* for the last 30 days/)).toBeInTheDocument();
  });

  it('shows the server error and a retry action when the snapshot fails', async () => {
    vi.spyOn(adminApi, 'operations').mockRejectedValue(new ApiError('Metrics service unavailable.', 500));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Metrics service unavailable.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
