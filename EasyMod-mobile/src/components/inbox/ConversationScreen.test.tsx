import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ConversationScreen } from './ConversationScreen';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUseConversation = jest.fn();
const mockUseConversationMessages = jest.fn();
const mockMutateReply = jest.fn();
const mockMutateAiMode = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('@/hooks/useInbox', () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
  useConversationMessages: (...args: unknown[]) => mockUseConversationMessages(...args),
  useSendConversationReply: () => ({
    mutateAsync: mockMutateReply,
    isPending: false,
  }),
  useSetConversationAiMode: () => ({
    mutateAsync: mockMutateAiMode,
    isPending: false,
  }),
}));

jest.mock('@/hooks/useOrders', () => ({
  useCreateManualOrder: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

const mockConversation = {
  id: 'conv-1',
  customer_id: 'cust-1',
  customer: { id: 'cust-1', name: 'Tanvir Ahmed' },
  channel: 'messenger',
  status: 'active',
  hitl: false,
  needs_merchant_reply: true,
};

const mockMessages = [
  {
    id: 'msg-1',
    conversation_id: 'conv-1',
    content: 'Is this product available in size XL?',
    sender: 'customer',
    created_at: new Date().toISOString(),
  },
];

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');

  mockUseConversation.mockReturnValue({
    data: mockConversation,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });

  mockUseConversationMessages.mockReturnValue({
    data: { messages: mockMessages, suggestions: [], pagination: { total: 1, page: 1, limit: 25, totalPages: 1 } },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });
});

describe('ConversationScreen', () => {
  it('renders customer name, transcript messages, and interactive reply bar', () => {
    render(<ConversationScreen id="conv-1" />);

    expect(screen.getByText('Tanvir Ahmed')).toBeTruthy();
    expect(screen.getByText('Is this product available in size XL?')).toBeTruthy();
    expect(screen.getByTestId('mobile-conversation-reply-input')).toBeTruthy();
    expect(screen.getByTestId('mobile-conversation-send-btn')).toBeTruthy();
  });

  it('submits human reply and clears input upon clicking send', async () => {
    mockMutateReply.mockResolvedValueOnce({ message: { id: 'msg-2', content: 'Yes, XL is available!' } });

    render(<ConversationScreen id="conv-1" />);

    const input = screen.getByTestId('mobile-conversation-reply-input');
    const sendButton = screen.getByTestId('mobile-conversation-send-btn');

    fireEvent.changeText(input, 'Yes, XL is available!');
    fireEvent.press(sendButton);

    await waitFor(() => {
      expect(mockMutateReply).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          message: 'Yes, XL is available!',
        }),
      );
    });
  });

  it('toggles AI auto-reply pause and resume', async () => {
    mockMutateAiMode.mockResolvedValueOnce({ success: true, ai_mode: 'paused', conversation_id: 'conv-1' });

    render(<ConversationScreen id="conv-1" />);

    const aiToggle = screen.getByTestId('mobile-conversation-ai-toggle');
    expect(screen.getByText(i18n.t('mobile.inbox.detail.pauseAi'))).toBeTruthy();

    fireEvent.press(aiToggle);

    await waitFor(() => {
      expect(mockMutateAiMode).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        mode: 'pause',
      });
    });
  });

  it('displays error banner when reply fails with outside 24h window', async () => {
    mockMutateReply.mockRejectedValueOnce({
      code: 'OUTSIDE_24H_WINDOW',
      message: 'Outside 24-hour window',
    });

    render(<ConversationScreen id="conv-1" />);

    const input = screen.getByTestId('mobile-conversation-reply-input');
    const sendButton = screen.getByTestId('mobile-conversation-send-btn');

    fireEvent.changeText(input, 'Hello after 24h');
    fireEvent.press(sendButton);

    await waitFor(() => {
      expect(screen.getByText(i18n.t('mobile.inbox.detail.outside24h'))).toBeTruthy();
    });
  });
});
