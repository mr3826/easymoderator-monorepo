/**
 * Hook: Sync ShopContext with HTTP Client
 * 
 * Automatically injects the current shop ID into all HTTP requests
 * Call this hook once in your App component (inside ShopProvider)
 * 
 * Usage:
 * function App() {
 *   useHttpShopId(); // Syncs shop context with HTTP client
 *   return <Routes>...</Routes>;
 * }
 */

import { useEffect } from 'react';
import { useShop } from '@/shared/context/ShopContext';
import { httpClient } from './client';

/**
 * Sync HTTP client shop ID with ShopContext
 * Updates whenever currentShopId changes
 * 
 * Should be called once at app level (inside ShopProvider + AuthProvider)
 */
export function useHttpShopId(): void {
  const { currentShopId } = useShop();

  useEffect(() => {
    // Update HTTP client whenever shop changes
    httpClient.setShopId(currentShopId);
  }, [currentShopId]);
}

export default useHttpShopId;
