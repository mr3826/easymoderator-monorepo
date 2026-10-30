/**
 * Merchant Action Queue (P+03) API Domain
 * Backend: EasyMod-backend/src/modules/inbox/inbox.routes.js
 *
 * The endpoint answers 409 FEATURE_DISABLED while the shop flag is off, so the
 * domain unwraps that into a first-class result shape instead of an exception —
 * the queue being off is the normal state, not an error.
 */

import { httpClient } from '@/shared/lib/http/client';
import type { AxiosResponse } from 'axios';
import type { ApiResponse } from '../types/common';
import type { InboxActionView, InboxActionsResponse } from '../types/inbox';

export type InboxActionsResult =
  | { featureDisabled: false; data: InboxActionsResponse }
  | { featureDisabled: true };

type MaybeApiError = {
  // NormalizedApiError (what httpClient throws)
  statusCode?: number;
  code?: string;
  // raw axios shape (defensive)
  response?: { status?: number; data?: { error?: { code?: string } } };
};

/** The platform-gate 409: queue not enabled for this shop. */
export function isFeatureDisabled(error: unknown): boolean {
  const e = error as MaybeApiError;
  return (e?.code ?? e?.response?.data?.error?.code) === 'FEATURE_DISABLED';
}

export async function getInboxActions(view: InboxActionView = 'attention'): Promise<InboxActionsResult> {
  try {
    const response: AxiosResponse<ApiResponse<InboxActionsResponse>> = await httpClient.get(
      '/api/inbox/actions',
      { params: { view } },
    );
    return { featureDisabled: false, data: response.data.data };
  } catch (error) {
    if (isFeatureDisabled(error)) return { featureDisabled: true };
    throw error;
  }
}
