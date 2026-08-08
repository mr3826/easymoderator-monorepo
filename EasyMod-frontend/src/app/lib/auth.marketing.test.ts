import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuthService is constructed at module import, before any route loader or
// surface guard runs. On the marketing origin that probe is a blocked
// cross-origin request, so it must not be issued at all.
const getAuthContext = vi.fn();
const isMarketingSurface = vi.fn();

vi.mock("@/api", () => ({
  apiClient: {
    getAuthContext: (...args: unknown[]) => getAuthContext(...args),
    initCsrfToken: vi.fn(),
  },
}));

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  isMarketingSurface: () => isMarketingSurface(),
}));

beforeEach(() => {
  getAuthContext.mockReset();
  getAuthContext.mockResolvedValue({ user: null, currentShop: null, allShops: [] });
  isMarketingSurface.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("auth bootstrap across product origins", () => {
  it("does not probe /auth/me on the marketing origin", async () => {
    isMarketingSurface.mockReturnValue(true);

    const { authService } = await import("./auth");
    await authService.ensureInitialized();

    expect(getAuthContext).not.toHaveBeenCalled();
    expect(authService.getState()).toMatchObject({
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it("still restores the session on the app origin", async () => {
    isMarketingSurface.mockReturnValue(false);

    const { authService } = await import("./auth");
    await authService.ensureInitialized();

    expect(getAuthContext).toHaveBeenCalledTimes(1);
  });
});
