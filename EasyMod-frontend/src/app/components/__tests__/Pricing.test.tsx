import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Pricing from "../Pricing";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: any) => {
      if (options?.returnObjects) {
        if (key === "pricing.planFeatures.shuru") return ["100 customer conversations each month"];
        if (key === "pricing.planFeatures.growth") return ["500 customer conversations each month"];
        if (key === "pricing.planFeatures.partner") return ["300+ delivered orders in 30 days to qualify"];
        return [];
      }
      if (typeof options === "string") return options;
      const values: Record<string, string> = {
        "pricing.plans.shuru.name": "Shuru",
        "pricing.plans.growth.name": "Growth",
        "pricing.plans.partner.name": "Partner",
        "pricing.plans.shuru.description": "Free forever",
        "pricing.plans.growth.description": "Full assistant",
        "pricing.plans.partner.description": "Pay by delivered order",
        "pricing.plans.shuru.priceNote": "Free forever",
        "pricing.plans.growth.priceNote": "Monthly",
        "pricing.plans.partner.priceNote": "Flat bands",
        "pricing.plans.shuru.cta": "Create free account",
        "pricing.plans.growth.cta": "Start with Growth",
        "pricing.plans.partner.cta": "Apply for Partner",
        "pricing.perMonth": "/mo",
        "pricing.partnerPriceUnit": "upfront",
        "pricing.mostPopular": "Most Popular",
        "pricing.partnerEligibleBadge": "300+ delivered orders",
        "pricing.limits.conversationsPerMonth": `${options?.count} conversations each month`,
        "pricing.limits.unlimitedOrders": "Unlimited orders",
        "pricing.limits.unlimitedProducts": "Unlimited products",
        "pricing.limits.manualInbox": "Manual replies available",
        "pricing.limits.deliveredOrders": "300+ delivered orders",
      };
      return values[key] || options?.defaultValue || key;
    },
  }),
}));

vi.mock("@/api/domains/subscription", () => ({
  getSubscriptionPlans: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/shared/lib/http/public-client", () => ({ publicApiPost: vi.fn() }));

describe("Pricing", () => {
  it("renders all three server-driven commercial cards", async () => {
    render(<MemoryRouter><Pricing /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("Shuru")).toBeInTheDocument());
    expect(screen.getByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("Partner")).toBeInTheDocument();
    expect(screen.getByText("100 customer conversations each month")).toBeInTheDocument();
    expect(screen.getByText("500 customer conversations each month")).toBeInTheDocument();
    expect(screen.getByText("Create free account")).toBeInTheDocument();
    expect(screen.getByText("Apply for Partner")).toBeInTheDocument();
  });
});
