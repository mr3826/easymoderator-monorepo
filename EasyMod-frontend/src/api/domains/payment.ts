/**
 * Payment Config API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { AxiosResponse } from 'axios';

export interface PaymentCredentialSummary {
  has_credentials: boolean;
  mfs_type: 'bkash' | 'nagad' | 'rocket' | null;
  mfs_mode: 'self' | 'business' | 'merchant' | null;
  mfs_number: string | null;
}

export interface PaymentConfig {
  id?: string;
  gateway: string;
  is_enabled: boolean;
  config?: Record<string, unknown>;
  credential_summary?: PaymentCredentialSummary;
  created_at?: string;
  updated_at?: string;
}

export type PaymentCredentials = Record<string, unknown>;

export async function getPaymentConfig(): Promise<{ success: boolean; data: PaymentConfig[] }> {
  const response: AxiosResponse<any> = await httpClient.get('/api/payment/config');
  return response.data;
}

export async function updatePaymentConfig(payload: {
  gateway: string;
  credentials?: PaymentCredentials | null;
  config?: Record<string, unknown>;
  is_enabled?: boolean;
}): Promise<{ success: boolean; data: any; message?: string }> {
  const response: AxiosResponse<any> = await httpClient.post('/api/payment/config', payload);
  return response.data;
}

export async function testPaymentConnection(payload: {
  gateway: string;
  credentials?: PaymentCredentials | null;
}): Promise<{ success: boolean; data: any; message?: string }> {
  const response: AxiosResponse<any> = await httpClient.post('/api/payment/config/test', payload);
  return response.data;
}

export async function deletePaymentConfig(gateway: string): Promise<{ success: boolean; message?: string }> {
  const response: AxiosResponse<any> = await httpClient.delete(`/api/payment/config/${gateway}`);
  return response.data;
}
