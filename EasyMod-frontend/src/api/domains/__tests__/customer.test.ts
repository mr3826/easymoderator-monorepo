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
    it('should return customer list', async () => {
      const mockResponse = {
        data: {
          data: {
            items: [
              { id: '1', name: 'Customer 1', phone: '01711111111' },
              { id: '2', name: 'Customer 2', phone: '01722222222' },
            ],
            pagination: { page: 1, totalPages: 1 },
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await customer.getCustomers();

      expect(httpClient.get).toHaveBeenCalledWith('/customer?');
      expect(result.items).toHaveLength(2);
    });

    it('should handle search filters', async () => {
      const mockResponse = { data: { data: { items: [], pagination: {} } } };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      await customer.getCustomers({ search: 'john', phone: '017' });

      expect(httpClient.get).toHaveBeenCalledWith('/customer?search=john&phone=017');
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

      expect(httpClient.get).toHaveBeenCalledWith('/customer/1');
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

      expect(httpClient.post).toHaveBeenCalledWith('/customer', customerData);
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

      const result = await customer.updateCustomer('1', updateData);

      expect(httpClient.patch).toHaveBeenCalledWith('/customer/1', updateData);
    });
  });

  describe('blacklistCustomer', () => {
    it('should blacklist customer', async () => {
      (httpClient.post as any).mockResolvedValue({ data: {} });

      await customer.blacklistCustomer('1', 'Spam behavior');

      expect(httpClient.post).toHaveBeenCalledWith('/customer/1/blacklist', { reason: 'Spam behavior' });
    });
  });

  describe('removeFromBlacklist', () => {
    it('should remove from blacklist', async () => {
      (httpClient.delete as any).mockResolvedValue({ data: {} });

      await customer.removeFromBlacklist('1');

      expect(httpClient.delete).toHaveBeenCalledWith('/customer/1/blacklist');
    });
  });
});
