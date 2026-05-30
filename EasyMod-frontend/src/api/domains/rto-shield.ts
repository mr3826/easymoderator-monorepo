/**
 * RTO Shield API Domain
 *
 * Cross-shop fake-order / return-to-origin (RTO) fraud network.
 * Backend: EasyMod-backend/src/modules/rto-shield
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { AxiosResponse } from 'axios';

export type RtoTier = 'block' | 'verify' | 'clear';

export interface RtoNetworkStats {
  shops_reported: number;
  total_attempts: number;
  total_rtos: number;
  rto_rate: number;
}

export interface RtoCheckResult {
  flagged: boolean;
  reason: string | null;
  risk_score: number;
  tier: RtoTier;
  entry: Record<string, unknown> | null;
  network: RtoNetworkStats | null;
}

export interface RtoNetworkSettings {
  /** This shop's delivery outcomes feed the shared network aggregate. */
  contribute: boolean;
  /** This shop's order flow honors global/network fraud signals (not only its own list). */
  enforce: boolean;
}

/** Check a phone against blacklist + cross-shop network signal. */
export async function checkPhone(phone: string): Promise<RtoCheckResult> {
  const response: AxiosResponse<ApiResponse<RtoCheckResult>> = await httpClient.post(
    '/api/rto-shield/check',
    { phone }
  );
  return response.data.data;
}

/** Cross-shop "fraud reach" for a phone (how many shops it has burned). */
export async function getNetworkStats(phone: string): Promise<RtoNetworkStats> {
  const response: AxiosResponse<ApiResponse<RtoNetworkStats>> = await httpClient.get(
    `/api/rto-shield/network-stats?phone=${encodeURIComponent(phone)}`
  );
  return response.data.data;
}

/** Appeal: vouch for a customer, clearing them for this shop only. */
export async function whitelistPhone(phone: string, notes?: string): Promise<void> {
  await httpClient.post('/api/rto-shield/whitelist', { phone, notes });
}

/** Read this shop's network participation settings. */
export async function getNetworkSettings(): Promise<RtoNetworkSettings> {
  const response: AxiosResponse<ApiResponse<RtoNetworkSettings>> = await httpClient.get(
    '/api/rto-shield/settings'
  );
  return response.data.data;
}

/** Update this shop's network participation settings. */
export async function updateNetworkSettings(
  updates: Partial<RtoNetworkSettings>
): Promise<RtoNetworkSettings> {
  const response: AxiosResponse<ApiResponse<RtoNetworkSettings>> = await httpClient.put(
    '/api/rto-shield/settings',
    updates
  );
  return response.data.data;
}
