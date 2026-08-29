import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ConversationAlertBanner from "../ConversationAlertBanner";

const mocks = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  getCurrentShopId: vi.fn(),
}));

vi.mock("@/api", () => ({ apiClient: { getSubscription: mocks.getSubscription } }));
vi.mock("@/app/lib/auth", () => ({ authService: { getCurrentShopId: mocks.getCurrentShopId } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        "conversationAlert.threshold70.title": "Usage is getting busy",
        "conversationAlert.threshold70.message": `Used ${values?.used} of ${values?.limit}`,
        "conversationAlert.threshold90.title": "Allowance nearly used",
        "conversationAlert.threshold90.message": "Nearly used",
        "conversationAlert.threshold100.title": "AI replies are paused",
        "conversationAlert.threshold100.message": "Manual replies remain available",
        "conversationAlert.manage": "Manage plan",
        "conversationAlert.dismiss": "Dismiss",
      };
      return messages[key] || key;
    },
  }),
}));

const response = (used: number, exhausted = false) => ({
  subscription: {
    plan_code: "SHURU",
    conversations_limit: 100,
    conversations_used: used,
    current_period_start: "2026-08-01T00:00:00.000Z",
  },
  usage: { conversations: { used, limit: 100 } },
  effective_conversation_limit: 100,
  conversation_quota_exhausted: exhausted,
  period: { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
});

beforeEach(() => {
  mocks.getCurrentShopId.mockReturnValue("shop-1");
  mocks.getSubscription.mockResolvedValue(response(70));
  sessionStorage.clear();
});

describe("ConversationAlertBanner", () => {
  it("uses the effective allowance and shows the shared 70% threshold", async () => {
    render(<MemoryRouter><ConversationAlertBanner /></MemoryRouter>);
    expect(await screen.findByText("Usage is getting busy")).toBeInTheDocument();
    expect(screen.queryByText(/buffer|threshold_conversations/i)).not.toBeInTheDocument();
  });

  it("scopes dismissal to the shop and period threshold", async () => {
    render(<MemoryRouter><ConversationAlertBanner /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Usage is getting busy")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Usage is getting busy")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("conversation-alert:shop-1:2026-08-01T00:00:00.000Z:70")).toBe("dismissed");
  });
});
