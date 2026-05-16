/**
 * Subscription & Billing API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type {
  Subscription,
  SubscriptionPlan,
  PaymentMethod,
  Invoice,
} from '../types/subscription';
import type { AxiosResponse } from 'axios';

/**
 * Get current subscription details
 * @returns Promise resolving to subscription object
 * @throws {Error} When subscription retrieval fails
 * @example
 * ```typescript
 * const subscription = await getSubscription();
 * console.log('Plan:', subscription.plan.name);
 * ```
 */
export async function getSubscription(): Promise<Subscription> {
  const response: AxiosResponse<ApiResponse<Subscription>> = await httpClient.get('/api/subscription');
  return response.data.data;
}

/**
 * Get available subscription plans
 * @returns Promise resolving to array of subscription plans
 * @throws {Error} When plan retrieval fails
 * @example
 * ```typescript
 * const plans = await getSubscriptionPlans();
 * console.log('Available plans:', plans.length);
 * ```
 */
export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const response: AxiosResponse<ApiResponse<SubscriptionPlan[]>> = await httpClient.get(
    '/api/subscription/plans'
  );
  return response.data.data;
}

/**
 * Subscribe to a plan
 * @param planId - ID of plan to subscribe to
 * @param billingCycle - Billing cycle ('monthly' | 'yearly', default: 'monthly')
 * @returns Promise resolving to subscription object
 * @throws {Error} When subscription fails
 * @example
 * ```typescript
 * const subscription = await subscribeToPlan('plan123', 'yearly');
 * console.log('Subscribed to yearly plan');
 * ```
 */
export async function subscribeToPlan(
  planId: string,
  billingCycle: 'monthly' | 'yearly' = 'monthly'
): Promise<Subscription> {
  const response: AxiosResponse<ApiResponse<Subscription>> = await httpClient.put(
    '/api/subscription/plan',
    { plan_code: planId, billing_cycle: billingCycle }
  );
  return response.data.data;
}

/**
 * Cancel current subscription
 * @param reason - Optional reason for cancellation
 * @returns Promise resolving to updated subscription object
 * @throws {Error} When cancellation fails
 * @example
 * ```typescript
 * const cancelled = await cancelSubscription('Too expensive');
 * console.log('Status:', cancelled.status);
 * ```
 */
export async function cancelSubscription(reason?: string): Promise<Subscription> {
  const response: AxiosResponse<ApiResponse<Subscription>> = await httpClient.post(
    '/api/subscription/cancel',
    { reason }
  );
  return response.data.data;
}

/**
 * Reactivate cancelled subscription
 * @returns Promise resolving to reactivated subscription object
 * @throws {Error} When reactivation fails
 * @example
 * ```typescript
 * const reactivated = await reactivateSubscription();
 * console.log('Status:', reactivated.status);
 * ```
 */
export async function reactivateSubscription(): Promise<Subscription> {
  const response: AxiosResponse<ApiResponse<Subscription>> = await httpClient.post(
    '/api/subscription/reactivate'
  );
  return response.data.data;
}

// Payment Methods
/**
 * Get available payment methods
 * @returns Promise resolving to array of payment methods
 * @throws {Error} When payment methods retrieval fails
 * @example
 * ```typescript
 * const methods = await getPaymentMethods();
 * console.log('Available methods:', methods.length);
 * ```
 */
export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const response: AxiosResponse<ApiResponse<PaymentMethod[]>> = await httpClient.get(
    '/api/subscription/payment-methods'
  );
  return response.data.data;
}

/**
 * Add new payment method
 * @param paymentMethodId - ID of payment method to add
 * @returns Promise resolving to added payment method object
 * @throws {Error} When payment method addition fails
 * @example
 * ```typescript
 * const method = await addPaymentMethod('payment123');
 * console.log('Added:', method.type);
 * ```
 */
export async function addPaymentMethod(
  paymentMethodId: string
): Promise<PaymentMethod> {
  const response: AxiosResponse<ApiResponse<PaymentMethod>> = await httpClient.post(
    '/api/subscription/payment-methods',
    { paymentMethodId }
  );
  return response.data.data;
}

/**
 * Remove payment method
 * @param paymentMethodId - ID of payment method to remove
 * @returns Promise that resolves when removal completes
 * @throws {Error} When payment method removal fails
 * @example
 * ```typescript
 * await removePaymentMethod('payment123');
 * // Payment method removed
 * ```
 */
export async function removePaymentMethod(paymentMethodId: string): Promise<void> {
  await httpClient.delete(`/api/subscription/payment-methods/${paymentMethodId}`);
}

/**
 * Set default payment method
 * @param paymentMethodId - ID of payment method to set as default
 * @returns Promise that resolves when default is set
 * @throws {Error} When setting default payment method fails
 * @example
 * ```typescript
 * await setDefaultPaymentMethod('payment123');
 * // Payment method set as default
 * ```
 */
export async function setDefaultPaymentMethod(paymentMethodId: string): Promise<void> {
  await httpClient.patch('/api/subscription/payment-methods/default', { paymentMethodId });
}

/**
 * Get invoice history
 * @returns Promise resolving to array of invoices
 * @throws {Error} When invoice retrieval fails
 * @example
 * ```typescript
 * const invoices = await getInvoices();
 * console.log('Total invoices:', invoices.length);
 * ```
 */
export async function getInvoices(): Promise<Invoice[]> {
  const response: AxiosResponse<ApiResponse<Invoice[]>> = await httpClient.get(
    '/api/subscription/invoices'
  );
  return response.data.data;
}

/**
 * Get single invoice by ID
 * @param invoiceId - Unique identifier of invoice to retrieve
 * @returns Promise resolving to invoice object
 * @throws {Error} When invoice not found or retrieval fails
 * @example
 * ```typescript
 * const invoice = await getInvoice('invoice123');
 * console.log('Amount:', invoice.amount);
 * ```
 */
export async function getInvoice(invoiceId: string): Promise<Invoice> {
  const response: AxiosResponse<ApiResponse<Invoice>> = await httpClient.get(
    `/api/subscription/invoices/${invoiceId}`
  );
  return response.data.data;
}

/**
 * Purchase a conversation top-up pack (creates an invoice)
 * @param amount - Number of conversations in the pack
 * @param price - Price of the pack in BDT
 * @returns Promise resolving to the created invoice
 */
export async function purchaseConversationPack(payload: {
  amount: number;
  price: number;
}): Promise<any> {
  const response: AxiosResponse<any> = await httpClient.post(
    '/api/subscription/conversation-pack',
    payload
  );
  return response.data;
}

