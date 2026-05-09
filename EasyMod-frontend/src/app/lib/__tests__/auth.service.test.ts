/**
 * AuthService — Vitest Unit Tests
 *
 * Strategy:
 *  - Mock apiClient and queryClient BEFORE instantiating AuthService so the
 *    constructor's initializeAuth() call hits mock implementations.
 *  - Create `new AuthService()` in every test to avoid cross-test state leakage.
 *    Never import the singleton `authService`.
 *  - Call `await service.ensureInitialized()` after construction so async
 *    constructor work has settled before assertions run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth';

// ── Hoist mock factories so they are available inside vi.mock() ───────────────
const {
  mockGetAuthContext,
  mockSignin,
  mockSignup,
  mockSwitchShop,
  mockGetShops,
  mockCreateShop,
  mockRefreshToken,
  mockLogout,
  mockInvalidateQueries,
} = vi.hoisted(() => ({
  mockGetAuthContext:    vi.fn(),
  mockSignin:           vi.fn(),
  mockSignup:           vi.fn(),
  mockSwitchShop:       vi.fn(),
  mockGetShops:         vi.fn(),
  mockCreateShop:       vi.fn(),
  mockRefreshToken:     vi.fn(),
  mockLogout:           vi.fn(),
  mockInvalidateQueries: vi.fn(),
}));

vi.mock('@/api', () => ({
  apiClient: {
    getAuthContext:  mockGetAuthContext,
    signin:          mockSignin,
    signup:          mockSignup,
    switchShop:      mockSwitchShop,
    getShops:        mockGetShops,
    createShop:      mockCreateShop,
    refreshToken:    mockRefreshToken,
    logout:          mockLogout,
  },
}));

vi.mock('../queryClient', () => ({
  queryClient: { invalidateQueries: mockInvalidateQueries },
}));

// ── Shared test fixtures ──────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  full_name: 'Test User',
};

const mockShopOwner = {
  id: 'shop-1',
  unique_code: 'SHOP1',
  shop_name: 'Test Shop',
  role: 'owner' as const,
};

const mockShopStaff = {
  id: 'shop-2',
  unique_code: 'SHOP2',
  shop_name: 'Another Shop',
  role: 'staff' as const,
};

const mockAuthContext = {
  user: mockUser,
  currentShop: mockShopOwner,
  allShops: [mockShopOwner, mockShopStaff],
};

const mockAuthResponse = {
  user: mockUser,
  currentShop: mockShopOwner,
  allShops: [mockShopOwner, mockShopStaff],
};

// ── Helper: build a fresh, fully-initialised AuthService ─────────────────────
const makeService = async (): Promise<AuthService> => {
  const svc = new AuthService();
  await svc.ensureInitialized();
  return svc;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy-path for initializeAuth
    mockGetAuthContext.mockResolvedValue(mockAuthContext);
  });

  // ── 1. initializeAuth — success ───────────────────────────────────────────
  it('sets isAuthenticated=true and populates user/shops on successful initializeAuth', async () => {
    const service = await makeService();
    const state = service.getState();

    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.user).toEqual(mockUser);
    expect(state.currentShop).toEqual(mockShopOwner);
    expect(state.allShops).toHaveLength(2);
    expect(mockGetAuthContext).toHaveBeenCalledTimes(1);
  });

  // ── 2. initializeAuth — failure ──────────────────────────────────────────
  it('sets isAuthenticated=false and clears state when initializeAuth fails', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('Unauthorized'));

    const service = await makeService();
    const state = service.getState();

    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.user).toBeNull();
    expect(state.currentShop).toBeNull();
    expect(state.allShops).toHaveLength(0);
  });

  // ── 3. initializeAuth race guard ─────────────────────────────────────────
  it('does not overwrite an already-authenticated session when initializeAuth fails late', async () => {
    // Simulate: getAuthContext resolves AFTER signin() has already set isAuthenticated=true.
    // We do this by having getAuthContext reject, but manually setting isAuthenticated first
    // via a listener that patches internal state through signin.

    // Arrange: getAuthContext rejects, signin resolves immediately
    mockGetAuthContext.mockRejectedValueOnce(new Error('Slow /me failed'));
    mockSignin.mockResolvedValue(mockAuthResponse);

    // We need initializeAuth to see isAuthenticated=true in the catch block.
    // Achieve this by calling signin() before ensureInitialized() settles.
    const service = new AuthService();
    // signin concurrently before init settles
    await service.signin({ email: 'test@example.com', password: 'pass' });
    await service.ensureInitialized();

    const state = service.getState();
    // Authenticated session should survive
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(mockUser);
    expect(state.isLoading).toBe(false);
  });

  // ── 4. signin — success ──────────────────────────────────────────────────
  it('updates state with user/shops and sets isAuthenticated=true on signin success', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    mockSignin.mockResolvedValue(mockAuthResponse);

    const service = await makeService();
    await service.signin({ email: 'test@example.com', password: 'secret' });

    const state = service.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.user).toEqual(mockUser);
    expect(state.currentShop).toEqual(mockShopOwner);
    expect(state.allShops).toHaveLength(2);
    expect(mockSignin).toHaveBeenCalledWith({ email: 'test@example.com', password: 'secret' });
  });

  // ── 5. signin — failure ──────────────────────────────────────────────────
  it('resets isLoading to false and re-throws on signin failure', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    const signinError = new Error('Invalid credentials');
    mockSignin.mockRejectedValueOnce(signinError);

    const service = await makeService();

    await expect(
      service.signin({ email: 'bad@example.com', password: 'wrong' })
    ).rejects.toThrow('Invalid credentials');

    expect(service.getState().isLoading).toBe(false);
    expect(service.getState().isAuthenticated).toBe(false);
  });

  // ── 6. signup — success ──────────────────────────────────────────────────
  it('updates state with user/shops and sets isAuthenticated=true on signup success', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    mockSignup.mockResolvedValue(mockAuthResponse);

    const service = await makeService();
    await service.signup({
      email: 'new@example.com',
      password: 'pass123',
      full_name: 'New User',
    });

    const state = service.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.user).toEqual(mockUser);
    expect(state.currentShop).toEqual(mockShopOwner);
    expect(state.allShops).toHaveLength(2);
  });

  // ── 7. signup — failure ──────────────────────────────────────────────────
  it('resets isLoading to false and re-throws on signup failure', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    mockSignup.mockRejectedValueOnce(new Error('Email already taken'));

    const service = await makeService();

    await expect(
      service.signup({ email: 'dup@example.com', password: 'pass', full_name: 'Dup' })
    ).rejects.toThrow('Email already taken');

    expect(service.getState().isLoading).toBe(false);
  });

  // ── 8. logout ────────────────────────────────────────────────────────────
  it('calls apiClient.logout and clears all auth state', async () => {
    mockLogout.mockResolvedValue(undefined);

    const service = await makeService();
    expect(service.getState().isAuthenticated).toBe(true); // precondition

    await service.logout();

    const state = service.getState();
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.currentShop).toBeNull();
    expect(state.allShops).toHaveLength(0);
    expect(state.isLoading).toBe(false);
  });

  // ── 9. switchShop — found ────────────────────────────────────────────────
  it('calls switchShop API and updates currentShop when shop exists in allShops', async () => {
    mockSwitchShop.mockResolvedValue({ currentShop: mockShopStaff });
    mockInvalidateQueries.mockResolvedValue(undefined);

    const service = await makeService();
    await service.switchShop('shop-2');

    expect(mockSwitchShop).toHaveBeenCalledWith('shop-2');
    expect(service.getState().currentShop).toEqual(mockShopStaff);
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  // ── 10. switchShop — not found ───────────────────────────────────────────
  it('throws "Shop not found" when switching to an unknown shopId', async () => {
    const service = await makeService();

    await expect(service.switchShop('nonexistent-shop')).rejects.toThrow('Shop not found');
    expect(mockSwitchShop).not.toHaveBeenCalled();
  });

  // ── 11. subscribe — listener notified ────────────────────────────────────
  it('notifies subscriber on every state change', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    mockSignin.mockResolvedValue(mockAuthResponse);

    const service = await makeService();
    const listener = vi.fn();
    service.subscribe(listener);

    await service.signin({ email: 'test@example.com', password: 'pass' });

    // signin calls setAuthState twice: isLoading=true, then the full auth state
    expect(listener).toHaveBeenCalledTimes(2);
    // Final call should have authenticated state
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0];
    expect(lastCall.isAuthenticated).toBe(true);
  });

  // ── 12. unsubscribe — removed listener not called ────────────────────────
  it('does not call listener after unsubscribe', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    mockLogout.mockResolvedValue(undefined);

    const service = await makeService();
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    unsubscribe();

    await service.logout();

    expect(listener).not.toHaveBeenCalled();
  });

  // ── 13. hasPermission — owner ────────────────────────────────────────────
  it('returns true for manage_products when shop role is owner', async () => {
    const service = await makeService();
    // currentShop is mockShopOwner (role: 'owner')
    expect(service.hasPermission('manage_products')).toBe(true);
    expect(service.hasPermission('view_reports')).toBe(true);
  });

  // ── 14. hasPermission — staff ────────────────────────────────────────────
  it('returns false for manage_products and view_reports when role is staff', async () => {
    mockGetAuthContext.mockResolvedValueOnce({
      ...mockAuthContext,
      currentShop: mockShopStaff,
    });
    const service = await makeService();

    expect(service.hasPermission('manage_products')).toBe(false);
    expect(service.hasPermission('view_reports')).toBe(false);
    // staff can manage orders
    expect(service.hasPermission('manage_orders')).toBe(true);
  });

  // ── 15. hasPermission — no shop ──────────────────────────────────────────
  it('returns false for any permission when there is no currentShop', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    const service = await makeService();
    // isAuthenticated=false, currentShop=null
    expect(service.hasPermission('manage_products')).toBe(false);
    expect(service.hasPermission('manage_orders')).toBe(false);
    expect(service.hasPermission('view_reports')).toBe(false);
  });

  // ── 16. getCurrentShopId ─────────────────────────────────────────────────
  it('returns currentShop.id when authenticated', async () => {
    const service = await makeService();
    expect(service.getCurrentShopId()).toBe('shop-1');
  });

  it('returns null for getCurrentShopId when not authenticated', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    const service = await makeService();
    expect(service.getCurrentShopId()).toBeNull();
  });

  // ── 17. refreshShops ─────────────────────────────────────────────────────
  it('updates allShops and preserves currentShop on refreshShops', async () => {
    const updatedShops = [
      { ...mockShopOwner, shop_name: 'Updated Name' },
      mockShopStaff,
    ];
    mockGetShops.mockResolvedValue(updatedShops);

    const service = await makeService();
    await service.refreshShops();

    expect(mockGetShops).toHaveBeenCalledTimes(1);
    expect(service.getState().allShops).toHaveLength(2);
    expect(service.getState().allShops[0].shop_name).toBe('Updated Name');
  });

  it('does nothing in refreshShops when not authenticated', async () => {
    mockGetAuthContext.mockRejectedValueOnce(new Error('not logged in'));
    const service = await makeService();

    await service.refreshShops();
    expect(mockGetShops).not.toHaveBeenCalled();
  });

  // ── 18. createShop ───────────────────────────────────────────────────────
  it('creates a shop, switches to it, refreshes shops, and returns the new shop', async () => {
    const newShop = { id: 'shop-new', unique_code: 'SHOPNEW', shop_name: 'Brand New', role: 'owner' as const };
    mockCreateShop.mockResolvedValue(newShop);
    mockSwitchShop.mockResolvedValue({ currentShop: newShop });
    mockGetShops.mockResolvedValue([mockShopOwner, mockShopStaff, newShop]);
    mockInvalidateQueries.mockResolvedValue(undefined);

    const service = await makeService();
    const result = await service.createShop({ shop_name: 'Brand New' });

    expect(result).toEqual(newShop);
    expect(mockCreateShop).toHaveBeenCalledWith({ shop_name: 'Brand New' });
    expect(mockSwitchShop).toHaveBeenCalledWith('shop-new');
    expect(mockGetShops).toHaveBeenCalled();
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(service.getState().currentShop).toEqual(newShop);
    expect(service.getState().allShops).toHaveLength(3);
  });

  // ── 19. isAuthenticated() method ─────────────────────────────────────────
  it('isAuthenticated() method mirrors state.isAuthenticated', async () => {
    const service = await makeService();
    expect(service.isAuthenticated()).toBe(true);

    mockLogout.mockResolvedValue(undefined);
    await service.logout();
    expect(service.isAuthenticated()).toBe(false);
  });

  // ── 20. getCurrentShop ───────────────────────────────────────────────────
  it('getCurrentShop() returns currentShop from state', async () => {
    const service = await makeService();
    expect(service.getCurrentShop()).toEqual(mockShopOwner);
  });
});
