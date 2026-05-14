/**
 * Payment Config API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { AxiosResponse } from 'axios';

export async function getPaymentConfig(): Promise<{ success: boolean; data: any[] }> {
  const response: AxiosResponse<any> = await httpClient.get('/api/payment/config');
  return response.data;
}

export async function updatePaymentConfig(payload: {
  gateway: string;
  credentials?: any;
  config?: any;
  is_enabled?: boolean;
}): Promise<{ success: boolean; data: any; message?: string }> {
  const response: AxiosResponse<any> = await httpClient.post('/api/payment/config', payload);
  return response.data;
}

export async function testPaymentConnection(payload: {
  gateway: string;
  credentials?: any;
}): Promise<{ success: boolean; data: any; message?: string }> {
  const response: AxiosResponse<any> = await httpClient.post('/api/payment/config/test', payload);
  return response.data;
}

export async function deletePaymentConfig(gateway: string): Promise<{ success: boolean; message?: string }> {
  const response: AxiosResponse<any> = await httpClient.delete(`/api/payment/config/${gateway}`);
  return response.data;
}
