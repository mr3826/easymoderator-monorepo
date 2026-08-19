import { beforeEach, describe, expect, it, vi } from "vitest";

const { publicApiRequest } = vi.hoisted(() => ({
  publicApiRequest: vi.fn(),
}));

vi.mock("@/shared/lib/http/public-client", () => ({
  publicApiRequest,
}));

import { trackFunnelEvent } from "./funnel";

describe("funnel tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    publicApiRequest.mockResolvedValue({ success: true });
  });

  it("marks a once-only event only after the server accepts it", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    publicApiRequest.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const request = trackFunnelEvent(
      "signup_started",
      { surface: "signup" },
      { onceKey: "signup_started" },
    );

    expect(localStorage.getItem("easymod:funnel_once:signup_started")).toBeNull();
    expect(publicApiRequest).toHaveBeenCalledWith(
      "/api/analytics/funnel",
      expect.objectContaining({
        method: "POST",
        headers: { "Idempotency-Key": "funnel-signup_started-signup_started" },
      }),
    );

    resolveRequest?.({ success: true });
    await request;

    expect(localStorage.getItem("easymod:funnel_once:signup_started")).toBe("1");
  });

  it("leaves the once marker unset after a failed request so a retry can succeed", async () => {
    publicApiRequest
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ success: true });

    await trackFunnelEvent("signup_started", {}, { onceKey: "signup_started" });
    expect(localStorage.getItem("easymod:funnel_once:signup_started")).toBeNull();

    await trackFunnelEvent("signup_started", {}, { onceKey: "signup_started" });

    expect(publicApiRequest).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("easymod:funnel_once:signup_started")).toBe("1");
  });
});
