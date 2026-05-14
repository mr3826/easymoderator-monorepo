/**
 * Order & Delivery API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type {
  Order,
  DeliverySettings,
  CourierBookingPayload,
  CourierBookingResult,
  ConnectDeliveryProviderRequest,
  DeliveryProvider,
} from '../types/order';
import type { AxiosResponse } from 'axios';

/**
 * Get all orders with optional filtering and pagination
 * @param params - Optional query parameters for filtering, pagination, and sorting
 * @returns Promise resolving to array of orders
 * @throws {Error} When order retrieval fails
 * @example
 * ```typescript
 * const orders = await getOrders({ status: 'pending', page: 1, limit: 10 });
 * ```
 */
export async function getOrders(params?: Record<string, unknown>): Promise<Order[]> {
  const response: AxiosResponse<ApiResponse<Order[]>> = await httpClient.get('/api/order', { params });
  return response.data.data;
}

/**
 * Get single order by ID
 * @param orderId - Unique identifier of order to retrieve
 * @returns Promise resolving to order object
 * @throws {Error} When order not found or retrieval fails
 * @example
 * ```typescript
 * const order = await getOrder('order123');
 * console.log(order.status);
 * ```
 */
export async function getOrder(orderId: string): Promise<Order> {
  const response: AxiosResponse<ApiResponse<Order>> = await httpClient.get(`/api/order/${orderId}`);
  return response.data.data;
}

/**
 * Create new order
 * @param order - Order data without id, createdAt, and updatedAt
 * @returns Promise resolving to created order object
 * @throws {Error} When order creation fails due to validation or network issues
 * @example
 * ```typescript
 * const newOrder = await createOrder({ 
 *   customer_id: 'cust123', 
 *   items: [{ product_id: 'prod1', quantity: 2 }],
 *   total: 199.99 
 * });
 * ```
 */
export async function createOrder(
  order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Order> {
  const response: AxiosResponse<ApiResponse<Order>> = await httpClient.post('/api/order', order);
  return response.data.data;
}

/**
 * Update existing order
 * @param orderId - ID of order to update
 * @param order - Partial order data with fields to update
 * @returns Promise resolving to updated order object
 * @throws {Error} When order update fails due to invalid ID or permissions
 * @example
 * ```typescript
 * const updated = await updateOrder('order123', { status: 'confirmed' });
 * ```
 */
export async function updateOrder(orderId: string, order: Partial<Order>): Promise<Order> {
  const response: AxiosResponse<ApiResponse<Order>> = await httpClient.patch(
    `/api/order/${orderId}`,
    order
  );
  return response.data.data;
}

/**
 * Confirm order for processing
 * @param orderId - ID of order to confirm
 * @returns Promise resolving to confirmed order object
 * @throws {Error} When order confirmation fails
 * @example
 * ```typescript
 * const confirmed = await confirmOrder('order123');
 * console.log('Order confirmed:', confirmed.id);
 * ```
 */
export async function confirmOrder(orderId: string): Promise<Order> {
  const response: AxiosResponse<ApiResponse<Order>> = await httpClient.post(
    `/api/order/${orderId}/confirm`
  );
  return response.data.data;
}

/**
 * Cancel order with optional reason
 * @param orderId - ID of order to cancel
 * @param reason - Optional reason for cancellation
 * @returns Promise resolving to cancelled order object
 * @throws {Error} When order cancellation fails
 * @example
 * ```typescript
 * const cancelled = await cancelOrder('order123', 'Customer requested');
 * console.log('Order cancelled:', cancelled.status);
 * ```
 */
export async function cancelOrder(orderId: string, reason?: string): Promise<Order> {
  const response: AxiosResponse<ApiResponse<Order>> = await httpClient.post(
    `/api/order/${orderId}/cancel`,
    { reason }
  );
  return response.data.data;
}

/**
 * Book courier for order delivery
 * @param orderId - ID of order to book courier for
 * @param payload - Courier booking details including service type and address
 * @returns Promise resolving to booking result with tracking info
 * @throws {Error} When courier booking fails
 * @example
 * ```typescript
 * const booking = await bookCourier('order123', { 
 *   service: 'express', 
 *   address: '123 Main St' 
 * });
 * console.log('Tracking:', booking.trackingNumber);
 * ```
 */
export async function bookCourier(
  orderId: string,
  payload: CourierBookingPayload
): Promise<CourierBookingResult> {
  const response: AxiosResponse<ApiResponse<CourierBookingResult>> = await httpClient.post(
    `/api/order/${orderId}/courier`,
    payload
  );
  return response.data.data;
}

/**
 * Get delivery settings configuration
 * @returns Promise resolving to delivery settings object
 * @throws {Error} When delivery settings cannot be retrieved
 * @example
 * ```typescript
 * const settings = await getDeliverySettings();
 * console.log('Default provider:', settings.defaultProvider);
 * ```
 */
export async function getDeliverySettings(): Promise<DeliverySettings> {
  const response: AxiosResponse<ApiResponse<DeliverySettings>> = await httpClient.get('/api/shop/delivery/settings');
  return response.data.data;
}

/**
 * Connect delivery provider service
 * @param payload - Provider connection details including credentials and settings
 * @returns Promise that resolves when connection completes
 * @throws {Error} When provider connection fails
 * @example
 * ```typescript
 * await connectDeliveryProvider({ 
 *   provider: 'fedex', 
 *   apiKey: 'key123' 
 * });
 * ```
 */
export async function connectDeliveryProvider(
  payload: ConnectDeliveryProviderRequest
): Promise<void> {
  await httpClient.post('/api/shop/delivery/connect', payload);
}

/**
 * Disconnect delivery provider service
 * @param provider - Provider type to disconnect
 * @returns Promise that resolves when disconnection completes
 * @throws {Error} When provider disconnection fails
 * @example
 * ```typescript
 * await disconnectDeliveryProvider('fedex');
 * // Provider disconnected
 * ```
 */
export async function disconnectDeliveryProvider(provider: DeliveryProvider): Promise<void> {
  await httpClient.post('/api/shop/delivery/disconnect', { provider });
}

/**
 * Toggle delivery provider active status
 * @param provider - Provider type to toggle
 * @param isActive - Whether provider should be active
 * @returns Promise that resolves when toggle completes
 * @throws {Error} When provider toggle fails
 * @example
 * ```typescript
 * await toggleDeliveryProvider('fedex', true);
 * // Provider is now active
 * ```
 */
export async function toggleDeliveryProvider(provider: DeliveryProvider, isActive: boolean): Promise<void> {
  await httpClient.post('/api/shop/delivery/toggle', { provider, isActive });
}

/**
 * Update delivery settings configuration
 * @param settings - Delivery settings including charges, COD options, and pricing
 * @returns Promise that resolves when settings are updated
 * @throws {Error} When delivery settings update fails
 * @example
 * ```typescript
 * await updateDeliverySettings({ 
 *   default_delivery_charge: 10, 
 *   cod_enabled: true 
 * });
 * ```
 */
export async function updateDeliverySettings(settings: {
  default_delivery_charge?: number;
  cod_enabled?: boolean;
  cod_charge?: number;
  non_refundable?: boolean;
  area_pricing?: unknown[];
  weight_tiers?: unknown[];
}): Promise<void> {
  await httpClient.put('/api/shop/delivery/settings', settings);
}

export async function testDeliveryConnection(provider: DeliveryProvider): Promise<void> {
  await httpClient.post('/api/shop/delivery/test', { provider });
}


