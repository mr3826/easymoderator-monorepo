import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import UnifiedInbox from '@/app/components/UnifiedInbox'
import { apiClient } from '@/api'
import { useInboxSSE } from '@/app/lib/useInboxSSE'
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
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
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
    success: vi.fn(),
    warning: vi.fn()
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

type InboxSSECallbacks = Parameters<typeof useInboxSSE>[0]

const setInboxData = (mode: string, messages: any[] = [], conversation = baseConversation) => {
  ;(apiClient.getConversations as any).mockResolvedValue({
    data: [conversation],
    ai_reply_mode: mode,
    pagination: { page: 1, totalPages: 1 },
  })
  ;(apiClient.getMessages as any).mockResolvedValue({
    messages,
    pagination: { page: 1, totalPages: 1 },
  })
}

const latestSSECallbacks = (): InboxSSECallbacks => {
  const calls = vi.mocked(useInboxSSE).mock.calls
  return calls[calls.length - 1]?.[0] as InboxSSECallbacks
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
      data: [],
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
    ;(apiClient.createTemplate as any).mockResolvedValue({
      id: 'tpl-new',
      name: 'Saved',
      content: 'Saved reply',
      category: 'Quick Reply',
      is_active: true,
    })
    ;(apiClient.updateTemplate as any).mockResolvedValue({
      id: 'tpl-1',
      name: 'Greeting',
      content: 'Updated reply',
      category: 'Quick Reply',
      is_active: true,
    })
    ;(apiClient.deleteTemplate as any).mockResolvedValue(undefined)
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
      data: [warningConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/Time to reply directly to this customer is almost up/i)).toBeInTheDocument()
    })
  })

  it('disables send for expired Facebook window because legacy tags are unavailable', async () => {
    const expiredConversation = {
      ...baseConversation,
      updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      channel: 'facebook' as const,
    }

    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [expiredConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/messaged over 24h ago/i)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/Wait for the customer to message again/i)
    expect(input).toBeDisabled()

    const sendButton = screen.getByRole('button', { name: /^Send$/i })
    expect(sendButton).toBeDisabled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('does not send manual message with deprecated tag after expired Meta window', async () => {
    const expiredConversation = {
      ...baseConversation,
      updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      channel: 'facebook' as const,
    }

    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [expiredConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/messaged over 24h ago/i)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/Wait for the customer to message again/i)
    expect(input).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }))

    expect(apiClient.createMessage).not.toHaveBeenCalled()
  })

  it('blocks AI suggestion send when expired window has no approved template path', async () => {
    const expiredConversation = {
      ...baseConversation,
      updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      channel: 'facebook' as const,
    }

    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [expiredConversation],
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
          metadata: { delivered: false, held_reason: 'draft_mode' },
          created_at: new Date(Date.now() - 30 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 30 * 1000).toISOString(),
        },
      ],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByText(/AI's reply/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Send this/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('This Messenger conversation is outside the 24-hour reply window.')
    })
    expect(apiClient.createMessage).not.toHaveBeenCalled()
  })

  it('keeps mic and assign controls hidden in Shared Inbox', async () => {
    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [baseConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type your reply here/i)).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /voice|recording|microphone/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('inserts quick reply templates into the composer instead of sending immediately', async () => {
    ;(apiClient.getResponseTemplates as any).mockResolvedValue([
      { id: 'tpl-1', name: 'Greeting', content: 'Hi {{customer_name}}', category: 'Quick Reply', is_active: true },
    ])
    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [baseConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type your reply here/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /quick replies/i }))
    fireEvent.click(await screen.findByText('Greeting'))

    expect(screen.getByDisplayValue('Hi Alice')).toBeInTheDocument()
    expect(apiClient.createMessage).not.toHaveBeenCalled()
  })

  it('creates, edits, deletes, and searches quick replies inside the inbox manager', async () => {
    ;(apiClient.getResponseTemplates as any).mockResolvedValue([
      { id: 'tpl-1', name: 'Greeting', content: 'Hello there', category: 'Quick Reply', is_active: true },
    ])
    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [baseConversation],
      pagination: { page: 1, totalPages: 1 }
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type your reply here/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /quick replies/i }))
    fireEvent.click(await screen.findByText('Manage quick replies'))

    fireEvent.change(screen.getByPlaceholderText('Quick reply name'), { target: { value: 'Payment' } })
    fireEvent.change(screen.getByPlaceholderText('Quick reply message'), { target: { value: 'Please pay now' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))

    await waitFor(() => {
      expect(apiClient.createTemplate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Payment',
        content: 'Please pay now',
        is_active: true,
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: /Edit Greeting/i }))
    fireEvent.change(screen.getByPlaceholderText('Quick reply message'), { target: { value: 'Updated reply' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(apiClient.updateTemplate).toHaveBeenCalledWith('tpl-1', expect.objectContaining({
        content: 'Updated reply',
      }))
    })

    fireEvent.change(screen.getAllByPlaceholderText('Search quick replies')[1], { target: { value: 'missing' } })
    expect(screen.getByText('No saved quick replies yet. Add answers you send often to save time in customer conversations.')).toBeInTheDocument()

    fireEvent.change(screen.getAllByPlaceholderText('Search quick replies')[1], { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Delete Greeting/i }))

    await waitFor(() => {
      expect(apiClient.deleteTemplate).toHaveBeenCalledWith('tpl-1')
    })
  })

  it('sends selected image attachment as upload metadata for backend delivery', async () => {
    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [baseConversation],
      pagination: { page: 1, totalPages: 1 }
    })
    ;(apiClient.createMessage as any).mockResolvedValue({
      id: 'msg-image',
      conversation_id: 'conv-1',
      content: 'Photo caption',
      sender: 'agent',
      message_type: 'image',
      metadata: {
        message_type: 'image',
        image_url: 'https://cdn.example.com/photo.png',
        file_url: 'https://cdn.example.com/photo.png',
        delivery_status: 'pending',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    render(<UnifiedInbox />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type your reply here/i)).toBeInTheDocument()
    })

    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })
    fireEvent.change(screen.getByPlaceholderText(/Type your reply here/i), { target: { value: 'Photo caption' } })
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }))

    await waitFor(() => {
      expect(apiClient.createMessage).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          content: 'Photo caption',
          sender: 'agent',
          message_type: 'image',
          metadata: expect.objectContaining({
            file_name: 'photo.png',
            mime_type: 'image/png',
            delivery_status: 'pending',
            file_data_url: expect.stringMatching(/^data:image\/png;base64,/),
          }),
        })
      )
    })
  })

  it('shows the AUTO mode and automatic activity claim while AI is processing', async () => {
    setInboxData('AUTO')

    render(<UnifiedInbox />)

    expect(await screen.findByTestId('inbox-ai-reply-mode')).toHaveTextContent('AI reply mode: Automatic replies')
    expect(await screen.findByRole('button', { name: /AI is replying/i })).toBeInTheDocument()
    expect(screen.getByTestId('inbox-reply-status')).toHaveTextContent('AI is preparing a reply')
  })

  const draftMessages = () => {
    const customerMessage = {
      id: 'msg-customer-draft',
      conversation_id: 'conv-1',
      content: 'Can you help?',
      sender: 'customer' as const,
      message_type: 'text' as const,
      created_at: new Date(Date.now() - 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
    }
    const heldMessage = {
      id: 'msg-ai-draft',
      conversation_id: 'conv-1',
      content: 'Here is a draft reply.',
      ai_suggestion: 'Here is a draft reply.',
      sender: 'ai' as const,
      message_type: 'text' as const,
      metadata: { delivered: false, held_reason: 'draft_mode' },
      created_at: new Date(Date.now() - 30 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 1000).toISOString(),
    }
    return { customerMessage, heldMessage }
  }

  it('shows DRAFT readiness when an undelivered held AI message exists', async () => {
    const { customerMessage, heldMessage } = draftMessages()
    setInboxData('DRAFT', [customerMessage, heldMessage])
    render(<UnifiedInbox />)

    expect(await screen.findByText('Draft ready for review')).toBeInTheDocument()
    expect(screen.queryByText('AI is replying')).not.toBeInTheDocument()
  })

  it('does not show DRAFT readiness when no undelivered held AI message exists', async () => {
    setInboxData('DRAFT')
    render(<UnifiedInbox />)

    expect(await screen.findByTestId('inbox-ai-reply-mode')).toHaveTextContent('Drafts for review')
    expect(screen.queryByText('Draft ready for review')).not.toBeInTheDocument()
  })

  it('keeps the manual composer and HITL control without an automatic-reply claim', async () => {
    setInboxData('MANUAL')

    render(<UnifiedInbox />)

    expect(await screen.findByTestId('inbox-ai-reply-mode')).toHaveTextContent('AI reply mode: Manual replies only')
    expect(await screen.findByPlaceholderText(/Type your reply here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Manual replies only/i })).toBeInTheDocument()
    expect(screen.queryByText('AI is replying')).not.toBeInTheDocument()
    expect(screen.queryByText('AI is preparing a reply')).not.toBeInTheDocument()
  })

  it('clears the active claim after a mode change', async () => {
    setInboxData('AUTO')
    render(<UnifiedInbox />)

    expect(await screen.findByRole('button', { name: /AI is replying/i })).toBeInTheDocument()
    act(() => {
      latestSSECallbacks().onAiReplyModeChanged?.({ mode: 'MANUAL' })
    })
    await waitFor(() => expect(screen.queryByText('AI is replying')).not.toBeInTheDocument())
    expect(screen.getByTestId('inbox-ai-reply-mode')).toHaveTextContent('Manual replies only')
  })

  it('clears the active claim after a successful manual send', async () => {
    setInboxData('AUTO')
    render(<UnifiedInbox />)
    const input = await screen.findByPlaceholderText(/Type your reply here/i)
    expect(await screen.findByRole('button', { name: /AI is replying/i })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'A manual reply' } })
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }))
    await waitFor(() => expect(apiClient.createMessage).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('AI is replying')).not.toBeInTheDocument())
  })

  it('clears the active claim after a failed manual send', async () => {
    setInboxData('AUTO')
    ;(apiClient.createMessage as any).mockRejectedValueOnce(new Error('delivery failed'))
    render(<UnifiedInbox />)
    const failedInput = await screen.findByPlaceholderText(/Type your reply here/i)
    expect(await screen.findByRole('button', { name: /AI is replying/i })).toBeInTheDocument()
    fireEvent.change(failedInput, { target: { value: 'This will fail' } })
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }))
    await waitFor(() => expect(screen.queryByText('AI is replying')).not.toBeInTheDocument())
  })

  it('clears draft-ready state when the held suggestion is dismissed', async () => {
    const { customerMessage, heldMessage } = draftMessages()
    setInboxData('DRAFT', [customerMessage, heldMessage])
    render(<UnifiedInbox />)
    expect(await screen.findByText('Draft ready for review')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }))
    await waitFor(() => expect(screen.queryByText('Draft ready for review')).not.toBeInTheDocument())
  })

  it('clears the active claim and exposes the failed terminal state on delivery failure', async () => {
    setInboxData('AUTO')
    render(<UnifiedInbox />)

    expect(await screen.findByRole('button', { name: /AI is replying/i })).toBeInTheDocument()
    act(() => {
      latestSSECallbacks().onDeliveryFailed?.({ conversation_id: 'conv-1', reason: 'Meta rejected it' })
    })

    await waitFor(() => {
      expect(screen.queryByText('AI is replying')).not.toBeInTheDocument()
      expect(screen.getByTestId('inbox-reply-status')).toHaveTextContent('AI reply failed')
    })
  })
})

