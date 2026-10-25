import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Orders from '@/app/components/Orders'
import type { Order } from '@/api/types/order'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('@/api', () => ({
  apiClient: {
    getOrders: vi.fn().mockResolvedValue([]),
    getProducts: vi.fn().mockResolvedValue([]),
    getOrder: vi.fn(),
    getConversations: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 1 }),
    getMessages: vi.fn().mockResolvedValue({ messages: [], pagination: { page: 1, totalPages: 1 } }),
    createOrder: vi.fn(),
    updateOrder: vi.fn(),
    confirmOrder: vi.fn(),
  },
}))

// The confidence panel is not under test here and needs the auth context;
// keep this suite hermetic (its own tests live elsewhere).
vi.mock('@/app/components/orders/OrderConfidencePanel', () => ({
  default: () => null,
}))

const normalizedOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  orderNumber: 'ORD-1001',
  customerName: 'Rahim Uddin',
  customerPhone: '01712345678',
  deliveryAddress: 'Mirpur 10, Dhaka',
  items: [{ productId: 'p1', productName: 'Azal Lawn cap', quantity: 1, price: 1200 }],
  total: 1200,
  status: 'confirmed',
  channel: 'facebook',
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-20T08:00:00Z',
  ...over,
}) as unknown as Order

const openDetail = async (viewIndex = 0) => {
  const buttons = await screen.findAllByRole('button', { name: /view detail/i })
  fireEvent.click(buttons[viewIndex])
}

describe('Orders', () => {
  it('renders orders page', async () => {
    render(<MemoryRouter><Orders /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('Orders')).toBeInTheDocument()
    })
  })
})

// FE-08: the order detail's conversation snippet must be resolved through the
// shop-scoped customer id (verified backend association), NEVER a name search.
describe('FE-08 order → conversation association', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigate.mockReset()
  })

  it('links by customer_id and offers the canonical inbox deep link', async () => {
    const { apiClient } = await import('@/api')
    vi.mocked(apiClient.getOrders).mockResolvedValue([normalizedOrder({ customerId: 'cust-1' })])
    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [{ id: 'conv-9', customer_id: 'cust-1' }],
      total: 1, page: 1, pageSize: 1,
    })
    ;(apiClient.getMessages as any).mockResolvedValue({
      messages: [{ content: 'hi there' }],
      pagination: { page: 1, totalPages: 1 },
    })

    render(<MemoryRouter><Orders /></MemoryRouter>)
    await openDetail()

    await waitFor(() => {
      expect(screen.getByText('hi there')).toBeInTheDocument()
    })

    // called with the verified id association, not a name search
    const params = (apiClient.getConversations as any).mock.calls[0][0]
    expect(params).toMatchObject({ customer_id: 'cust-1' })
    expect(params).not.toHaveProperty('search')
    expect(apiClient.getConversations).not.toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Rahim Uddin' }),
      expect.anything()
    )

    fireEvent.click(screen.getByRole('button', { name: /open conversation in inbox/i }))
    expect(navigate).toHaveBeenCalledWith('/inbox?conversation=conv-9')
  })

  it('shows an unavailable state and calls nothing for an unlinked (manual) order', async () => {
    const { apiClient } = await import('@/api')
    vi.mocked(apiClient.getOrders).mockResolvedValue([normalizedOrder({ customerId: undefined })])

    render(<MemoryRouter><Orders /></MemoryRouter>)
    await openDetail()

    await waitFor(() => {
      expect(screen.getByText('No chat snippet found.')).toBeInTheDocument()
    })
    expect(apiClient.getConversations).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /open conversation in inbox/i })).not.toBeInTheDocument()
  })

  it('refuses to show messages from a conversation belonging to a different customer id', async () => {
    const { apiClient } = await import('@/api')
    vi.mocked(apiClient.getOrders).mockResolvedValue([normalizedOrder({ customerId: 'cust-1' })])
    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [{ id: 'conv-X', customer_id: 'cust-OTHER' }],
      total: 1, page: 1, pageSize: 1,
    })

    render(<MemoryRouter><Orders /></MemoryRouter>)
    await openDetail()

    await waitFor(() => {
      expect(screen.getByText('No chat snippet found.')).toBeInTheDocument()
    })
    expect(apiClient.getMessages).not.toHaveBeenCalled()
  })

  it('shows the unavailable state when the customer has no conversations', async () => {
    const { apiClient } = await import('@/api')
    vi.mocked(apiClient.getOrders).mockResolvedValue([normalizedOrder({ customerId: 'cust-1' })])
    ;(apiClient.getConversations as any).mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 1 })

    render(<MemoryRouter><Orders /></MemoryRouter>)
    await openDetail()

    await waitFor(() => {
      expect(screen.getByText('No chat snippet found.')).toBeInTheDocument()
    })
    expect(apiClient.getMessages).not.toHaveBeenCalled()
  })

  it('discards a slower request for a previously opened order (stale response guard)', async () => {
    const { apiClient } = await import('@/api')
    const slow = normalizedOrder({ id: 'slow-1', orderNumber: 'ORD-SLOW', customerId: 'cust-slow' })
    const fast = normalizedOrder({ id: 'fast-1', orderNumber: 'ORD-FAST', customerId: 'cust-fast' })
    vi.mocked(apiClient.getOrders).mockResolvedValue([slow, fast])
    ;(apiClient.getConversations as any).mockImplementation(async (params: any) => {
      if (params.customer_id === 'cust-slow') {
        await new Promise((r) => setTimeout(r, 150))
        return { data: [{ id: 'conv-slow', customer_id: 'cust-slow' }], total: 1, page: 1, pageSize: 1 }
      }
      return { data: [{ id: 'conv-fast', customer_id: 'cust-fast' }], total: 1, page: 1, pageSize: 1 }
    })
    ;(apiClient.getMessages as any).mockImplementation(async (conversationId: string) => {
      if (conversationId === 'conv-slow') {
        await new Promise((r) => setTimeout(r, 150))
        return { messages: [{ content: 'SLOW ANSWER' }], pagination: { page: 1, totalPages: 1 } }
      }
      return { messages: [{ content: 'FAST ANSWER' }], pagination: { page: 1, totalPages: 1 } }
    })

    render(<MemoryRouter><Orders /></MemoryRouter>)
    await openDetail(0) // opens slow order
    await openDetail(1) // immediately switch to fast order

    await waitFor(() => {
      expect(screen.getByText('FAST ANSWER')).toBeInTheDocument()
    }, { timeout: 3000 })
    // let the in-flight slow chain land, then assert it never overwrote the state
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.queryByText('SLOW ANSWER')).not.toBeInTheDocument()
  }, 10000)
})
