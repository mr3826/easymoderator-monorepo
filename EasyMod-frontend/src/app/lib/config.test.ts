import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("canonical frontend origins", () => {
  it("builds app, marketing, and API URLs on their configured origins", async () => {
    vi.stubEnv("VITE_APP_URL", "https://app.easymod.tech");
    vi.stubEnv("VITE_MARKETING_URL", "https://easymod.tech");
    vi.stubEnv("VITE_API_BASE_URL", "https://api.easymod.tech");
    const { buildApiUrl, buildAppUrl, buildMarketingUrl } = await import("./config");

    expect(buildAppUrl("/signin")).toBe("https://app.easymod.tech/signin");
    expect(buildMarketingUrl("/pricing")).toBe("https://easymod.tech/pricing");
    expect(buildApiUrl("/api/orders")).toBe("https://api.easymod.tech/api/orders");
  });
});
