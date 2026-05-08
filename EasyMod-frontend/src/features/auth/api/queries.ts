/**
 * Auth API queries - Pilot example
 */

import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@shared/lib/http';
import { User, MeResponse } from '../types';

export const authQueries = {
  all: () => ['auth'] as const,
  profile: () => [...authQueries.all(), 'profile'] as const,
};

/**
 * Fetch current user profile
 */
export function useProfile() {
  return useQuery<User>({
    queryKey: authQueries.profile(),
    queryFn: async () => {
      const { data } = await httpClient.get<MeResponse>('/api/auth/me');
      return data.data;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: 1, // Retry once for auth failures
  });
}

/**
 * Alternative: Check if user is authenticated
 */
export function useIsAuthenticated() {
  const { data: user, status } = useProfile();
  return {
    isAuthenticated: !!user && status === 'success',
    user,
    isLoading: status === 'pending',
    isError: status === 'error',
  };
}
