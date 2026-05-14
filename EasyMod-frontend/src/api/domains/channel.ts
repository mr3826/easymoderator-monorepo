/**
 * Channel & Integration API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type {
  Channel,
  OAuthCallbackResult,
  PipelineTestResult,
  WebhookSubscriptionResult,
} from '../types/channel';
import type { AxiosResponse } from 'axios';

/**
 * Get all communication channels
 * @returns Promise resolving to array of channels
 * @throws {Error} When channel retrieval fails
 * @example
 * ```typescript
 * const channels = await getChannels();
 * console.log('Available channels:', channels.length);
 * ```
 */
export async function getChannels(): Promise<Channel[]> {
  const response: AxiosResponse<ApiResponse<Channel[]>> = await httpClient.get('/api/channel');
  return response.data.data;
}

/**
 * Get single channel by ID
 * @param channelId - Unique identifier of channel to retrieve
 * @returns Promise resolving to channel object
 * @throws {Error} When channel not found or retrieval fails
 * @example
 * ```typescript
 * const channel = await getChannel('channel123');
 * console.log(channel.name);
 * ```
 */
export async function getChannel(channelId: string): Promise<Channel> {
  const response: AxiosResponse<ApiResponse<Channel>> = await httpClient.get(
    `/api/channel/${channelId}`
  );
  return response.data.data;
}

/**
 * Create new communication channel
 * @param channel - Channel data without id, created_at, and updated_at
 * @returns Promise resolving to created channel object
 * @throws {Error} When channel creation fails due to validation or network issues
 * @example
 * ```typescript
 * const newChannel = await createChannel({ 
 *   name: 'WhatsApp', 
 *   type: 'messaging',
 *   config: { phone: '+1234567890' }
 * });
 * ```
 */
export async function createChannel(
  channel: Omit<Channel, 'id' | 'created_at' | 'updated_at'>
): Promise<Channel> {
  const response: AxiosResponse<ApiResponse<Channel>> = await httpClient.post('/api/channel', channel);
  return response.data.data;
}

/**
 * Update existing channel
 * @param channelId - ID of channel to update
 * @param updates - Partial channel data with fields to update
 * @returns Promise resolving to updated channel object
 * @throws {Error} When channel update fails due to invalid ID or permissions
 * @example
 * ```typescript
 * const updated = await updateChannel('channel123', { name: 'Updated Name' });
 * ```
 */
export async function updateChannel(
  channelId: string,
  updates: Partial<Channel>
): Promise<Channel> {
  const response: AxiosResponse<ApiResponse<Channel>> = await httpClient.patch(
    `/api/channel/${channelId}`,
    updates
  );
  return response.data.data;
}

/**
 * Delete channel by ID
 * @param channelId - ID of channel to delete
 * @returns Promise resolving to deletion message
 * @throws {Error} When channel deletion fails due to invalid ID or permissions
 * @example
 * ```typescript
 * const result = await deleteChannel('channel123');
 * console.log(result.message);
 * ```
 */
export async function deleteChannel(channelId: string): Promise<{ message: string }> {
  const response: AxiosResponse<ApiResponse<{ message: string }>> = await httpClient.delete(
    `/api/channel/${channelId}`
  );
  return response.data.data ?? { message: 'Channel deleted' };
}

/**
 * Initiate OAuth flow for channel connection
 * @param channelType - Type of channel to connect ('facebook' | 'instagram')
 * @returns Promise resolving to OAuth redirect URL and state token
 * @throws {Error} When OAuth initiation fails
 * @example
 * ```typescript
 * const oauth = await initiateOAuth('facebook');
 * window.location.href = oauth.redirectUrl;
 * ```
 */
export async function initiateOAuth(
  channelType: 'facebook' | 'instagram'
): Promise<{ redirectUrl: string; state: string }> {
  const response: AxiosResponse<ApiResponse<{ redirectUrl: string; state: string }>> =
    await httpClient.post('/api/channel/oauth/initiate', { channelType });
  return response.data.data;
}

/**
 * Handle OAuth callback after user authorization
 * @param code - OAuth authorization code from callback
 * @param state - OAuth state token from callback
 * @param channelType - Type of channel being connected
 * @returns Promise resolving to OAuth connection result
 * @throws {Error} When OAuth callback handling fails
 * @example
 * ```typescript
 * const result = await handleOAuthCallback('abc123', 'state456', 'facebook');
 * console.log('Connected:', result.success);
 * ```
 */
export async function handleOAuthCallback(
  code: string,
  state: string,
  channelType: 'facebook' | 'instagram'
): Promise<OAuthCallbackResult> {
  const response: AxiosResponse<ApiResponse<OAuthCallbackResult>> = await httpClient.post(
    '/api/channel/oauth/callback',
    { code, state, channelType }
  );
  return response.data.data;
}

/**
 * Connect OAuth page to channel
 * @param pageId - Facebook/Instagram page ID
 * @param pageName - Display name for the page
 * @param tempToken - Temporary OAuth token
 * @param channelType - Type of channel being connected
 * @returns Promise resolving to connected channel object
 * @throws {Error} When page connection fails
 * @example
 * ```typescript
 * const channel = await connectOAuthPage('page123', 'My Business', 'token456', 'facebook');
 * console.log('Connected:', channel.name);
 * ```
 */
export async function connectOAuthPage(
  pageId: string,
  pageName: string,
  tempToken: string,
  channelType: 'facebook' | 'instagram'
): Promise<Channel> {
  const response: AxiosResponse<ApiResponse<Channel>> = await httpClient.post(
    '/api/channel/oauth/connect-page',
    { pageId, pageName, tempToken, channelType }
  );
  return response.data.data;
}

/**
 * Disconnect channel
 * @param channelId - ID of channel to disconnect
 * @returns Promise resolving to disconnected channel object
 * @throws {Error} When channel disconnection fails
 * @example
 * ```typescript
 * const channel = await disconnectChannel('channel123');
 * console.log('Disconnected:', channel.name);
 * ```
 */
export async function disconnectChannel(channelId: string): Promise<Channel> {
  const response: AxiosResponse<ApiResponse<Channel>> = await httpClient.post(
    `/api/channel/${channelId}/disconnect`
  );
  return response.data.data;
}

/**
 * Test channel pipeline functionality
 * @param channelId - ID of channel to test
 * @returns Promise resolving to pipeline test results
 * @throws {Error} When pipeline test fails
 * @example
 * ```typescript
 * const test = await testChannelPipeline('channel123');
 * console.log('Test passed:', test.success);
 * ```
 */
export async function testChannelPipeline(channelId: string): Promise<PipelineTestResult> {
  const response: AxiosResponse<ApiResponse<PipelineTestResult>> = await httpClient.post(
    `/api/channel/${channelId}/test-pipeline`
  );
  return response.data.data;
}

/**
 * Subscribe to channel webhooks for real-time updates
 * @param channelId - ID of channel to subscribe webhooks for
 * @returns Promise resolving to webhook subscription result
 * @throws {Error} When webhook subscription fails
 * @example
 * ```typescript
 * const subscription = await subscribeChannelWebhooks('channel123');
 * console.log('Subscribed:', subscription.success);
 * ```
 */
export async function subscribeChannelWebhooks(
  channelId: string
): Promise<WebhookSubscriptionResult> {
  const response: AxiosResponse<ApiResponse<WebhookSubscriptionResult>> = await httpClient.post(
    `/api/channel/${channelId}/subscribe-webhooks`
  );
  return response.data.data;
}

