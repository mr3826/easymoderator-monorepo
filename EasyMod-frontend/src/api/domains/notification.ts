import { httpClient } from '@/shared/lib/http/client';
import type { AxiosResponse } from 'axios';
import type { OwnerNotification, TelegramNotificationStatus } from '../types/notification';

export async function getTelegramNotificationStatus(): Promise<TelegramNotificationStatus> {
  const response: AxiosResponse<{ success: boolean; data: TelegramNotificationStatus }> =
    await httpClient.get('/api/notifications/telegram');
  return response.data.data;
}

export async function createTelegramConnectIntent(): Promise<TelegramNotificationStatus> {
  const response: AxiosResponse<{ success: boolean; data: TelegramNotificationStatus }> =
    await httpClient.post('/api/notifications/telegram/connect-intent', {});
  return response.data.data;
}

export async function sendTelegramTestAlert(): Promise<{ sent: boolean; [key: string]: unknown }> {
  const response: AxiosResponse<{ success: boolean; data: { sent: boolean; [key: string]: unknown } }> =
    await httpClient.post('/api/notifications/telegram/test', {});
  return response.data.data;
}

export async function updateTelegramPreferences(preferences: Record<string, boolean>): Promise<TelegramNotificationStatus> {
  const response: AxiosResponse<{ success: boolean; data: TelegramNotificationStatus }> =
    await httpClient.patch('/api/notifications/telegram/preferences', { preferences });
  return response.data.data;
}

export async function disconnectTelegramAlerts(): Promise<TelegramNotificationStatus | null> {
  const response: AxiosResponse<{ success: boolean; data: { status?: TelegramNotificationStatus } }> =
    await httpClient.delete('/api/notifications/telegram');
  return response.data.data?.status || null;
}

export async function getInAppNotifications(limit = 20): Promise<OwnerNotification[]> {
  const response: AxiosResponse<{ success: boolean; data: OwnerNotification[] }> =
    await httpClient.get('/api/notifications/in-app', { params: { limit } });
  return response.data.data || [];
}

export async function markInAppNotificationRead(id: string): Promise<void> {
  await httpClient.patch(`/api/notifications/in-app/${id}/read`, {});
}
