import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { SetupStatus } from '../types/setup';
import type { AxiosResponse } from 'axios';

export async function getSetupStatus(): Promise<SetupStatus> {
  const response: AxiosResponse<ApiResponse<SetupStatus>> = await httpClient.get('/api/setup/status');
  return response.data.data;
}
