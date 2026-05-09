import { apiClient } from '@/api';
import type { User, Shop, AuthResponse, SigninRequest, SignupRequest, CreateShopRequest } from '@/api/types';
import { queryClient } from './queryClient';

// Auth state interface
export interface AuthState {
  user: User | null;
  currentShop: Shop | null;
  allShops: Shop[];
  isAuthenticated: boolean;
  isLoading: boolean;
}

export class AuthService {
  private authState: AuthState = {
    user: null,
    currentShop: null,
    allShops: [],
    isAuthenticated: false,
    isLoading: true,
  };

  private listeners: ((state: AuthState) => void)[] = [];
  private initialization: Promise<void>;

  constructor() {
    this.initialization = this.initializeAuth();
  }

  private async initializeAuth() {
    try {
      const authContext = await apiClient.getAuthContext();
      this.setAuthState({
        user: authContext.user,
        currentShop: authContext.currentShop,
        allShops: authContext.allShops,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      // Guard: if signin() completed concurrently while this /me was in-flight,
      // don't overwrite the authenticated session — just clear the loading flag.
      if (this.authState.isAuthenticated) {
        this.setAuthState({ isLoading: false });
      } else {
        this.setAuthState({
          user: null,
          currentShop: null,
          allShops: [],
          isAuthenticated: false,
          isLoading: false,
        });
      }
    }
  }

  async ensureInitialized(): Promise<void> {
    return this.initialization;
  }

  private setAuthState(state: Partial<AuthState>) {
    this.authState = { ...this.authState, ...state };
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.authState));
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  getState(): AuthState {
    return this.authState;
  }

  async signin(credentials: SigninRequest): Promise<void> {
    try {
      this.setAuthState({ isLoading: true });
      const authData = await apiClient.signin(credentials);

      this.setAuthState({
        user: authData.user,
        currentShop: authData.currentShop,
        allShops: authData.allShops,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      this.setAuthState({ isLoading: false });
      throw error;
    }
  }

  async signup(userData: SignupRequest): Promise<void> {
    try {
      this.setAuthState({ isLoading: true });
      const authData = await apiClient.signup(userData);

      this.setAuthState({
        user: authData.user,
        currentShop: authData.currentShop,
        allShops: authData.allShops,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      this.setAuthState({ isLoading: false });
      throw error;
    }
  }

  async switchShop(shopId: string): Promise<void> {
    const shop = this.authState.allShops.find(s => s.id === shopId);
    if (!shop) {
      throw new Error('Shop not found');
    }

    const result = await apiClient.switchShop(shopId);
    this.setAuthState({ currentShop: result.currentShop });
    await queryClient.invalidateQueries();
  }

  async refreshShops(): Promise<void> {
    if (!this.authState.isAuthenticated) return;

    const shops = await apiClient.getShops();
    const currentShop = this.authState.currentShop && shops.find(s => s.id === this.authState.currentShop?.id);

    this.setAuthState({
      allShops: shops,
      currentShop: currentShop || this.authState.currentShop || shops[0] || null,
    });
  }

  async createShop(payload: CreateShopRequest): Promise<Shop> {
    const newShop = await apiClient.createShop(payload);
    const switchResult = await apiClient.switchShop(newShop.id);
    const shops = await apiClient.getShops();

    this.setAuthState({
      allShops: shops,
      currentShop: switchResult.currentShop,
    });

    await queryClient.invalidateQueries();

    return newShop;
  }

  async refreshToken(): Promise<void> {
    await apiClient.refreshToken();
  }

  async logout(): Promise<void> {
    // Call backend to blacklist the token and clear httpOnly cookies
    await apiClient.logout();

    this.setAuthState({
      user: null,
      currentShop: null,
      allShops: [],
      isAuthenticated: false,
      isLoading: false,
    });
  }

  // Utility methods
  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  getCurrentShop(): Shop | null {
    return this.authState.currentShop;
  }

  getCurrentShopId(): string | null {
    return this.authState.currentShop?.id || null;
  }

  hasPermission(permission: string): boolean {
    // TODO: Implement proper permission checking based on role
    if (!this.authState.currentShop) return false;

    const role = this.authState.currentShop.role;
    // Simple role-based permissions
    switch (permission) {
      case 'manage_products':
        return ['owner', 'admin'].includes(role);
      case 'manage_orders':
        return ['owner', 'admin', 'staff'].includes(role);
      case 'view_reports':
        return ['owner', 'admin'].includes(role);
      default:
        return false;
    }
  }
}

// Export singleton instance
export const authService = new AuthService();

// Export convenience functions
export const logout = () => authService.logout();
