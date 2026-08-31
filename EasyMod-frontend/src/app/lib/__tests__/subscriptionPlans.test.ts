import { describe, expect, it } from "vitest";
import { subscriptionPlans, TOPUP_PACK_FALLBACK, PARTNER_ORDER_TIERS_FALLBACK } from "../subscriptionPlans";

describe("subscription plan fallback", () => {
  it("pins the marketing fallback to the commercial model", () => {
    expect(subscriptionPlans.map((plan) => plan.code)).toEqual(["SHURU", "GROWTH", "PARTNER"]);
    expect(subscriptionPlans[0]).toMatchObject({ monthlyPrice: 0, yearlyPrice: 0 });
    expect(subscriptionPlans[0].limits.conversations).toBe(100);
    expect(subscriptionPlans[1]).toMatchObject({ monthlyPrice: 999, yearlyPrice: 9990 });
    expect(subscriptionPlans[1].limits.conversations).toBe(500);
    expect(subscriptionPlans[2].limits.conversations).toBe(-1);
    expect(subscriptionPlans[2].partnerOrderTiers).toEqual(PARTNER_ORDER_TIERS_FALLBACK);
    expect(subscriptionPlans[0].features).toEqual(subscriptionPlans[1].features);
    expect(subscriptionPlans[1].features).toEqual(subscriptionPlans[2].features);
  });

  it("pins Growth top-ups to PACK_100, PACK_300, and PACK_700", () => {
    expect(subscriptionPlans.find((plan) => plan.code === "GROWTH")?.topupPacks).toEqual(TOPUP_PACK_FALLBACK);
  });
});
