import { describe, expect, it } from "vitest";
import {
  USAGE_THRESHOLDS,
  getCrossedUsageThresholds,
  usagePercentage,
} from "../usageThresholds";

describe("usage thresholds", () => {
  it("uses the shared 70/90/100 thresholds", () => {
    expect(USAGE_THRESHOLDS).toEqual([70, 90, 100]);
    expect(getCrossedUsageThresholds(69, 91)).toEqual([70, 90]);
    expect(getCrossedUsageThresholds(90, 100, new Set([100]))).toEqual([]);
  });

  it("does not calculate percentages for unlimited plans", () => {
    expect(usagePercentage(1000, -1)).toBe(0);
    expect(usagePercentage(70, 100)).toBe(70);
    expect(usagePercentage(101, 100)).toBe(100);
  });
});
