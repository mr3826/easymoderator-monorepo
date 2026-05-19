/**
 * comment-to-dm.ts
 *
 * Phase 4 — Comment-to-DM API client.
 *
 * Surfaces:
 *   listEvents(params)              — GET /api/comment-to-dm/events
 *   getEvent(id)                    — GET /api/comment-to-dm/events/:id
 *   getSettings(channelId)          — GET /api/comment-to-dm/settings/:channelId
 *   updateSettings(channelId, body) — PUT /api/comment-to-dm/settings/:channelId
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { AxiosResponse } from 'axios';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommentToDmState =
  | 'COMMENT_RECEIVED'
  | 'MATCHED'
  | 'BLOCKED'
  | 'PUBLIC_REPLY_QUEUED'
  | 'PUBLIC_REPLIED'
  | 'DM_INVITE_SENT'
  | 'CUSTOMER_OPENED_DM'
  | 'AUTOMATION_UNLOCKED'
  | 'EXPIRED'
  | 'FAILED';

export type CommentToDmPlatform = 'facebook' | 'instagram';

export interface CommentToDmEvent {
  id: string;
  shopId: string;
  channelId: string;
  platform: CommentToDmPlatform;
  postId: string;
  commentId: string;
  parentCommentId: string | null;
  commenterExternalId: string;
  commenterName: string | null;
  commentText: string | null;
  matchedKeyword: string | null;
  state: CommentToDmState;
  customerId: string | null;
  conversationId: string | null;
  lastTransitionAt: string;
  lastError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CommentToDmSettings {
  channelId: string;
  commentToDmEnabled: boolean;
  commentToDmKeywords: string[];
  commentToDmPostFilter: string[];
  automationMode: string;
  updatedAt: string;
}

export interface ListEventsParams {
  status?: CommentToDmState;
  limit?: number;
  cursor?: string;
}

export interface ListEventsResponse {
  data: CommentToDmEvent[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface UpdateSettingsBody {
  comment_to_dm_enabled?: boolean;
  comment_to_dm_keywords?: string[];
  comment_to_dm_post_filter?: string[];
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function listEvents(params?: ListEventsParams): Promise<ListEventsResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.append('status', params.status);
  if (params?.limit !== undefined) query.append('limit', String(params.limit));
  if (params?.cursor) query.append('cursor', params.cursor);

  const qs = query.toString();
  const url = qs ? `/api/comment-to-dm/events?${qs}` : '/api/comment-to-dm/events';

  const response: AxiosResponse<ApiResponse<CommentToDmEvent[]> & {
    pagination: ListEventsResponse['pagination'];
  }> = await httpClient.get(url);

  return {
    data:       response.data.data,
    pagination: response.data.pagination,
  };
}

export async function getEvent(id: string): Promise<CommentToDmEvent> {
  const response: AxiosResponse<ApiResponse<CommentToDmEvent>> =
    await httpClient.get(`/api/comment-to-dm/events/${id}`);
  return response.data.data;
}

export async function getSettings(channelId: string): Promise<CommentToDmSettings> {
  const response: AxiosResponse<ApiResponse<CommentToDmSettings>> =
    await httpClient.get(`/api/comment-to-dm/settings/${channelId}`);
  return response.data.data;
}

export async function updateSettings(
  channelId: string,
  body: UpdateSettingsBody
): Promise<CommentToDmSettings> {
  const response: AxiosResponse<ApiResponse<CommentToDmSettings>> =
    await httpClient.put(`/api/comment-to-dm/settings/${channelId}`, body);
  return response.data.data;
}
