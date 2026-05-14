/**
 * Shop API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ShopAISettings } from '../types/dashboard';
import type { AxiosResponse } from 'axios';

export async function getShopBusinessInfo(): Promise<{ businessInfo: any; shop: any }> {
  const response: AxiosResponse<any> = await httpClient.get('/api/shop/business-info');
  return response.data.data;
}

export async function updateShopBusinessInfo(data: any): Promise<any> {
  const response: AxiosResponse<any> = await httpClient.put('/api/shop/business-info', data);
  return response.data.data;
}

export async function getShopAISettings(): Promise<ShopAISettings> {
  const response: AxiosResponse<any> = await httpClient.get('/api/shop/ai-settings');
  return response.data.data;
}

export async function updateShopAISettings(data: ShopAISettings): Promise<ShopAISettings> {
  const response: AxiosResponse<any> = await httpClient.put('/api/shop/ai-settings', data);
  return response.data.data;
}

export async function getShop(): Promise<{ success: boolean; data: any }> {
  const response: AxiosResponse<any> = await httpClient.get('/api/shop/me');
  return response.data;
}

export async function updateShop(shopId: string, data: any): Promise<any> {
  const response: AxiosResponse<any> = await httpClient.post('/api/shop/update', { id: shopId, ...data });
  return response.data.data;
}
