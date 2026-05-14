/**
 * Audit Log API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { AuditLog, AuditLogFilters } from '../types/audit';
import type { AxiosResponse } from 'axios';

export async function getAuditLogs(filters?: AuditLogFilters): Promise<AuditLog[]> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
  }

  const qs = params.toString();
  const response: AxiosResponse<ApiResponse<AuditLog[]>> = await httpClient.get(
    qs ? `/api/audit/logs?${qs}` : '/api/audit/logs'
  );
  return response.data.data;
}

export async function getResourceAuditLogs(
  type: string,
  id: string,
  options?: { limit?: number; offset?: number }
): Promise<AuditLog[]> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.append('limit', String(options.limit));
  if (options?.offset !== undefined) params.append('offset', String(options.offset));
  const qs = params.toString();

  const response: AxiosResponse<ApiResponse<AuditLog[]>> = await httpClient.get(
    qs ? `/api/audit/resource/${type}/${id}?${qs}` : `/api/audit/resource/${type}/${id}`
  );
  return response.data.data;
}
