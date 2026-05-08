/**
 * Shop Context & Provider
 * 
 * Manages current shop selection for multi-tenant users
 * All queries automatically scoped to current shop via HTTP client interceptor
 * 
 * Usage:
 *   const { currentShopId, shops, switchShop } = useShop();
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';

export interface ShopInfo {
  id: string;
  name: string;
  email: string;
  role?: 'OWNER' | 'MANAGER' | 'STAFF'; // User's role in this shop
  isActive: boolean;
}

interface ShopContextValue {
  /** Currently selected shop ID (used in all API calls) */
  currentShopId: string | null;

  /** All shops user has access to */
  shops: ShopInfo[];

  /** Current shop details */
  currentShop: ShopInfo | null;

  /** Switch to different shop (updates localStorage + API calls) */
  switchShop: (shopId: string) => void;

  /** Is loading shops */
  isLoading: boolean;

  /** Error loading shops */
  error: string | null;
}

const ShopContext = createContext<ShopContextValue | undefined>(undefined);

interface ShopProviderProps {
  children: ReactNode;
  shops: ShopInfo[]; // From useAuth or initial fetch
  defaultShopId?: string;
}

/**
 * Provider component - wrap app at high level
 * Should be inside AuthProvider (uses useAuth)
 */
export function ShopProvider({ children, shops, defaultShopId }: ShopProviderProps) {
  // Try to get from localStorage first, fallback to default or first shop
  const [currentShopId, setCurrentShopId] = useState<string | null>(() => {
    if (!shops || shops.length === 0) return null;

    const stored = localStorage.getItem('currentShopId');
    if (stored && shops.find((s) => s.id === stored)) {
      return stored;
    }

    return defaultShopId || shops[0]?.id || null;
  });

  const currentShop = shops.find((s) => s.id === currentShopId) || null;

  const switchShop = useCallback(
    (shopId: string) => {
      if (!shops.find((s) => s.id === shopId)) {
        console.warn(`Shop ${shopId} not found in user's shops`);
        return;
      }

      setCurrentShopId(shopId);
      localStorage.setItem('currentShopId', shopId);

      // Invalidate all queries when switching shops
      // (Handled by HTTP client interceptor)
      if (typeof window !== 'undefined') {
        // Dispatch custom event for query client to listen to
        window.dispatchEvent(new CustomEvent('shopChanged', { detail: { shopId } }));
      }
    },
    [shops]
  );

  const value: ShopContextValue = {
    currentShopId,
    shops,
    currentShop,
    switchShop,
    isLoading: false,
    error: null,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

/**
 * Hook: Get current shop context
 * Throws if used outside ShopProvider
 */
export function useShop(): ShopContextValue {
  const context = useContext(ShopContext);
  if (!context) {
    throw new Error('useShop must be used within <ShopProvider>');
  }
  return context;
}

/**
 * Convenience hook: Get only current shop ID
 * Used to scope all queries
 */
export function useShopId(): string {
  const { currentShopId } = useShop();

  if (!currentShopId) {
    throw new Error(
      'No shop selected. Ensure ShopProvider is initialized with shops.'
    );
  }

  return currentShopId;
}

/**
 * Hook: Get current shop role (user's role in the shop)
 * Different from global UserRole
 */
export function useShopRole(): string | undefined {
  const { currentShop } = useShop();
  return currentShop?.role;
}
