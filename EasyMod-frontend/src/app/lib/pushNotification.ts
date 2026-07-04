/**
 * Push Notification Service (Web Push / VAPID)
 *
 * Usage:
 *   import { subscribeToPush, unsubscribeFromPush } from './pushNotification';
 *   await subscribeToPush();
 */

import { httpClient } from '@/shared/lib/http/client';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
const SW_PATH = '/sw.js';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Register the service worker. Called once on app startup.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH);
    return reg;
  } catch {
    return null;
  }
}

/**
 * Request notification permission and subscribe to web push.
 * POSTs the subscription to the backend for the given shop.
 */
export async function subscribeToPush(_shopId?: string, accessToken?: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (!VAPID_PUBLIC_KEY) {
    console.warn('VITE_VAPID_PUBLIC_KEY not set — push disabled');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });

  const res = await httpClient.post(
    '/api/notifications/subscriptions',
    {
      type: 'web',
      subscription_json: subscription.toJSON()
    },
    accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
  );

  return Boolean(res.data?.success);
}

/**
 * Unsubscribe from web push and remove the subscription from the backend.
 */
export async function unsubscribeFromPush(subscriptionId: string, accessToken: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();

  await httpClient.delete(
    `/api/notifications/subscriptions/${subscriptionId}`,
    accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
  );
}

/**
 * Get current push permission status.
 */
export function getPushPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
