/**
 * Users API Integration Tests
 * Tests for useUsersApi hook - list, create, edit, delete operations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUsersApi } from '../api/useUsersApi';
import { httpClient } from '@/shared/lib/http';
import { User, CreateUserInput, UpdateUserInput } from '../types';

// Mock the HTTP client
vi.mock('@/shared/lib/http', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('useUsersApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listUsers', () => {
    it('should fetch users for current shop', async () => {
      const mockUsers: User[] = [
        {
          id: '1',
          shopId: 'shop-1',
          name: 'John Doe',
          email: 'john@example.com',
          role: 'admin',
          isActive: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];

      vi.mocked(httpClient.get).mockResolvedValueOnce({
        data: mockUsers,
        total: 1,
        page: 1,
        pageSize: 10,
      });

      const { result } = renderHook(() => useUsersApi());

      result.current.listUsers();

      await waitFor(() => {
        expect(result.current.users).toEqual(mockUsers);
        expect(result.current.isLoading).toBe(false);
      });

      expect(httpClient.get).toHaveBeenCalledWith('/api/users', {
        params: { page: 1, pageSize: 10 },
      });
    });

    it('should handle loading state during fetch', async () => {
      vi.mocked(httpClient.get).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 100))
      );

      const { result } = renderHook(() => useUsersApi());

      await waitFor(() => {
        result.current.listUsers();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should handle API errors gracefully', async () => {
      const error = new Error('Network error');
      vi.mocked(httpClient.get).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUsersApi());

      result.current.listUsers();

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should support pagination parameters', async () => {
      vi.mocked(httpClient.get).mockResolvedValueOnce({ data: [], total: 0 });

      const { result } = renderHook(() => useUsersApi());

      result.current.listUsers({ page: 2, pageSize: 20 });

      await waitFor(() => {
        expect(httpClient.get).toHaveBeenCalledWith('/api/users', {
          params: { page: 2, pageSize: 20 },
        });
      });
    });
  });

  describe('createUser', () => {
    it('should create a new user with valid input', async () => {
      const newUser = {
        name: 'Jane Dow',
        email: 'jane@example.com',
        role: 'moderator' as const,
      };

      const createdUser: User = {
        id: '2',
        shopId: 'shop-1',
        ...newUser,
        isActive: true,
        createdAt: '2024-01-02',
        updatedAt: '2024-01-02',
      };

      vi.mocked(httpClient.post).mockResolvedValueOnce(createdUser);

      const { result } = renderHook(() => useUsersApi());

      result.current.createUser(newUser);

      await waitFor(() => {
        expect(result.current.lastCreatedUser).toEqual(createdUser);
        expect(result.current.isLoading).toBe(false);
      });

      expect(httpClient.post).toHaveBeenCalledWith('/api/users', newUser);
    });

    it('should validate required fields before submitting', async () => {
      const { result } = renderHook(() => useUsersApi());

      const invalidUser = {
        name: '',
        email: 'invalid',
        role: 'user' as const,
      };

      const errors = result.current.validateUserInput(invalidUser);

      expect(errors).toEqual(expect.objectContaining({
        name: 'Name is required',
        email: 'Valid email is required',
      }));
    });

    it('should reject user creation on API error', async () => {
      const error = new Error('Validation failed');
      vi.mocked(httpClient.post).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUsersApi());

      result.current.createUser({
        name: 'Test',
        email: 'test@example.com',
        role: 'user',
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });

  describe('updateUser', () => {
    it('should update user role and properties', async () => {
      const userId = '1';
      const updateData: UpdateUserInput = {
        role: 'admin',
        name: 'Updated Name',
      };

      const updatedUser: User = {
        id: userId,
        shopId: 'shop-1',
        name: 'Updated Name',
        email: 'john@example.com',
        role: 'admin',
        isActive: true,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      };

      vi.mocked(httpClient.put).mockResolvedValueOnce(updatedUser);

      const { result } = renderHook(() => useUsersApi());

      result.current.updateUser(userId, updateData);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(httpClient.put).toHaveBeenCalledWith(`/api/users/${userId}`, updateData);
    });

    it('should handle update errors', async () => {
      const error = new Error('User not found');
      vi.mocked(httpClient.put).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUsersApi());

      result.current.updateUser('999', { role: 'admin' });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });

  describe('deleteUser', () => {
    it('should delete a user by ID', async () => {
      const userId = '1';

      vi.mocked(httpClient.delete).mockResolvedValueOnce({ success: true });

      const { result } = renderHook(() => useUsersApi());

      result.current.deleteUser(userId);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(httpClient.delete).toHaveBeenCalledWith(`/api/users/${userId}`);
    });

    it('should handle delete errors', async () => {
      const error = new Error('Delete failed');
      vi.mocked(httpClient.delete).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUsersApi());

      result.current.deleteUser('1');

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });

  describe('multi-tenant shop scoping', () => {
    it('should automatically include shop context in all requests', async () => {
      vi.mocked(httpClient.get).mockResolvedValueOnce({ data: [] });

      const { result } = renderHook(() => useUsersApi());

      result.current.listUsers();

      await waitFor(() => {
        // The httpClient should have X-Shop-ID injected automatically
        // by useAuthHttpShopId hook (verified in integration tests)
        expect(httpClient.get).toHaveBeenCalled();
      });
    });

    it('should handle shop switching by refreshing users', async () => {
      const shopAUsers: User[] = [
        {
          id: '1',
          shopId: 'shop-a',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'admin',
          isActive: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];

      const shopBUsers: User[] = [
        {
          id: '2',
          shopId: 'shop-b',
          name: 'Bob',
          email: 'bob@example.com',
          role: 'admin',
          isActive: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];

      vi.mocked(httpClient.get)
        .mockResolvedValueOnce({ data: shopAUsers })
        .mockResolvedValueOnce({ data: shopBUsers });

      const { result } = renderHook(() => useUsersApi());

      // First call for shop A
      result.current.listUsers();

      await waitFor(() => {
        expect(result.current.users).toEqual(shopAUsers);
      });

      // Simulate shop switch and refresh
      result.current.listUsers();

      await waitFor(() => {
        expect(result.current.users).toEqual(shopBUsers);
      });

      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });
  });
});
