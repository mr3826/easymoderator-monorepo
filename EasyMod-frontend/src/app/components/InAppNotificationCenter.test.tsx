import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import InAppNotificationCenter from './InAppNotificationCenter';
import type { OwnerNotification } from '@/api/types/notification';

const { mockGetInAppNotifications, mockMarkInAppNotificationRead, mockToastError } = vi.hoisted(() => ({
  mockGetInAppNotifications: vi.fn(),
  mockMarkInAppNotificationRead: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mockToastError },
}));

vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { Bell: Icon, CheckCircle2: Icon, Loader2: Icon };
});

vi.mock('@/api/domains/notification', () => ({
  getInAppNotifications: mockGetInAppNotifications,
  markInAppNotificationRead: mockMarkInAppNotificationRead,
}));

function notification(overrides: Partial<OwnerNotification> = {}): OwnerNotification {
  return {
    id: 'notification-1',
    shop_id: 'shop-1',
    type: 'escalation',
    customer_message: 'Customer needs help',
    customer_data: { title: 'Escalation' },
    status: 'pending',
    created_at: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

async function openPanel() {
  render(<InAppNotificationCenter />);
  fireEvent.click(screen.getByLabelText('Notifications'));
  await waitFor(() => expect(mockGetInAppNotifications).toHaveBeenCalled());
}

describe('InAppNotificationCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkInAppNotificationRead.mockResolvedValue(undefined);
  });

  it('marks an ordinary pending notification read', async () => {
    mockGetInAppNotifications.mockResolvedValue([notification()]);
    await openPanel();

    fireEvent.click(await screen.findByLabelText('Mark notification read'));

    await waitFor(() => expect(mockMarkInAppNotificationRead).toHaveBeenCalledWith('notification-1'));
    await waitFor(() => expect(screen.queryByLabelText('Mark notification read')).not.toBeInTheDocument());
  });

  it('never offers generic mark-read for a payment confirmation', async () => {
    mockGetInAppNotifications.mockResolvedValue([
      notification({ type: 'payment_confirmation', customer_data: { title: 'Payment', orderId: 'order-9' } }),
    ]);
    await openPanel();

    await screen.findByText('Payment');
    expect(screen.queryByLabelText('Mark notification read')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/orders?orderId=order-9',
    );
    expect(mockMarkInAppNotificationRead).not.toHaveBeenCalled();
  });

  it('surfaces a rejected mark-read instead of failing silently', async () => {
    mockGetInAppNotifications.mockResolvedValue([notification()]);
    mockMarkInAppNotificationRead.mockRejectedValue(new Error('Notification not found'));
    await openPanel();

    fireEvent.click(await screen.findByLabelText('Mark notification read'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Notification not found'));
    // Row stays pending and is resynced from the server rather than optimistically completed.
    expect(await screen.findByLabelText('Mark notification read')).toBeInTheDocument();
    expect(mockGetInAppNotifications).toHaveBeenCalledTimes(3);
  });
});
