import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import UnifiedInbox from '@/app/components/UnifiedInbox'
import { apiClient } from '@/api'
import { toast } from 'sonner'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
  }
})

vi.mock('@/api', () => ({
  apiClient: {
    // Auth methods
    getShopAgents: vi.fn(),
    // Conversation methods
    getConversations: vi.fn(),
    getMessages: vi.fn(),
    createMessage: vi.fn(),
    updateConversation: vi.fn(),
    transcribeVoice: vi.fn(),
    getResponseTemplates: vi.fn(),
    createAuditLog: vi.fn(),
    // Other methods needed
    getSubscription: vi.fn(),
  }
}))

vi.mock('@/app/lib/useSubscriptionFeatures', () => ({
  useSubscriptionFeatures: () => ({
    features: {
      image_understanding: true,
      advanced_ai: true,
      priority_support: true,
      custom_branding: false,
    },
    planName: 'PRO',
    plan: null,
    loading: false,
  })
}))

vi.mock('@/app/lib/useInboxSSE', () => ({
  useInboxSSE: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

const baseConversation = {
  id: 'conv-1',
  customer_id: 'cust-1',
  customer: { id: 'cust-1', name: 'Alice' },
  channel: 'facebook' as const,
  status: 'active' as const,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('UnifiedInbox 24h window behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(apiClient.getResponseTemplates as any).mockResolvedValue([])
    ;(apiClient.getMessages as any).mockResolvedValue({
      messages: [],
      pagination: { page: 1, totalPages: 1 }
    })
    ;(apiClient.getShopAgents as any).mockResolvedValue([])
    ;(apiClient.getConversations as any).mockResolvedValue({
      conversations: [],
      pagination: { page: 1, totalPages: 1 }
    })
    ;(apiClient.createMessage as any).mockResolvedValue({
      id: 'msg-1',
      conversation_id: 'conv-1',
      content: 'hello',
      sender: 'agent',
      message_type: 'text',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    ;(apiClient.updateConversation as any).mockResolvedValue({
      id: 'conv-1',
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    ;(apiClient.createAuditLog as any).mockResolvedValue({
      id: 'audit-1',
      action: 'UPDATE',
      resource_type: 'CONVERSATION',
      resource_id: 'conv-1',
      created_at: new Date().toISOString(),
    })
    ;(apiClient.transcribeVoice as any).mockResolvedValue({
      messageId: 'msg-1',
      transcript: 'Hello world',
      language: 'english',
    })
    ;(apiClient.getSubscription as any).mockResolvedValue({
      plan: 'PRO',
      status: 'active',
      features: {
        image_understanding: true,
        advanced_ai: true,
        priority_support: true,
        custom_branding: false,
      },
    })
  })

  it('shows 24h warning banner for Facebook conversation around 23h', async () => {
    const warningConversation = {
      ...baseConversation,
      updated_at: new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString(),
      channel: 'facebook' as const,
    }

    ;(apiClient.getConversations as any).mockResolvedValue({
      conversations: [warningConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/24-hour messaging window closing soon/i)).toBeInTheDocument()
    })
  })

  it('disables send for expired Facebook window until message tag is selected', async () => {
    const expiredConversation = {
      ...baseConversation,
      updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      channel: 'facebook' as const,
    }

    ;(apiClient.getConversations as any).mockResolvedValue({
      conversations: [expiredConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/Messaging window expired/i)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/Select a Message Tag above to continue/i)
    expect(input).toBeDisabled()

    const sendButton = screen.getByRole('button', { name: /^Send$/i })
    expect(sendButton).toBeDisabled()

    const tagSelect = screen.getByRole('combobox')
    fireEvent.change(tagSelect, { target: { value: 'HUMAN_AGENT' } })

    expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument()
  })

  it('sends message with message_tag after selecting tag in expired Meta window', async () => {
    const expiredConversation = {
      ...baseConversation,
      updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      channel: 'facebook' as const,
    }

    ;(apiClient.getConversations as any).mockResolvedValue({
      conversations: [expiredConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/Messaging window expired/i)).toBeInTheDocument()
    })

    const tagSelect = screen.getByRole('combobox')
    fireEvent.change(tagSelect, { target: { value: 'ACCOUNT_UPDATE' } })

    const input = screen.getByPlaceholderText(/Type a message/i)
    fireEvent.change(input, { target: { value: 'Order update from agent' } })

    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }))

    await waitFor(() => {
      expect(apiClient.createMessage).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          content: 'Order update from agent',
          sender: 'agent',
          message_type: 'text',
          message_tag: 'ACCOUNT_UPDATE',
        })
      )
    })
  })

  it('blocks AI suggestion send when expired window has no selected message tag', async () => {
    const expiredConversation = {
      ...baseConversation,
      updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      channel: 'facebook' as const,
    }

    ;(apiClient.getConversations as any).mockResolvedValue({
      conversations: [expiredConversation],
      pagination: { page: 1, totalPages: 1 }
    })
    ;(apiClient.getMessages as any).mockResolvedValue({
      messages: [
        {
          id: 'msg-customer-1',
          conversation_id: 'conv-1',
          content: 'Please help',
          sender: 'customer',
          message_type: 'text',
          created_at: new Date(Date.now() - 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
        {
          id: 'msg-ai-1',
          conversation_id: 'conv-1',
          content: 'AI draft reply',
          ai_suggestion: 'AI draft reply',
          ai_confidence: 0.9,
          sender: 'ai',
          message_type: 'text',
          created_at: new Date(Date.now() - 30 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 30 * 1000).toISOString(),
        },
      ],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/AI Suggestion/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Use This/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Select a Message Tag to send an out-of-window message.')
    })
    expect(apiClient.createMessage).not.toHaveBeenCalled()
  })
})
