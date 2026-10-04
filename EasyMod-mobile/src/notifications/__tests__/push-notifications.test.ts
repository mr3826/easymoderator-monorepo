import { Platform } from 'react-native';
import {
  registerPushNotifications,
  unregisterPushNotifications,
  handleNotificationPayload,
  setupNotificationChannels,
  PUSH_SUBSCRIPTION_STORAGE_KEY,
  PUSH_DEVICE_TOKEN_STORAGE_KEY,
} from '../push-notifications';
import * as deeplink from '@/lib/deeplink';
import * as pendingDeeplink from '@/lib/pending-deeplink';

jest.mock('@/lib/deeplink', () => ({
  openDeepLink: jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/pending-deeplink', () => ({
  capturePendingDeepLink: jest.fn(),
}));

describe('push-notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'android';
  });

  describe('setupNotificationChannels', () => {
    it('configures default notification channel on Android', async () => {
      const mockNotifications = {
        setNotificationChannelAsync: jest.fn().mockResolvedValue({}),
        AndroidImportance: { MAX: 5 },
      } as any;

      await setupNotificationChannels(mockNotifications);

      expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.objectContaining({
        name: 'EasyMod Notifications',
        importance: 5,
        enableVibrate: true,
      }));
    });
  });

  describe('registerPushNotifications', () => {
    it('returns permission_denied when permissions are rejected', async () => {
      const mockNotifications = {
        setNotificationChannelAsync: jest.fn().mockResolvedValue({}),
        getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
        requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
        AndroidImportance: { MAX: 5 },
      } as any;

      const result = await registerPushNotifications({
        notifications: mockNotifications,
      });

      expect(result).toEqual({ ok: false, reason: 'permission_denied' });
    });

    it('requests native FCM device token and registers with backend', async () => {
      const storageState = new Map<string, string>();
      const mockStorage = {
        getItem: jest.fn(async (key: string) => storageState.get(key) ?? null),
        setItem: jest.fn(async (key: string, val: string) => { storageState.set(key, val); }),
        removeItem: jest.fn(async (key: string) => { storageState.delete(key); }),
      };

      const mockTransport = {
        request: jest.fn().mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({ success: true, id: 'sub-fcm-123' }),
        }),
      };

      const mockNotifications = {
        setNotificationChannelAsync: jest.fn().mockResolvedValue({}),
        getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
        getDevicePushTokenAsync: jest.fn().mockResolvedValue({ data: 'mock-fcm-token-abc' }),
        AndroidImportance: { MAX: 5 },
      } as any;

      const result = await registerPushNotifications({
        notifications: mockNotifications,
        storage: mockStorage,
        transport: mockTransport as any,
      });

      expect(result).toEqual({
        ok: true,
        subscriptionId: 'sub-fcm-123',
        deviceToken: 'mock-fcm-token-abc',
      });

      expect(mockTransport.request).toHaveBeenCalledWith('/api/notifications/subscriptions', {
        method: 'POST',
        body: {
          type: 'fcm',
          device_token: 'mock-fcm-token-abc',
        },
      });

      expect(mockStorage.setItem).toHaveBeenCalledWith(PUSH_SUBSCRIPTION_STORAGE_KEY, 'sub-fcm-123');
      expect(mockStorage.setItem).toHaveBeenCalledWith(PUSH_DEVICE_TOKEN_STORAGE_KEY, 'mock-fcm-token-abc');
    });

    it('reuses existing registration if token and subscription ID are unchanged', async () => {
      const storageState = new Map<string, string>([
        [PUSH_SUBSCRIPTION_STORAGE_KEY, 'existing-sub-id'],
        [PUSH_DEVICE_TOKEN_STORAGE_KEY, 'mock-fcm-token-abc'],
      ]);
      const mockStorage = {
        getItem: jest.fn(async (key: string) => storageState.get(key) ?? null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };
      const mockTransport = { request: jest.fn() };
      const mockNotifications = {
        setNotificationChannelAsync: jest.fn().mockResolvedValue({}),
        getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
        getDevicePushTokenAsync: jest.fn().mockResolvedValue({ data: 'mock-fcm-token-abc' }),
        AndroidImportance: { MAX: 5 },
      } as any;

      const result = await registerPushNotifications({
        notifications: mockNotifications,
        storage: mockStorage,
        transport: mockTransport as any,
      });

      expect(result).toEqual({
        ok: true,
        subscriptionId: 'existing-sub-id',
        deviceToken: 'mock-fcm-token-abc',
      });
      expect(mockTransport.request).not.toHaveBeenCalled();
    });
  });

  describe('unregisterPushNotifications', () => {
    it('deletes subscription on backend and purges local storage', async () => {
      const storageState = new Map<string, string>([
        [PUSH_SUBSCRIPTION_STORAGE_KEY, 'sub-to-delete'],
        [PUSH_DEVICE_TOKEN_STORAGE_KEY, 'fcm-token-1'],
      ]);
      const mockStorage = {
        getItem: jest.fn(async (key: string) => storageState.get(key) ?? null),
        setItem: jest.fn(),
        removeItem: jest.fn(async (key: string) => { storageState.delete(key); }),
      };

      const mockTransport = {
        request: jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }),
      };

      const success = await unregisterPushNotifications({
        storage: mockStorage,
        transport: mockTransport as any,
      });

      expect(success).toBe(true);
      expect(mockTransport.request).toHaveBeenCalledWith('/api/notifications/subscriptions/sub-to-delete', {
        method: 'DELETE',
      });
      expect(mockStorage.removeItem).toHaveBeenCalledWith(PUSH_SUBSCRIPTION_STORAGE_KEY);
      expect(mockStorage.removeItem).toHaveBeenCalledWith(PUSH_DEVICE_TOKEN_STORAGE_KEY);
    });
  });

  describe('handleNotificationPayload', () => {
    it('opens deep link directly when user is signed in', () => {
      const handled = handleNotificationPayload({ entity: 'order', id: 'ord-456' }, true);
      expect(handled).toBe(true);
      expect(deeplink.openDeepLink).toHaveBeenCalledWith('order', 'ord-456');
    });

    it('parks deep link when user is signed out', () => {
      const handled = handleNotificationPayload({ entity: 'conversation', id: 'conv-789' }, false);
      expect(handled).toBe(true);
      expect(pendingDeeplink.capturePendingDeepLink).toHaveBeenCalledWith({ kind: 'conversation', id: 'conv-789' });
    });

    it('parses orderId or conversationId fallbacks correctly', () => {
      const handledOrder = handleNotificationPayload({ orderId: 'ord-fallback' }, true);
      expect(handledOrder).toBe(true);
      expect(deeplink.openDeepLink).toHaveBeenCalledWith('order', 'ord-fallback');

      const handledConv = handleNotificationPayload({ conversationId: 'conv-fallback' }, true);
      expect(handledConv).toBe(true);
      expect(deeplink.openDeepLink).toHaveBeenCalledWith('conversation', 'conv-fallback');
    });

    it('extracts entity and id from deepLink web URL fallback', () => {
      const handledWebInbox = handleNotificationPayload({
        deepLink: 'https://app.easymod.tech/inbox?conversationId=conv-url-123',
      }, true);
      expect(handledWebInbox).toBe(true);
      expect(deeplink.openDeepLink).toHaveBeenCalledWith('conversation', 'conv-url-123');

      const handledWebOrder = handleNotificationPayload({
        deepLink: 'https://app.easymod.tech/orders?orderId=ord-url-456',
      }, true);
      expect(handledWebOrder).toBe(true);
      expect(deeplink.openDeepLink).toHaveBeenCalledWith('order', 'ord-url-456');

      const handledPathOrder = handleNotificationPayload({
        deepLink: 'easymodmerchant://order/ord-path-789',
      }, true);
      expect(handledPathOrder).toBe(true);
      expect(deeplink.openDeepLink).toHaveBeenCalledWith('order', 'ord-path-789');
    });

    it('ignores empty or unknown entity types', () => {
      expect(handleNotificationPayload(undefined, true)).toBe(false);
      expect(handleNotificationPayload({}, true)).toBe(false);
      expect(handleNotificationPayload({ entity: 'unknown', id: '123' }, true)).toBe(false);
    });
  });
});
