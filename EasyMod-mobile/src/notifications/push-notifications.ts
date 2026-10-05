import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchTransport, type Transport } from '@/api/transport';
import { openDeepLink, type DeepLinkEntityKind } from '@/lib/deeplink';
import { capturePendingDeepLink } from '@/lib/pending-deeplink';

export const PUSH_SUBSCRIPTION_STORAGE_KEY = 'easymod_push_subscription_id';
export const PUSH_DEVICE_TOKEN_STORAGE_KEY = 'easymod_push_device_token';

export interface PushNotificationDeps {
  transport?: Transport;
  storage?: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  };
  notifications?: typeof Notifications;
}

// Global presentation configuration for foreground notifications
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Configure Android notification channels (high importance for urgent merchant alerts).
 */
export async function setupNotificationChannels(
  notifications: typeof Notifications = Notifications,
): Promise<void> {
  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync('default', {
      name: 'EasyMod Notifications',
      importance: notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10B981',
      enableLights: true,
      enableVibrate: true,
    });
  }
}

export type RegisterOutcome =
  | { ok: true; subscriptionId: string; deviceToken: string }
  | { ok: false; reason: 'platform_unsupported' | 'permission_denied' | 'token_error' | 'network_error' };

/**
 * Registers the device push token with the backend (ADR M-007).
 * Uses native FCM device token (getDevicePushTokenAsync), NOT the Expo relay token.
 */
export async function registerPushNotifications(
  deps: PushNotificationDeps = {},
): Promise<RegisterOutcome> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return { ok: false, reason: 'platform_unsupported' };
  }

  const notifications = deps.notifications ?? Notifications;
  const storage = deps.storage ?? AsyncStorage;
  const transport = deps.transport ?? fetchTransport;

  try {
    await setupNotificationChannels(notifications);

    const { status: existingStatus } = await notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return { ok: false, reason: 'permission_denied' };
    }

    const tokenResult = await notifications.getDevicePushTokenAsync();
    const deviceToken = typeof tokenResult.data === 'string' ? tokenResult.data : String(tokenResult.data);

    if (!deviceToken) {
      return { ok: false, reason: 'token_error' };
    }

    // Check if token changed or already registered
    const storedToken = await storage.getItem(PUSH_DEVICE_TOKEN_STORAGE_KEY);
    const storedId = await storage.getItem(PUSH_SUBSCRIPTION_STORAGE_KEY);

    if (storedToken === deviceToken && storedId) {
      return { ok: true, subscriptionId: storedId, deviceToken };
    }

    const res = await transport.request('/api/notifications/subscriptions', {
      method: 'POST',
      body: {
        type: 'fcm',
        device_token: deviceToken,
      },
    });

    if (!res.ok) {
      return { ok: false, reason: 'network_error' };
    }

    const responseBody = (await res.json()) as { success?: boolean; id?: string };
    const subscriptionId = responseBody?.id ?? '';

    if (subscriptionId) {
      await storage.setItem(PUSH_SUBSCRIPTION_STORAGE_KEY, subscriptionId);
      await storage.setItem(PUSH_DEVICE_TOKEN_STORAGE_KEY, deviceToken);
    }

    return { ok: true, subscriptionId, deviceToken };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

/**
 * Unregister push subscription on logout / session revocation (ADR M-007).
 */
export async function unregisterPushNotifications(
  deps: PushNotificationDeps = {},
): Promise<boolean> {
  const storage = deps.storage ?? AsyncStorage;
  const transport = deps.transport ?? fetchTransport;

  try {
    const subscriptionId = await storage.getItem(PUSH_SUBSCRIPTION_STORAGE_KEY);
    if (subscriptionId) {
      try {
        await transport.request(`/api/notifications/subscriptions/${subscriptionId}`, {
          method: 'DELETE',
        });
      } catch {
        // Opportunistic server cleanup; proceed to clean local state
      }
    }
    await storage.removeItem(PUSH_SUBSCRIPTION_STORAGE_KEY);
    await storage.removeItem(PUSH_DEVICE_TOKEN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses notification data payload and routes to the appropriate deep link (ADR M-007).
 */
export function handleNotificationPayload(
  data: Record<string, unknown> | undefined,
  signedIn: boolean,
): boolean {
  if (!data) return false;

  let entity = (data.entity as DeepLinkEntityKind) ||
    (data.orderId ? 'order' : data.conversationId ? 'conversation' : null);
  let id = (data.id as string) || (data.orderId as string) || (data.conversationId as string) || null;

  // Fallback: parse deepLink URL if entity or id are missing
  if ((!entity || !id) && typeof data.deepLink === 'string') {
    try {
      const match = data.deepLink.match(/(?:conversationId|orderId)=([^&#]+)/);
      if (match) {
        if (data.deepLink.includes('conversationId')) {
          entity = 'conversation';
          id = decodeURIComponent(match[1]);
        } else if (data.deepLink.includes('orderId')) {
          entity = 'order';
          id = decodeURIComponent(match[1]);
        }
      } else {
        const pathMatch = data.deepLink.match(/\/(order|conversation)\/([^/?#]+)/);
        if (pathMatch) {
          entity = pathMatch[1] as DeepLinkEntityKind;
          id = decodeURIComponent(pathMatch[2]);
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  if (!entity || !id || (entity !== 'order' && entity !== 'conversation')) {
    return false;
  }

  if (signedIn) {
    return openDeepLink(entity, String(id));
  } else {
    capturePendingDeepLink({ kind: entity, id: String(id) });
    return true;
  }
}

/**
 * Sets up listeners for user tapping on notifications (in-foreground or cold-start).
 */
export function setupNotificationResponseListener(
  isSignedIn: () => boolean,
  notifications: typeof Notifications = Notifications,
): () => void {
  if (Platform.OS === 'web') {
    return () => {};
  }

  // Check if app was opened by a notification tap from cold-start
  void notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      handleNotificationPayload(data, isSignedIn());
    }
  });

  // Listen for notification taps while app is running in background/foreground
  const subscription = notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined;
    handleNotificationPayload(data, isSignedIn());
  });

  return () => {
    subscription.remove();
  };
}
