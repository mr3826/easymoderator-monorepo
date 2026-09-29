import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { InboxScreen } from './InboxScreen';
import i18n from '@/i18n';

const mockUser: { shopId: string | null } = { shopId: 'shop-1' };
const mockUseInboxConversations = jest.fn();
const mockUseNetworkStatus = jest.fn(() => true);
const mockPush = jest.fn();

jest.mock('@/hooks/useInbox', () => ({
  useInboxConversations: (...args: unknown[]) => mockUseInboxConversations(...args),
}));
jest.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => mockUseNetworkStatus() }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const conversation = {
  id: 'conversation-1',
  channel: 'facebook',
  status: 'active',
  hitl: false,
  unreadCount: 2,
  customer: { id: 'customer-1', name: 'Pilot Customer' },
  title: 'Pilot Customer',
  lastMessage: 'I want to order this today',
  needs_merchant_reply: true,
};

function readyQuery() {
  return {
    data: { pages: [{ conversations: [conversation], pagination: { total: 1, page: 1, limit: 25, totalPages: 1 } }] },
    isPending: false,
    isError: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
  };
}

beforeEach(() => {
  mockUseInboxConversations.mockReset();
  mockUseInboxConversations.mockReturnValue(readyQuery());
  mockUseNetworkStatus.mockReturnValue(true);
  mockPush.mockReset();
  mockUser.shopId = 'shop-1';
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  await i18n.changeLanguage('bn');
});

describe('InboxScreen', () => {
  it('renders a shop-scoped conversation and navigates to its transcript', () => {
    render(<InboxScreen />);

    expect(screen.getByText('Pilot Customer')).toBeTruthy();
    expect(screen.getByText('I want to order this today')).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.inbox.needsReply'))).toBeTruthy();

    fireEvent.press(screen.getByTestId('mobile-conversation-conversation-1'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/conversation-detail/[id]',
      params: { id: 'conversation-1' },
    });
  });

  it('filters Needs Me and unread conversations without mutating server data', () => {
    render(<InboxScreen />);

    fireEvent.press(screen.getByTestId('mobile-inbox-filter-needs'));
    expect(screen.getByText('Pilot Customer')).toBeTruthy();

    fireEvent.press(screen.getByTestId('mobile-inbox-filter-unread'));
    expect(screen.getByText('Pilot Customer')).toBeTruthy();
    expect(mockUseInboxConversations).toHaveBeenCalledWith('active');
  });

  it('shows a no-shop state instead of an indefinite query spinner', () => {
    // The stable mock user is mutable only through the module-level object so the component keeps
    // the same AuthProvider shape as production while this test exercises the membership boundary.
    mockUser.shopId = null;
    render(<InboxScreen />);
    expect(screen.getByText(i18n.t('mobile.home.noShop.title'))).toBeTruthy();
    mockUser.shopId = 'shop-1';
  });

  it('shows an explicit offline state when there is no cached Inbox data', () => {
    mockUseNetworkStatus.mockReturnValue(false);
    mockUseInboxConversations.mockReturnValue({ ...readyQuery(), data: undefined, isPending: false });
    render(<InboxScreen />);
    expect(screen.getByText(i18n.t('mobile.inbox.offline.title'))).toBeTruthy();
  });
});
