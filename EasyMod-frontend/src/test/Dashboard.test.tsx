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

    // Wait for async data load — heading is always present after load
    await waitFor(() => {
      expect(screen.getByText('আজকের অবস্থা')).toBeInTheDocument()
    })

    // Stat cards rendered
    expect(screen.getByText('আজকের বিক্রি')).toBeInTheDocument()
    expect(screen.getByText('নিশ্চিত হয়েছে')).toBeInTheDocument()
  })
})
