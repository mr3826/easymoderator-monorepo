/**
 * Shop API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ShopAISettings } from '../types/dashboard';
import type { AxiosResponse } from 'axios';

export interface OnboardingStatus {
  completed: boolean;
  can_complete: boolean;
  checks: {
    facebook_connected: boolean;
    business_info_added: boolean;
    knowledge_added: boolean;
    assistant_test_completed: boolean;
  };
  missing: string[];
  counts: {
    connected_facebook_pages: number;
    active_products: number;
    active_faqs: number;
    ai_messages: number;
  };
}

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
  const response: AxiosResponse<any> = await httpClient.post('/api/shop/update', { shopId, ...data });
  return response.data.data;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const response: AxiosResponse<any> = await httpClient.get('/api/shop/onboarding/status');
  return response.data.data;
}

export async function completeOnboarding(): Promise<OnboardingStatus> {
  const response: AxiosResponse<any> = await httpClient.post('/api/shop/onboarding/complete');
  return response.data.data;
}
