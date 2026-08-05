import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("public API client", () => {
  it("always omits credentials from marketing writes", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.easymod.tech");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { publicApiPost } = await import("./public-client");

    await publicApiPost("/api/partner/apply", { businessName: "Shop" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.easymod.tech/api/partner/apply",
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
  });
});
