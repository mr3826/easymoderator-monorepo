import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LandingPage from "../LandingPage";

const { mockCatalog, mockPlans, mockConfig } = vi.hoisted(() => ({
  mockCatalog: vi.fn(),
  mockConfig: { checkoutEnabled: false },
  mockPlans: [
    { id: "shuru", code: "SHURU", name: "Shuru", description: "", billingModel: "flat_monthly", monthlyPrice: 0, yearlyPrice: 0, canPurchaseTopups: false, limits: { conversations: 100, orders: -1, products: -1 }, features: { image_understanding: true, advanced_ai: true, priority_support: true, custom_branding: false, messenger_dm_only: true }, highlights: [] },
    { id: "growth", code: "GROWTH", name: "Growth", description: "", billingModel: "flat_monthly", monthlyPrice: 999, yearlyPrice: 0, canPurchaseTopups: true, limits: { conversations: 500, orders: -1, products: -1 }, features: { image_understanding: true, advanced_ai: true, priority_support: true, custom_branding: false, messenger_dm_only: true }, highlights: [], topupPacks: [{ code: "PACK_100", conversations: 100, priceBdt: 250 }] },
    { id: "partner", code: "PARTNER", name: "Partner", description: "", billingModel: "per_order", monthlyPrice: 0, yearlyPrice: 0, canPurchaseTopups: false, limits: { conversations: -1, orders: -1, products: -1 }, features: { image_understanding: true, advanced_ai: true, priority_support: true, custom_branding: false, messenger_dm_only: true }, highlights: [], partnerOrderTiers: [{ minOrders: 300, maxOrders: 999, rateBdt: 15 }, { minOrders: 1000, maxOrders: 2999, rateBdt: 12 }, { minOrders: 3000, maxOrders: null, rateBdt: 10 }] },
  ],
}));

vi.mock("@/app/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/config")>();
  return { ...actual, isBkashEnabled: vi.fn(() => mockConfig.checkoutEnabled) };
});
vi.mock("@/api/domains/publicSubscription", () => ({ getCurrentPublicSubscriptionCatalog: mockCatalog }));
vi.mock("@/app/lib/funnel", () => ({ trackFunnelEvent: vi.fn() }));

describe("V6 LandingPage", () => {
  beforeEach(() => {
    mockCatalog.mockReset().mockResolvedValue({ plans: mockPlans, source: "live" });
    mockConfig.checkoutEnabled = false;
  });

  it("explains the supported Messenger workflow in the first screen and provides real account routes", async () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(await screen.findByText(/100 Messenger conversations each month/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /customer support.*order details/i })).toBeInTheDocument();
    const signupLinks = screen.getAllByRole("link", { name: /create your shuru account/i });
    expect(signupLinks).toHaveLength(2);
    expect(signupLinks.every((link) => link.getAttribute("href")?.match(/\/signup\?lang=en$/))).toBe(true);
    expect(screen.getByRole("link", { name: /see how it works/i })).toHaveAttribute("href", "#workflow");
    expect(screen.getByRole("link", { name: /customer support/i })).toHaveAttribute("href", "#capabilities");
    expect(screen.getByRole("link", { name: /plans/i })).toHaveAttribute("href", "#plans");
    expect(screen.getAllByRole("link", { name: /sign in/i }).every((link) => link.getAttribute("href")?.includes("/signin?lang=en"))).toBe(true);
    expect(screen.getByText(/Your business, our technology/i)).toBeInTheDocument();
  });

  it("shows the reply and order gates without inventing success states or unavailable products", async () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    const workflow = await screen.findByRole("figure", { name: /illustrative messenger reply and order review workflow/i });
    expect(workflow).toHaveTextContent(/Facebook Messenger/i);
    expect(workflow).toHaveTextContent(/draft.*not sent/i);
    expect(workflow).toHaveTextContent(/review required/i);
    expect(workflow).not.toHaveTextContent(/order confirmed|delivered/i);
    expect(screen.queryByText(/optional solutions|campaign measurement|customer insights|coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp|Instagram/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/If a capability is offered separately, it has separate pricing and access terms/i).length).toBeGreaterThan(0);
  });

  it("loads the authored story only after the visitor requests it", async () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(await screen.findByRole("button", { name: /play workflow story/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/EasyModerator workflow story/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /play workflow story/i }));
    const video = screen.getByLabelText(/EasyModerator workflow story/i) as HTMLVideoElement;
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video.querySelector("source")).toHaveAttribute("src", "/media/easymoderator-commerce-workflow-v6.mp4");
  });

  it("fails closed when the live plan catalog is incomplete", async () => {
    mockCatalog.mockResolvedValueOnce({ plans: [mockPlans[0]], source: "live" });
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent(/current plan details are unavailable/i);
    expect(screen.queryByText("৳999")).not.toBeInTheDocument();
    expect(screen.queryByText("৳0")).not.toBeInTheDocument();
  });

  it("does not mention separately priced packs while local checkout is disabled", async () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(await screen.findByText(/500 Messenger conversations each month/i)).toBeInTheDocument();
    expect(screen.queryByText(/100 conversations · ৳250 per pack/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Growth accounts only.*one-time purchase/i)).not.toBeInTheDocument();
  });

  it("discloses the current Growth pack prices when checkout is enabled", async () => {
    mockConfig.checkoutEnabled = true;
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(await screen.findByText(/100 conversations · ৳250 per pack/i)).toBeInTheDocument();
    expect(screen.getByText(/Growth accounts only.*one-time purchase/i)).toBeInTheDocument();
  });

  it("keeps the mobile navigation operable with Escape", async () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);

    expect(await screen.findByText(/100 Messenger conversations each month/i)).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /open navigation/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
});
