import { useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { httpClient } from './client';

/**
 * Sync the current shop from AuthProvider to the centralized HTTP client.
 * This is the runtime integration for apps using AuthProvider instead of ShopProvider.
 */
export function useAuthHttpShopId(): void {
  const { currentShop } = useAuth();

  useEffect(() => {
    httpClient.setShopId(currentShop?.id ?? null);
  }, [currentShop?.id]);
}

export default useAuthHttpShopId;
