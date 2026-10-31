import { describe, expect, it } from "vitest";
import {
  getSignupSuccessPath,
  isGrowthUpgradeIntent,
} from "../signupIntent";

describe("signup intent", () => {
  it("preserves only the fixed Growth review destination and supported locale", () => {
    const params = new URLSearchParams("lang=bn&intent=growth-upgrade&returnTo=https%3A%2F%2Fevil.invalid");

    expect(isGrowthUpgradeIntent(params)).toBe(true);
    expect(getSignupSuccessPath(params, "en")).toBe(
      "/subscription?intent=growth-upgrade&lang=bn",
    );
  });

  it("sends ordinary and unsupported signup destinations to the dashboard", () => {
    expect(getSignupSuccessPath(new URLSearchParams("returnTo=https%3A%2F%2Fevil.invalid"), "en"))
      .toBe("/dashboard");
    expect(getSignupSuccessPath(new URLSearchParams("intent=anything&lang=bn"), "bn"))
      .toBe("/dashboard");
    expect(getSignupSuccessPath(new URLSearchParams("intent=growth-upgrade&lang=evil"), "en"))
      .toBe("/subscription?intent=growth-upgrade&lang=en");
  });

  it("rejects duplicate intent parameters", () => {
    const params = new URLSearchParams("intent=growth-upgrade&intent=growth-upgrade");

    expect(isGrowthUpgradeIntent(params)).toBe(false);
    expect(getSignupSuccessPath(params, "en")).toBe("/dashboard");
  });
});
