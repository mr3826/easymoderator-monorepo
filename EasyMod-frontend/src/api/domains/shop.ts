/**
 * Shop API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ShopAISettings } from '../types/dashboard';
import { normalizeAiReplyMode, type AiReplyMode } from '../types/conversation';
import type { AxiosResponse } from 'axios';

type NormalizedShopAISettings = Omit<ShopAISettings, 'automation_mode'> & {
  automation_mode: AiReplyMode;
};

function normalizeShopAISettings(
  settings: ShopAISettings | null | undefined
): NormalizedShopAISettings {
  return {
    ...(settings ?? {}),
    automation_mode: normalizeAiReplyMode(settings?.automation_mode),
  } as NormalizedShopAISettings;
}

export async function getShopBusinessInfo(): Promise<{ businessInfo: any; shop: any }> {
  const response: AxiosResponse<any> = await httpClient.get('/api/shop/business-info');
  return response.data.data;
}

export async function updateShopBusinessInfo(data: any): Promise<any> {
  const response: AxiosResponse<any> = await httpClient.put('/api/shop/business-info', data);
  return response.data.data;
}

export async function getShopAISettings(): Promise<NormalizedShopAISettings> {
  const response: AxiosResponse<any> = await httpClient.get('/api/shop/ai-settings');
  return normalizeShopAISettings(response.data.data);
}

export async function updateShopAISettings(data: ShopAISettings): Promise<NormalizedShopAISettings> {
  const response: AxiosResponse<any> = await httpClient.put('/api/shop/ai-settings', data);
  return normalizeShopAISettings(response.data.data);
}

export async function getShop(): Promise<{ success: boolean; data: any }> {
  const response: AxiosResponse<any> = await httpClient.get('/api/shop/me');
  return response.data;
}

export async function updateShop(shopId: string, data: any): Promise<any> {
  const response: AxiosResponse<any> = await httpClient.post('/api/shop/update', { shopId, ...data });
  return response.data.data;
}
