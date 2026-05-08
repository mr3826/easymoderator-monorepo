/**
 * Users API Hook
 * Provides CRUD operations for user management with validation and error handling
 */

import { useState, useCallback } from 'react';
import { httpClient } from '@/shared/lib/http';
import { User, CreateUserInput, UpdateUserInput, UsersListResponse } from '../types';

export interface UseUsersApiReturn {
  users: User[];
  totalCount: number;
  isLoading: boolean;
  error?: string;
  lastCreatedUser?: User;
  listUsers: (options?: { page?: number; pageSize?: number }) => Promise<void>;
  createUser: (input: CreateUserInput) => Promise<void>;
  updateUser: (userId: string, input: UpdateUserInput) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  validateUserInput: (input: Partial<CreateUserInput>) => Record<string, string>;
  clearError: () => void;
}

export function useUsersApi(): UseUsersApiReturn {
  const [users, setUsers] = useState<User[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [lastCreatedUser, setLastCreatedUser] = useState<User>();

  const validateUserInput = useCallback(
    (input: Partial<CreateUserInput>): Record<string, string> => {
      const errors: Record<string, string> = {};

      if (!input.name?.trim()) {
        errors.name = 'Name is required';
      }

      if (!input.email?.trim()) {
        errors.email = 'Email is required';
      } else if (!input.email.includes('@')) {
        errors.email = 'Valid email is required';
      }

      if (!input.role) {
        errors.role = 'Role is required';
      }

      return errors;
    },
    []
  );

  const listUsers = useCallback(
    async (options?: { page?: number; pageSize?: number }) => {
      setIsLoading(true);
      setError(undefined);

      try {
        const response = await httpClient.get<UsersListResponse>('/api/users', {
          params: {
            page: options?.page ?? 1,
            pageSize: options?.pageSize ?? 10,
          },
        });

        setUsers(response.data);
        setTotalCount(response.total);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load users';
        setError(message);
        setUsers([]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const createUser = useCallback(
    async (input: CreateUserInput) => {
      const validationErrors = validateUserInput(input);
      if (Object.keys(validationErrors).length > 0) {
        setError('Please fix validation errors');
        return;
      }

      setIsLoading(true);
      setError(undefined);

      try {
        const newUser = await httpClient.post<User>('/api/users', input);
        setLastCreatedUser(newUser);
        // Refresh list after creation
        await listUsers();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create user';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [validateUserInput, listUsers]
  );

  const updateUser = useCallback(
    async (userId: string, input: UpdateUserInput) => {
      setIsLoading(true);
      setError(undefined);

      try {
        const updated = await httpClient.put<User>(`/api/users/${userId}`, input);
        // Update user in list
        setUsers((prevUsers) =>
          prevUsers.map((user) => (user.id === userId ? updated : user))
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update user';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      setIsLoading(true);
      setError(undefined);

      try {
        await httpClient.delete(`/api/users/${userId}`);
        // Remove user from list
        setUsers((prevUsers) => prevUsers.filter((user) => user.id !== userId));
        setTotalCount((prev) => Math.max(0, prev - 1));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete user';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const clearError = useCallback(() => {
    setError(undefined);
  }, []);

  return {
    users,
    totalCount,
    isLoading,
    error,
    lastCreatedUser,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    validateUserInput,
    clearError,
  };
}
