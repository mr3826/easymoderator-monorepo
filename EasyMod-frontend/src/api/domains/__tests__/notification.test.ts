import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as notification from '../notification';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Notification Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads Telegram notification status', async () => {
    const data = { status: 'connected', connected: true, events: [] };
    (httpClient.get as any).mockResolvedValue({ data: { success: true, data } });

    const result = await notification.getTelegramNotificationStatus();

    expect(httpClient.get).toHaveBeenCalledWith('/api/notifications/telegram');
    expect(result.connected).toBe(true);
  });

  it('creates a Telegram connect intent', async () => {
    const data = { status: 'pending', pendingCommand: '/easymod_connect token' };
    (httpClient.post as any).mockResolvedValue({ data: { success: true, data } });

    const result = await notification.createTelegramConnectIntent();

    expect(httpClient.post).toHaveBeenCalledWith('/api/notifications/telegram/connect-intent', {});
    expect(result.pendingCommand).toContain('/easymod_connect');
  });

  it('updates Telegram event preferences', async () => {
    const preferences = { new_order: false };
    (httpClient.patch as any).mockResolvedValue({ data: { success: true, data: { preferences } } });

    await notification.updateTelegramPreferences(preferences);

    expect(httpClient.patch).toHaveBeenCalledWith('/api/notifications/telegram/preferences', { preferences });
  });

  it('loads and marks in-app notifications read', async () => {
    const data = [{ id: 'n-1', status: 'pending' }];
    (httpClient.get as any).mockResolvedValue({ data: { success: true, data } });
    (httpClient.patch as any).mockResolvedValue({ data: { success: true } });

    const result = await notification.getInAppNotifications(10);
    await notification.markInAppNotificationRead('n-1');

    expect(result).toHaveLength(1);
    expect(httpClient.get).toHaveBeenCalledWith('/api/notifications/in-app', { params: { limit: 10 } });
    expect(httpClient.patch).toHaveBeenCalledWith('/api/notifications/in-app/n-1/read', {});
  });
});
