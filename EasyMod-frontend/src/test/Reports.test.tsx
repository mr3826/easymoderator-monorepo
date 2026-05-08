import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Reports from '../app/components/Reports'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/api', () => ({
  apiClient: {
    getChannels: vi.fn().mockResolvedValue([
      { id: 'ch-1', type: 'facebook', name: 'Facebook Inbox', message_count: 20 },
      { id: 'ch-2', type: 'whatsapp', name: 'WhatsApp Inbox', message_count: 10 },
    ]),
    getDashboardMetrics: vi.fn().mockResolvedValue({
      metrics: {
        totalMessages: 30,
        activeProducts: 12,
        ordersToday: 7,
        conversionRate: 6.5,
      },
      channels: {
        active: 2,
        total: 3,
      },
      chartData: [],
    }),
    getKnowledgeGaps: vi.fn().mockResolvedValue([]),
  },
}))

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Reports', () => {
  it('renders metrics and channel performance from API data', async () => {
    renderWithRouter(<Reports />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '30' })).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { name: '12' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '7' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '6.5%' })).toBeInTheDocument()
    expect(screen.getByText('Facebook Inbox')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp Inbox')).toBeInTheDocument()
  })
})
