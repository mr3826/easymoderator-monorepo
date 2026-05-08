/**
 * Audit Log API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse, PaginatedResponse } from '../types/common';
import type { AuditLog, AuditLogFilters } from '../types/audit';
import type { AxiosResponse } from 'axios';

export async function getAuditLogs(filters?: AuditLogFilters): Promise<PaginatedResponse<AuditLog>> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
  }

  const response: AxiosResponse<ApiResponse<PaginatedResponse<AuditLog>>> = await httpClient.get(
    `/audit?${params}`
  );
  return response.data.data;
}

export async function getAuditLog(logId: string): Promise<AuditLog> {
  const response: AxiosResponse<ApiResponse<AuditLog>> = await httpClient.get(
    `/audit/${logId}`
  );
  return response.data.data;
}

export async function exportAuditLogs(
  filters?: AuditLogFilters
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const response: AxiosResponse<ApiResponse<{ downloadUrl: string; expiresAt: string }>> =
    await httpClient.post('/audit/export', filters ?? {});
  return response.data.data;
}
