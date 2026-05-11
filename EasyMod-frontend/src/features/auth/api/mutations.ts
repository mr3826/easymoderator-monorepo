/**
 * Auth API mutations - Pilot example
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient, NormalizedApiError } from '@shared/lib/http';
import { 
  LoginInput, 
  RegisterInput, 
  User, 
  LoginResponse, 
  RegisterResponse 
} from '../types';
import { authQueries } from './queries';

/**
 * Login mutation
 */
export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation<User, NormalizedApiError, LoginInput>({
    mutationFn: async (input) => {
      const { data } = await httpClient.post<LoginResponse>('/api/auth/signin', input);

      // Auth token is set as an httpOnly cookie by the backend — no localStorage needed.
      if (!data?.success || !data.data?.user?.id) {
        throw new Error('Invalid auth response from server');
      }

      return data.data.user;
    },
    onSuccess: (user) => {
      // Set profile in cache
      queryClient.setQueryData(authQueries.profile(), user);
    },
    onError: (error) => {
      console.error('Login failed:', error.message);
    },
  });
}

/**
 * Register mutation
 */
export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation<User, NormalizedApiError, RegisterInput>({
    mutationFn: async (input) => {
      const { data } = await httpClient.post<RegisterResponse>('/api/auth/signup', input);
      return data.data!.user;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(authQueries.profile(), user);
    },
  });
}

/**
 * Logout mutation
 */
export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await httpClient.post('/api/auth/logout', {});
    },
    onSuccess: () => {
      // Token cleared server-side (cookie invalidated by /logout endpoint).
      // Clear local query cache.
      queryClient.removeQueries({ queryKey: authQueries.all() });
    },
  });
}

/**
 * Refresh token mutation
 */
export function useRefreshToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Refresh token is sent automatically via httpOnly cookie.
      // New access token is returned as a cookie; no localStorage involved.
      const { data } = await httpClient.post<LoginResponse>('/api/auth/refresh', {});
      return data.data!.user;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(authQueries.profile(), user);
    },
  });
}
