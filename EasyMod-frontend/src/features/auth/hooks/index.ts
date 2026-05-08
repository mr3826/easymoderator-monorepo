/**
 * Auth hooks
 */

import { useAtom } from 'jotai';
import { useCallback } from 'react';
import { useProfile } from '../api/queries';

// Example: Using jotai for auth state (optional, can use Context instead)
// For now, rely on TanStack Query

/**
 * Custom hook combining queries and mutations
 * Provides complete auth state management
 */
export function useAuth() {
  const { data: user, isLoading, isError, error } = useProfile();

  const isAuthenticated = !!user && !isError;

  return {
    user,
    isAuthenticated,
    isLoading,
    isError,
    error,
  };
}

/**
 * Require auth - redirect if not authenticated
 */
export function useRequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();

  // In a real app, would redirect to /login if not authenticated
  // For now, just return the state

  return {
    isAuthenticated,
    isLoading,
  };
}
