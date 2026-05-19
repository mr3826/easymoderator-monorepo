/**
 * Phase 2 — Canonical Meta channel API client.
 *
 * Talks to the new /api/channels/meta surface backed by the meta_channels
 * table (single source of truth). The legacy /api/channel/* client in
 * channel.ts still works during the dual-write window and remains the
 * default until the Channels UI flips its feature flag.
 *
 * Surface:
 *   listMetaChannels()                         — GET    /api/channels/meta
 *   initiateMetaOAuth(platform)                — POST   /api/channels/meta/oauth/initiate
 *   handleMetaOAuthCallback(code, state)       — POST   /api/channels/meta/oauth/callback
 *   connectMetaAsset({assetId, displayName, tempToken})
 *                                              — POST   /api/channels/meta/oauth/connect-asset
 *   disconnectMetaChannel(channelId)           — POST   /api/channels/meta/:id/disconnect
 *   reconnectMetaChannel(channelId)            — POST   /api/channels/meta/:id/reconnect
 *   pingMetaChannel(channelId)                 — POST   /api/channels/meta/:id/test-webhook
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { AxiosResponse } from 'axios';

export type MetaPlatform = 'facebook' | 'instagram';

export type MetaChannelStatus =
  | 'CONNECTED'
  | 'TOKEN_EXPIRED'
  | 'REVOKED'
  | 'DISCONNECTED'
  | 'ERROR';

export interface MetaChannel {
  id: string;
  shopId: string;
  platform: MetaPlatform;
  metaAssetId: string;
  displayName: string;
  pictureUrl: string | null;
  linkedFbPageId: string | null;
  status: MetaChannelStatus;
  lastError: string | null;
  tokenExpiresAt: string | null;
  tokenLastRefreshedAt: string | null;
  webhookSubscribedFields: string[];
  webhookLastVerifiedAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MetaOAuthAsset {
  id: string;
  name: string;
  category: string | null;
  pictureUrl: string | null;
  instagramAccount: {
    id: string;
    name: string;
    username: string;
  } | null;
}

export interface MetaOAuthCallbackResult {
  pages: MetaOAuthAsset[];
  tempToken: string;
}

export interface MetaConnectAssetResult extends MetaChannel {
  webhookSubscribed: boolean;
  webhookWarning: string | null;
}

export interface MetaReconnectResult {
  redirectUrl: string;
  state: string;
  channelId: string;
  platform: MetaPlatform;
}

export interface MetaChannelPingResult {
  channelId: string;
  platform: MetaPlatform;
  ping: { ok: boolean; latencyMs?: number; error?: string };
  checkedAt: string;
}

export type MetaConsentEventType =
  | 'OPT_IN_IMPLICIT'
  | 'OPT_IN_EXPLICIT'
  | 'OPT_OUT'
  | 'DEAUTHORIZED'
  | 'DATA_DELETED';

export interface MetaConsentEvent {
  id: string;
  event: MetaConsentEventType;
  source: string;
  customerId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MetaChannelConsentSummary {
  channelId: string;
  counts: {
    optIns: number;
    optOuts: number;
    deauthorized: number;
    dataDeleted: number;
  };
  recentEvents: MetaConsentEvent[];
}

const BASE = '/api/channels/meta';

export async function listMetaChannels(): Promise<MetaChannel[]> {
  const res: AxiosResponse<ApiResponse<MetaChannel[]>> = await httpClient.get(BASE);
  return res.data.data;
}

export async function initiateMetaOAuth(
  platform: MetaPlatform,
): Promise<{ redirectUrl: string; state: string }> {
  const res: AxiosResponse<ApiResponse<{ redirectUrl: string; state: string }>> =
    await httpClient.post(`${BASE}/oauth/initiate`, { platform });
  return res.data.data;
}

export async function handleMetaOAuthCallback(
  code: string,
  state: string,
): Promise<MetaOAuthCallbackResult> {
  const res: AxiosResponse<ApiResponse<MetaOAuthCallbackResult>> = await httpClient.post(
    `${BASE}/oauth/callback`,
    { code, state },
  );
  return res.data.data;
}

export async function connectMetaAsset(input: {
  assetId: string;
  displayName: string;
  tempToken: string;
}): Promise<MetaConnectAssetResult> {
  const res: AxiosResponse<ApiResponse<MetaConnectAssetResult>> = await httpClient.post(
    `${BASE}/oauth/connect-asset`,
    input,
  );
  return res.data.data;
}

export async function disconnectMetaChannel(channelId: string): Promise<MetaChannel> {
  const res: AxiosResponse<ApiResponse<MetaChannel>> = await httpClient.post(
    `${BASE}/${channelId}/disconnect`,
  );
  return res.data.data;
}

export async function reconnectMetaChannel(channelId: string): Promise<MetaReconnectResult> {
  const res: AxiosResponse<ApiResponse<MetaReconnectResult>> = await httpClient.post(
    `${BASE}/${channelId}/reconnect`,
  );
  return res.data.data;
}

export async function pingMetaChannel(channelId: string): Promise<MetaChannelPingResult> {
  const res: AxiosResponse<ApiResponse<MetaChannelPingResult>> = await httpClient.post(
    `${BASE}/${channelId}/test-webhook`,
  );
  return res.data.data;
}

export async function getMetaChannelConsentSummary(
  channelId: string,
): Promise<MetaChannelConsentSummary> {
  const res: AxiosResponse<ApiResponse<MetaChannelConsentSummary>> = await httpClient.get(
    `${BASE}/${channelId}/consent-summary`,
  );
  return res.data.data;
}
