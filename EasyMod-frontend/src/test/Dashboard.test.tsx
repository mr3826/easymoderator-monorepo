import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Dashboard from '@/app/components/Dashboard'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
    useParams: () => ({}),
  }
})

vi.mock('@/api', () => ({
  apiClient: {
    getSetupStatus: vi.fn().mockResolvedValue({
      isComplete: true,
      completedCount: 4,
      totalCount: 4,
      progressPercent: 100,
      tasks: [],
      counts: {
        connectedFacebookPages: 1,
        webhookVerifiedFacebookPages: 1,
        activeProducts: 3,
        activeFaqs: 1,
        knowledgeDocuments: 0,
      },
      generatedAt: '2026-07-04T00:00:00.000Z',
    }),
    getDashboardMetrics: vi.fn().mockResolvedValue({
      analytics: { llm_calls: 42 }
    }),
    getDashboardQueue: vi.fn().mockResolvedValue({
      unread_count: 3,
      at_risk_orders: []
    }),
    getOrders: vi.fn().mockResolvedValue([
      { id: 'o1', total: 500, status: 'confirmed', items: [{ name: 'Item A', quantity: 1 }] },
      { id: 'o2', total: 300, status: 'processing', items: [{ name: 'Item B', quantity: 2 }] },
    ]),
  }
}))

describe('Dashboard', () => {
  it('renders dashboard with pulse data', async () => {
    render(<Dashboard />)

    // Wait for async data load — heading is always present after load.
    // The test runtime resolves i18n to the English locale, so assert against
    // the English copy (dashboard.pulse.* keys).
    await waitFor(() => {
      expect(screen.getByText('Today\'s Status')).toBeInTheDocument()
    })

    // Stat cards rendered. "Confirmed" can also appear as an order-status badge,
    // so allow more than one match.
    expect(screen.getByText('Today\'s Sales')).toBeInTheDocument()
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0)
  })
})
