/**
 * Order Confidence (RTO Shield v2) API Domain
 * Backend: EasyMod-backend/src/modules/order-confidence
 */

import { httpClient } from '@/shared/lib/http/client';
import type { AxiosResponse } from 'axios';
import type { ApiResponse } from '../types/common';
import type { OrderConfidenceDecision, VerifyMethod } from '../types/customer-intelligence';

export async function getOrderConfidence(orderId: string): Promise<OrderConfidenceDecision> {
  const response: AxiosResponse<ApiResponse<OrderConfidenceDecision>> = await httpClient.get(
    `/api/order-confidence/orders/${encodeURIComponent(orderId)}`,
  );
  return response.data.data;
}

/** Record that a VERIFY order was confirmed with the customer (any shop role). */
export async function verifyOrderConfidence(
  orderId: string,
  payload: { decision_version: number; method: VerifyMethod; note?: string },
): Promise<OrderConfidenceDecision> {
  const response: AxiosResponse<ApiResponse<OrderConfidenceDecision>> = await httpClient.post(
    `/api/order-confidence/orders/${encodeURIComponent(orderId)}/verify`,
    payload,
  );
  return response.data.data;
}

/** Owner/admin approval of a MANUAL_REVIEW order (audited override). */
export async function approveOrderConfidence(
  orderId: string,
  payload: { decision_version: number; note: string },
): Promise<OrderConfidenceDecision> {
  const response: AxiosResponse<ApiResponse<OrderConfidenceDecision>> = await httpClient.post(
    `/api/order-confidence/orders/${encodeURIComponent(orderId)}/approve`,
    payload,
  );
  return response.data.data;
}

type MaybeApiError = {
  // NormalizedApiError (what httpClient throws)
  statusCode?: number;
  code?: string;
  details?: { decision?: OrderConfidenceDecision };
  // raw axios shape (defensive)
  response?: { status?: number; data?: { error?: { code?: string; details?: { decision?: OrderConfidenceDecision } } } };
};

/** A 409 from verify/approve carries the fresh decision so the panel can refresh. */
export function decisionFromConflict(error: unknown): OrderConfidenceDecision | null {
  const e = error as MaybeApiError;
  const status = e?.statusCode ?? e?.response?.status;
  if (status !== 409) return null;
  return e?.details?.decision ?? e?.response?.data?.error?.details?.decision ?? null;
}

/** The book-courier route answers 409 ORDER_CONFIDENCE_HOLD for a held order. */
export function isConfidenceHold(error: unknown): boolean {
  const e = error as MaybeApiError;
  const code = e?.code ?? e?.response?.data?.error?.code;
  return code === 'ORDER_CONFIDENCE_HOLD' || code === 'ORDER_CONFIDENCE_UNAVAILABLE';
}
