/**
 * Conversation & Messaging API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse, PaginatedResponse } from '../types/common';
import type {
  Conversation,
  Message,
  ResponseTemplate,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResponse,
} from '../types/conversation';
import type { AuditLog } from '../types/audit';
import type { AxiosResponse } from 'axios';

// Conversations
export async function getConversations(
  params?: Record<string, unknown>
): Promise<PaginatedResponse<Conversation>> {
  const response: AxiosResponse<ApiResponse<PaginatedResponse<Conversation>>> =
    await httpClient.get('/api/conversation', { params });
  return response.data.data;
}

export async function getConversation(conversationId: string): Promise<Conversation> {
  const response: AxiosResponse<ApiResponse<Conversation>> = await httpClient.get(
    `/api/conversation/${conversationId}`
  );
  return response.data.data;
}

export async function sendMessage(
  conversationId: string,
  content: string,
  options?: { useAI?: boolean; templateId?: string }
): Promise<Message> {
  const response: AxiosResponse<ApiResponse<Message>> = await httpClient.post(
    `/api/conversation/${conversationId}/message`,
    { content, ...options }
  );
  return response.data.data;
}

export async function assignConversation(
  conversationId: string,
  assigneeId: string | null
): Promise<Conversation> {
  const response: AxiosResponse<ApiResponse<Conversation>> = await httpClient.patch(
    `/api/conversation/${conversationId}/assign`,
    { assigneeId }
  );
  return response.data.data;
}

export async function closeConversation(
  conversationId: string,
  resolutionNote?: string
): Promise<Conversation> {
  const response: AxiosResponse<ApiResponse<Conversation>> = await httpClient.post(
    `/api/conversation/${conversationId}/close`,
    { resolutionNote }
  );
  return response.data.data;
}

export async function reopenConversation(conversationId: string): Promise<Conversation> {
  const response: AxiosResponse<ApiResponse<Conversation>> = await httpClient.post(
    `/api/conversation/${conversationId}/reopen`
  );
  return response.data.data;
}

// Messages
export async function getMessages(
  conversationId: string, 
  params?: { page?: number; limit?: number }
): Promise<{ messages: Message[]; pagination: { page: number; totalPages: number } }> {
  const response: AxiosResponse<ApiResponse<{ messages: Message[]; pagination: { page: number; totalPages: number } }>> = 
    await httpClient.get(`/api/conversation/${conversationId}/messages`, { params });
  return response.data.data;
}

export async function createMessage(
  conversationId: string,
  message: {
    content: string;
    sender: 'customer' | 'agent' | 'ai';
    message_type: 'text' | 'image' | 'file' | 'location';
    metadata?: unknown;
    message_tag?: string;
  }
): Promise<Message> {
  const response: AxiosResponse<ApiResponse<Message>> = await httpClient.post(
    `/api/conversation/${conversationId}/messages`,
    message
  );
  return response.data.data;
}

export async function updateConversation(
  conversationId: string,
  updates: {
    status?: 'active' | 'closed' | 'archived';
    hitl?: boolean;
    assignee_id?: string;
    resolution_note?: string;
  }
): Promise<Conversation> {
  const response: AxiosResponse<ApiResponse<Conversation>> = await httpClient.patch(
    `/api/conversation/${conversationId}`,
    updates
  );
  return response.data.data;
}

export async function transcribeVoice(
  request: VoiceTranscriptionRequest
): Promise<VoiceTranscriptionResponse> {
  const response: AxiosResponse<ApiResponse<VoiceTranscriptionResponse>> = await httpClient.post(
    '/api/conversation/transcribe',
    request
  );
  return response.data.data;
}

// Response Templates
export async function getResponseTemplates(): Promise<ResponseTemplate[]> {
  const response: AxiosResponse<ApiResponse<ResponseTemplate[]>> = await httpClient.get(
    '/api/templates'
  );
  return response.data.data;
}

export async function createTemplate(
  template: Omit<ResponseTemplate, 'id'>
): Promise<ResponseTemplate> {
  const response: AxiosResponse<ApiResponse<ResponseTemplate>> = await httpClient.post(
    '/api/templates',
    template
  );
  return response.data.data;
}

export async function updateTemplate(
  templateId: string,
  template: Partial<ResponseTemplate>
): Promise<ResponseTemplate> {
  const response: AxiosResponse<ApiResponse<ResponseTemplate>> = await httpClient.patch(
    `/api/templates/${templateId}`,
    template
  );
  return response.data.data;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await httpClient.delete(`/api/templates/${templateId}`);
}

// Audit Logs
export async function createAuditLog(log: {
  action: string;
  resource_type: string;
  resource_id: string;
  old_values?: unknown;
  new_values?: unknown;
  metadata?: unknown;
}): Promise<AuditLog> {
  const response: AxiosResponse<ApiResponse<AuditLog>> = await httpClient.post(
    '/api/audit',
    log
  );
  return response.data.data;
}