describe('UnifiedInbox AI suggestion visibility (deliver-aware)', () => {
  const olderTs = new Date(Date.now() - 60 * 1000).toISOString()
  const newerTs = new Date(Date.now() - 30 * 1000).toISOString()
  const newestTs = new Date(Date.now() - 10 * 1000).toISOString()

  const customerMsg = {
    id: 'msg-customer-1',
    conversation_id: 'conv-1',
    content: 'Do you have this in red?',
    sender: 'customer' as const,
    message_type: 'text' as const,
    created_at: olderTs,
    updated_at: olderTs,
  }

  const aiMsg = (metadata: Record<string, unknown>, confidence = 0.9) => ({
    id: 'msg-ai-1',
    conversation_id: 'conv-1',
    content: 'AI draft reply',
    ai_suggestion: 'AI draft reply',
    ai_confidence: confidence,
    sender: 'ai' as const,
    message_type: 'text' as const,
    metadata,
    created_at: newerTs,
    updated_at: newerTs,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    ;(apiClient.getResponseTemplates as any).mockResolvedValue([])
    ;(apiClient.getShopAgents as any).mockResolvedValue([])
    ;(apiClient.updateConversation as any).mockResolvedValue({ id: 'conv-1', status: 'active' })
    ;(apiClient.createMessage as any).mockResolvedValue({
      id: 'msg-retry',
      conversation_id: 'conv-1',
      content: 'catalog.pdf',
      sender: 'agent',
      message_type: 'file',
      metadata: {
        file_name: 'catalog.pdf',
        file_url: 'https://cdn.example.com/catalog.pdf',
        delivery_status: 'pending',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  })

  const renderWith = (conv: any, messages: any[]) => {
    ;(apiClient.getConversations as any).mockResolvedValue({
      data: [conv],
      pagination: { page: 1, totalPages: 1 },
    })
    ;(apiClient.getMessages as any).mockResolvedValue({
      messages,
      pagination: { page: 1, totalPages: 1 },
    })
    render(<UnifiedInbox />)
  }

  it('HIDES the suggestion panel when the last AI reply was auto-delivered', async () => {
    renderWith(baseConversation, [customerMsg, aiMsg({ delivered: true })])

    // Wait for the thread to render (customer bubble present)…
    await waitFor(() => {
      expect(screen.getByText('Do you have this in red?')).toBeInTheDocument()
    })
    // …then the redundant "Send this" suggestion panel must NOT be present.
    expect(screen.queryByRole('button', { name: /Send this/i })).not.toBeInTheDocument()
  })

  it('SHOWS the held suggestion even when the conversation is in HITL (handoff)', async () => {
    renderWith({ ...baseConversation, hitl: true }, [
      customerMsg,
      aiMsg({ delivered: false, held_reason: 'draft_mode' }),
    ])

    expect(await screen.findByRole('button', { name: /Send this/i })).toBeInTheDocument()
  })

  it('shows the low-confidence note only when held_reason is low_confidence', async () => {
    renderWith({ ...baseConversation, hitl: true }, [
      customerMsg,
      aiMsg({ delivered: false, held_reason: 'low_confidence' }, 0.9),
    ])

    expect(await screen.findByText(/Low confidence/i)).toBeInTheDocument()
  })

  it('surfaces the held draft, not the delivered holding message, after a handoff', async () => {
    const holdingMsg = {
      id: 'msg-ai-holding',
      conversation_id: 'conv-1',
      content: 'A representative will reply shortly.',
      sender: 'ai' as const,
      message_type: 'text' as const,
      metadata: { delivered: true, type: 'escalation_auto_reply' },
      created_at: newestTs,
      updated_at: newestTs,
    }
    renderWith({ ...baseConversation, hitl: true }, [
      customerMsg,
      aiMsg({ delivered: false, held_reason: 'low_confidence' }, 0.4),
      holdingMsg,
    ])

    // Even though the newest AI message is a delivered holding message, the panel
    // must surface the earlier HELD draft (with its low-confidence note).
    expect(await screen.findByRole('button', { name: /Send this/i })).toBeInTheDocument()
    expect(screen.getByText(/Low confidence/i)).toBeInTheDocument()
  })

  it('renders inbound/outbound attachments and retries failed outbound delivery', async () => {
    const inboundImage = {
      id: 'msg-image-in',
      conversation_id: 'conv-1',
      content: '[Attachment]',
      sender: 'customer' as const,
      message_type: 'image' as const,
      metadata: { image_url: 'https://cdn.example.com/inbound.png' },
      created_at: olderTs,
      updated_at: olderTs,
    }
    const outboundFile = {
      id: 'msg-file-out',
      conversation_id: 'conv-1',
      content: 'catalog.pdf',
      sender: 'agent' as const,
      message_type: 'file' as const,
      metadata: {
        file_name: 'catalog.pdf',
        file_url: 'https://cdn.example.com/catalog.pdf',
        delivery_status: 'failed',
        delivery_error: 'Meta API rejected the attachment',
      },
      created_at: newerTs,
      updated_at: newerTs,
    }

    renderWith(baseConversation, [inboundImage, outboundFile])

    expect(await screen.findByAltText('Attachment')).toHaveAttribute('src', 'https://cdn.example.com/inbound.png')
    expect(screen.getByText('catalog.pdf')).toBeInTheDocument()
    expect(screen.getByText('Download file')).toHaveAttribute('href', 'https://cdn.example.com/catalog.pdf')
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))

    await waitFor(() => {
      expect(apiClient.createMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        content: 'catalog.pdf',
        sender: 'agent',
        message_type: 'file',
        metadata: expect.objectContaining({
          file_name: 'catalog.pdf',
          file_url: 'https://cdn.example.com/catalog.pdf',
          delivery_status: 'pending',
        }),
      }))
    })
  })
})
