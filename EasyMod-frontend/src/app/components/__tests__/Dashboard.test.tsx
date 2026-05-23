/**
 * Dashboard — cash-position section (TDD: failing until Task 6 adds the UI)
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Dashboard';
import { apiClient } from '@/api';

// ── Mock the API client (same path Dashboard.tsx uses: @/api) ─────────────────
vi.mock('@/api', () => ({
  apiClient: {
    getDashboardMetrics: vi.fn(),
    getDashboardQueue: vi.fn(),
    getOrders: vi.fn(),
  },
}));

// ── Mock react-i18next (t returns the key so we can match translation keys) ───
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, _opts?: Record<string, unknown>) => key }),
}));

// ── Mock sonner so toast calls don't throw ────────────────────────────────────
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// ── Helper ────────────────────────────────────────────────────────────────────
function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

// ── Shared queue / orders baseline (no cash-position data) ───────────────────
const baseQueue = {
  unread_count: 0,
  pending_payment_count: 0,
  ready_to_dispatch_count: 0,
  at_risk_orders: [],
};

describe('Dashboard — cash position section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getDashboardQueue).mockResolvedValue(baseQueue as never);
    vi.mocked(apiClient.getOrders).mockResolvedValue([] as never);
  });

  it('renders both cash-position cards when backend returns cashPosition', async () => {
    vi.mocked(apiClient.getDashboardMetrics).mockResolvedValue({
      metrics: {
        totalMessages: 0,
        activeProducts: 0,
        ordersToday: 0,
        ordersInPeriod: 0,
        conversionRate: 0,
        weeklyChange: 0,
      },
      channels: { active: 0, total: 0 },
      analytics: null,
      period: 30,
      cashPosition: {
        inTransit: { amount: 12500, count: 7 },
        atRisk:    { amount: 3400,  count: 2, windowDays: 30 },
      },
    } as never);

    renderDashboard();

    // Task 6 will add these labels — until then this test intentionally fails.
    await waitFor(() => {
      // "courier in transit" card label (Bangla)
      expect(screen.getByText(/কুরিয়ারে আটকে আছে/)).toBeInTheDocument();
    });

    // "at risk / returns incoming" card label (Bangla)
    expect(screen.getByText(/ফেরত আসছে/)).toBeInTheDocument();

    // Order counts visible as plain digits
    expect(screen.getByText(/\b7\b/)).toBeInTheDocument();
    expect(screen.getByText(/\b2\b/)).toBeInTheDocument();
  });

  it('renders zero-state placeholders when backend omits cashPosition (backwards compat)', async () => {
    vi.mocked(apiClient.getDashboardMetrics).mockResolvedValue({
      metrics: {
        totalMessages: 0,
        activeProducts: 0,
        ordersToday: 0,
        ordersInPeriod: 0,
        conversionRate: 0,
        weeklyChange: 0,
      },
      channels: { active: 0, total: 0 },
      analytics: null,
      period: 30,
      // cashPosition deliberately absent — backwards compat
    } as never);

    renderDashboard();

    // Section should still render (with zero amounts) without throwing.
    await waitFor(() => {
      expect(screen.getByText(/কুরিয়ারে আটকে আছে/)).toBeInTheDocument();
    });
  });
});
