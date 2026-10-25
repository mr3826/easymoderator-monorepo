/**
 * MW-V1 CRM Lite API domain — notes + tags (docs 05/04).
 * Everything is shop-scoped SERVER-side from the JWT; the client only ever
 * addresses internal ids. Bodies/tag names never enter analytics or logs.
 */

import { httpClient } from '@/shared/lib/http/client';
import type { AxiosResponse } from 'axios';
import type { ApiResponse } from '../types/common';
import type { CustomerNote, CustomerTag } from '../types/crm';

export async function listCustomerNotes(
  customerId: string,
  params: { limit?: number; before?: string } = {},
): Promise<{ data: CustomerNote[]; total: number }> {
  const response: AxiosResponse<ApiResponse<{ data: CustomerNote[]; total: number }>> =
    await httpClient.get(`/api/customer/${customerId}/notes`, { params });
  return response.data.data;
}

export async function createCustomerNote(customerId: string, body: string): Promise<CustomerNote> {
  const response: AxiosResponse<ApiResponse<CustomerNote>> =
    await httpClient.post(`/api/customer/${customerId}/notes`, { body });
  return response.data.data;
}

export async function updateCustomerNote(customerId: string, noteId: string, body: string): Promise<CustomerNote> {
  const response: AxiosResponse<ApiResponse<CustomerNote>> =
    await httpClient.patch(`/api/customer/${customerId}/notes/${noteId}`, { body });
  return response.data.data;
}

export async function deleteCustomerNote(customerId: string, noteId: string): Promise<void> {
  await httpClient.delete(`/api/customer/${customerId}/notes/${noteId}`);
}

export async function listTagVocabulary(): Promise<{ data: CustomerTag[] }> {
  const response: AxiosResponse<ApiResponse<{ data: CustomerTag[] }>> = await httpClient.get('/api/customer/tags');
  return response.data.data;
}

export async function createTag(name: string): Promise<CustomerTag> {
  const response: AxiosResponse<ApiResponse<CustomerTag>> = await httpClient.post('/api/customer/tags', { name });
  return response.data.data;
}

export async function listCustomerTags(customerId: string): Promise<{ data: CustomerTag[] }> {
  const response: AxiosResponse<ApiResponse<{ data: CustomerTag[] }>> = await httpClient.get(`/api/customer/${customerId}/tags`);
  return response.data.data;
}

export async function setCustomerTags(customerId: string, tagIds: string[]): Promise<{ data: CustomerTag[] }> {
  const response: AxiosResponse<ApiResponse<{ data: CustomerTag[] }>> = await httpClient.put(
    `/api/customer/${customerId}/tags`,
    { tag_ids: tagIds },
  );
  return response.data.data;
}
