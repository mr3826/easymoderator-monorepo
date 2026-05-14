/**
 * Customer API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse, PaginatedResponse } from '../types/common';
import type { Customer, CustomerFilters } from '../types/customer';
import type { AxiosResponse } from 'axios';

/**
 * Get all customers with optional filtering and pagination
 * @param filters - Optional filters for searching customers by name, email, status, etc.
 * @returns Promise resolving to paginated customer list
 * @throws {Error} When customer retrieval fails
 * @example
 * ```typescript
 * const customers = await getCustomers({ status: 'active', page: 1, limit: 20 });
 * ```
 */
export async function getCustomers(filters?: CustomerFilters): Promise<PaginatedResponse<Customer>> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
  }

  const response: AxiosResponse<ApiResponse<PaginatedResponse<Customer>>> = await httpClient.get(
    `/api/customer?${params}`
  );
  return response.data.data;
}

/**
 * Get single customer by ID
 * @param customerId - Unique identifier of customer to retrieve
 * @returns Promise resolving to customer object
 * @throws {Error} When customer not found or retrieval fails
 * @example
 * ```typescript
 * const customer = await getCustomer('cust123');
 * console.log(customer.name);
 * ```
 */
export async function getCustomer(customerId: string): Promise<Customer> {
  const response: AxiosResponse<ApiResponse<Customer>> = await httpClient.get(
    `/api/customer/${customerId}`
  );
  return response.data.data;
}

/**
 * Create new customer
 * @param customer - Customer data without id, shop_id, created_at, and updated_at
 * @returns Promise resolving to created customer object
 * @throws {Error} When customer creation fails due to validation or network issues
 * @example
 * ```typescript
 * const newCustomer = await createCustomer({ 
 *   name: 'John Doe', 
 *   email: 'john@example.com',
 *   phone: '+1234567890'
 * });
 * ```
 */
export async function createCustomer(
  customer: Omit<Customer, 'id' | 'shop_id' | 'created_at' | 'updated_at'>
): Promise<Customer> {
  const response: AxiosResponse<ApiResponse<Customer>> = await httpClient.post('/api/customer', customer);
  return response.data.data;
}

/**
 * Update existing customer
 * @param customerId - ID of customer to update
 * @param customer - Partial customer data with fields to update
 * @returns Promise resolving to updated customer object
 * @throws {Error} When customer update fails due to invalid ID or permissions
 * @example
 * ```typescript
 * const updated = await updateCustomer('cust123', { name: 'Jane Doe' });
 * ```
 */
export async function updateCustomer(
  customerId: string,
  customer: Partial<Customer>
): Promise<Customer> {
  const response: AxiosResponse<ApiResponse<Customer>> = await httpClient.patch(
    `/api/customer/${customerId}`,
    customer
  );
  return response.data.data;
}

/**
 * Blacklist customer with optional reason
 * @param customerId - ID of customer to blacklist
 * @param reason - Optional reason for blacklisting
 * @returns Promise that resolves when blacklisting completes
 * @throws {Error} When customer blacklisting fails
 * @example
 * ```typescript
 * await blacklistCustomer('cust123', 'Fraudulent activity');
 * // Customer is now blacklisted
 * ```
 */
export async function blacklistCustomer(customerId: string, reason?: string): Promise<void> {
  await httpClient.post(`/api/customer/${customerId}/blacklist`, { reason });
}

/**
 * Remove customer from blacklist
 * @param customerId - ID of customer to remove from blacklist
 * @returns Promise that resolves when removal completes
 * @throws {Error} When customer removal from blacklist fails
 * @example
 * ```typescript
 * await removeFromBlacklist('cust123');
 * // Customer is no longer blacklisted
 * ```
 */
export async function removeFromBlacklist(customerId: string): Promise<void> {
  await httpClient.delete(`/api/customer/${customerId}/blacklist`);
}

export async function deleteCustomer(customerId: string): Promise<void> {
  await httpClient.delete(`/api/customer/${customerId}`);
}


