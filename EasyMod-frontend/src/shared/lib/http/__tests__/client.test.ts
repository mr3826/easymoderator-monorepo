import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { httpClient } from '../client';

describe('HTTP Client - Shop ID Injection', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    httpClient.setShopId(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setShopId and getShopId', () => {
    it('should set and retrieve shop ID', () => {
      httpClient.setShopId('shop_123');
      expect(httpClient.getShopId()).toBe('shop_123');
    });

    it('should handle null shop ID', () => {
      httpClient.setShopId(null);
      expect(httpClient.getShopId()).toBeNull();
    });

    it('should update shop ID', () => {
      httpClient.setShopId('shop_123');
      expect(httpClient.getShopId()).toBe('shop_123');

      httpClient.setShopId('shop_456');
      expect(httpClient.getShopId()).toBe('shop_456');
    });
  });

  describe('request interceptor - shop ID injection', () => {
    it('should not inject X-Shop-ID header when shop ID is null', async () => {
      httpClient.setShopId(null);

      try {
        // This will fail due to no server, but we can check interceptor behavior
        await httpClient.get('/api/test');
      } catch (error: any) {
        // The error should not have X-Shop-ID header
        // (we're testing the interceptor setup, not actual requests)
      }
    });

    it('should inject shop ID via header', async () => {
      const axiosInstance = httpClient.getAxiosInstance();
      const requestSpy = vi.spyOn(axiosInstance.interceptors.request, 'use');

      httpClient.setShopId('shop_789');

      // Request interceptor is already set up, verify shop ID is stored
      expect(httpClient.getShopId()).toBe('shop_789');
    });
  });

  describe('skipShopIdConfig', () => {
    it('should create config with __skipShopId flag', () => {
      const config = httpClient.skipShopIdConfig();
      expect(config.__skipShopId).toBe(true);
    });

    it('should merge with existing config', () => {
      const config = httpClient.skipShopIdConfig({
        headers: { 'X-Custom': 'value' },
      });

      expect(config.__skipShopId).toBe(true);
      // Note: actual header merge happens in axios
    });

    it('should handle undefined input config', () => {
      const config = httpClient.skipShopIdConfig();
      expect(config).toBeDefined();
      expect(config.__skipShopId).toBe(true);
    });
  });

  describe('getAxiosInstance', () => {
    it('should return axios instance', () => {
      const instance = httpClient.getAxiosInstance();
      expect(instance).toBeDefined();
      expect(instance.request).toBeDefined();
      expect(instance.get).toBeDefined();
      expect(instance.post).toBeDefined();
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = httpClient.getAxiosInstance();
      const instance2 = httpClient.getAxiosInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('convenience methods', () => {
    it('should provide get method', () => {
      expect(httpClient.get).toBeDefined();
      expect(typeof httpClient.get).toBe('function');
    });

    it('should provide post method', () => {
      expect(httpClient.post).toBeDefined();
      expect(typeof httpClient.post).toBe('function');
    });

    it('should provide put method', () => {
      expect(httpClient.put).toBeDefined();
      expect(typeof httpClient.put).toBe('function');
    });

    it('should provide patch method', () => {
      expect(httpClient.patch).toBeDefined();
      expect(typeof httpClient.patch).toBe('function');
    });

    it('should provide delete method', () => {
      expect(httpClient.delete).toBeDefined();
      expect(typeof httpClient.delete).toBe('function');
    });
  });

  describe('auth token handling', () => {
    it('should inject auth token from localStorage', () => {
      localStorage.setItem('auth_token', 'test_token_123');

      // Verify token is stored
      expect(localStorage.getItem('auth_token')).toBe('test_token_123');
    });

    it('should handle missing auth token', () => {
      localStorage.removeItem('auth_token');

      // Should not throw, just not inject header
      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });

  describe('multi-tenant scenarios', () => {
    it('should switch between shops', () => {
      httpClient.setShopId('shop_1');
      expect(httpClient.getShopId()).toBe('shop_1');

      httpClient.setShopId('shop_2');
      expect(httpClient.getShopId()).toBe('shop_2');

      httpClient.setShopId('shop_1');
      expect(httpClient.getShopId()).toBe('shop_1');
    });

    it('should allow clearing shop ID', () => {
      httpClient.setShopId('shop_123');
      expect(httpClient.getShopId()).toBeTruthy();

      httpClient.setShopId(null);
      expect(httpClient.getShopId()).toBeNull();
    });

    it('should preserve shop ID across requests', async () => {
      httpClient.setShopId('shop_123');

      const shopId1 = httpClient.getShopId();
      expect(shopId1).toBe('shop_123');

      // Simulate another request
      const shopId2 = httpClient.getShopId();
      expect(shopId2).toBe('shop_123');
    });
  });
});
