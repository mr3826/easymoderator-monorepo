/**
 * Customer Domain API Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as customer from '../customer';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Customer Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCustomers', () => {
    it('should map the flat backend body to a PaginatedResponse', async () => {
      // Backend sends { success, data: [...], total, page, pageSize } — total/page/pageSize
      // are siblings of `data`, not nested. getCustomers must reconstruct PaginatedResponse.
      const mockResponse = {
        data: {
          success: true,
          data: [
            { id: '1', name: 'Customer 1', phone: '01711111111' },
            { id: '2', name: 'Customer 2', phone: '01722222222' },
          ],
          total: 2,
          page: 1,
          pageSize: 10,
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await customer.getCustomers();

      expect(httpClient.get).toHaveBeenCalledWith('/api/customer?');
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('should default to an empty list when the payload is empty', async () => {
      const mockResponse = { data: { success: true, data: [], total: 0, page: 1, pageSize: 10 } };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await customer.getCustomers({ search: 'john', phone: '017' });

      expect(httpClient.get).toHaveBeenCalledWith('/api/customer?search=john&phone=017');
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getCustomer', () => {
    it('should return single customer', async () => {
      const mockResponse = {
        data: {
          data: { id: '1', name: 'Customer 1', phone: '01711111111', orders: [] },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await customer.getCustomer('1');

      expect(httpClient.get).toHaveBeenCalledWith('/api/customer/1');
      expect(result.name).toBe('Customer 1');
    });
  });

  describe('createCustomer', () => {
    it('should create customer', async () => {
      const customerData = { name: 'New Customer', phone: '01733333333' };
      const mockResponse = {
        data: { data: { id: '3', ...customerData } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await customer.createCustomer(customerData as any);

      expect(httpClient.post).toHaveBeenCalledWith('/api/customer', customerData);
      expect(result.id).toBe('3');
    });
  });

  describe('updateCustomer', () => {
    it('should update customer', async () => {
      const updateData = { name: 'Updated Name' };
      const mockResponse = {
        data: { data: { id: '1', ...updateData } },
      };
      (httpClient.patch as any).mockResolvedValue(mockResponse);

      await customer.updateCustomer('1', updateData);

      expect(httpClient.patch).toHaveBeenCalledWith('/api/customer/1', updateData);
    });
  });

  describe('blacklistCustomer', () => {
    it('should blacklist customer', async () => {
      (httpClient.post as any).mockResolvedValue({ data: {} });

      await customer.blacklistCustomer('1', 'Spam behavior');

      expect(httpClient.post).toHaveBeenCalledWith('/api/customer/1/blacklist', { reason: 'Spam behavior' });
    });
  });

  describe('removeFromBlacklist', () => {
    it('should remove from blacklist', async () => {
      (httpClient.delete as any).mockResolvedValue({ data: {} });

      await customer.removeFromBlacklist('1');

      expect(httpClient.delete).toHaveBeenCalledWith('/api/customer/1/blacklist');
    });
  });
});
