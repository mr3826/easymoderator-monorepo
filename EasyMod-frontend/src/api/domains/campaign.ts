/**
 * Campaign API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { Campaign, CampaignStats, CreateCampaignRequest } from '../types/campaign';
import type { AxiosResponse } from 'axios';

/**
 * Get all marketing campaigns
 * @returns Promise resolving to array of campaigns
 * @throws {Error} When campaign retrieval fails
 * @example
 * ```typescript
 * const campaigns = await getCampaigns();
 * console.log('Active campaigns:', campaigns.length);
 * ```
 */
export async function getCampaigns(): Promise<Campaign[]> {
  const response: AxiosResponse<ApiResponse<Campaign[]>> = await httpClient.get('/api/campaigns');
  return response.data.data;
}

/**
 * Get single campaign by ID
 * @param campaignId - Unique identifier of campaign to retrieve
 * @returns Promise resolving to campaign object
 * @throws {Error} When campaign not found or retrieval fails
 * @example
 * ```typescript
 * const campaign = await getCampaign('campaign123');
 * console.log(campaign.name);
 * ```
 */
export async function getCampaign(campaignId: string): Promise<Campaign> {
  const response: AxiosResponse<ApiResponse<Campaign>> = await httpClient.get(
    `/api/campaigns/${campaignId}`
  );
  return response.data.data;
}

/**
 * Create new marketing campaign
 * @param request - Campaign data including name, type, content, and scheduling
 * @returns Promise resolving to created campaign object
 * @throws {Error} When campaign creation fails due to validation or network issues
 * @example
 * ```typescript
 * const newCampaign = await createCampaign({ 
 *   name: 'Summer Sale', 
 *   type: 'email', 
 *   content: 'Get 20% off...' 
 * });
 * ```
 */
export async function createCampaign(request: CreateCampaignRequest): Promise<Campaign> {
  const response: AxiosResponse<ApiResponse<Campaign>> = await httpClient.post('/api/campaigns', request);
  return response.data.data;
}

/**
 * Update existing campaign
 * @param campaignId - ID of campaign to update
 * @param updates - Partial campaign data with fields to update
 * @returns Promise resolving to updated campaign object
 * @throws {Error} When campaign update fails due to invalid ID or permissions
 * @example
 * ```typescript
 * const updated = await updateCampaign('campaign123', { name: 'Updated Name' });
 * ```
 */
export async function updateCampaign(
  campaignId: string,
  updates: Partial<Campaign>
): Promise<Campaign> {
  const response: AxiosResponse<ApiResponse<Campaign>> = await httpClient.patch(
    `/api/campaigns/${campaignId}`,
    updates
  );
  return response.data.data;
}

/**
 * Delete existing campaign
 * @param campaignId - ID of campaign to delete
 * @returns Promise resolving to void
 * @throws {Error} When campaign deletion fails
 * @example
 * ```typescript
 * await deleteCampaign('campaign123');
 * ```
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  await httpClient.delete(`/api/campaigns/${campaignId}`);
}

/**
 * Schedule campaign for future delivery
 * @param campaignId - ID of campaign to schedule
 * @param scheduledTime - ISO datetime string when campaign should be sent
 * @returns Promise resolving to scheduled campaign object
 * @throws {Error} When campaign scheduling fails
 * @example
 * ```typescript
 * const scheduled = await scheduleCampaign('campaign123', '2024-07-15T10:00:00Z');
 * console.log('Scheduled for:', scheduled.scheduledTime);
 * ```
 */
export async function scheduleCampaign(
  campaignId: string,
  scheduledTime: string
): Promise<Campaign> {
  const response: AxiosResponse<ApiResponse<Campaign>> = await httpClient.post(
    `/api/campaigns/${campaignId}/schedule`,
    { scheduledTime }
  );
  return response.data.data;
}

/**
 * Launch campaign immediately
 * @param campaignId - ID of campaign to launch
 * @returns Promise resolving to launched campaign object
 * @throws {Error} When campaign launch fails
 * @example
 * ```typescript
 * const launched = await launchCampaign('campaign123');
 * console.log('Campaign status:', launched.status);
 * ```
 */
export async function launchCampaign(campaignId: string): Promise<Campaign> {
  const response: AxiosResponse<ApiResponse<Campaign>> = await httpClient.post(
    `/api/campaigns/${campaignId}/launch`
  );
  return response.data.data;
}

/**
 * Get campaign performance statistics
 * @param campaignId - ID of campaign to get stats for
 * @returns Promise resolving to campaign statistics object
 * @throws {Error} When campaign stats retrieval fails
 * @example
 * ```typescript
 * const stats = await getCampaignStats('campaign123');
 * console.log('Open rate:', stats.openRate);
 * ```
 */
export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const response: AxiosResponse<ApiResponse<CampaignStats>> = await httpClient.get(
    `/api/campaigns/${campaignId}/stats`
  );
  return response.data.data;
}


