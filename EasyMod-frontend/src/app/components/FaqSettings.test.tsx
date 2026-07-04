import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FaqSettings from "./FaqSettings";
import { apiClient } from "@/api";

vi.mock("@/api", () => ({
  apiClient: {
    listKnowledgeFaqs: vi.fn(),
    updateKnowledgeFaq: vi.fn(),
    createKnowledgeFaq: vi.fn(),
    deleteKnowledgeFaq: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

const { tMock } = vi.hoisted(() => ({
  tMock: (key: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts === "object") {
      const values = Object.values(opts).filter((value) => value != null).join(" ");
      if (values) return `${key} ${values}`;
    }
    return key;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tMock }),
}));

describe("FaqSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.listKnowledgeFaqs).mockResolvedValue([
      {
        id: "faq-1",
        question: "What is the delivery charge?",
        answer: "Inside Dhaka delivery is 80 BDT.",
        category: "Delivery",
        confidence: 1,
        source: "manual",
        active: true,
        usageCount: 3,
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z",
      },
    ] as never);
  });

  it("loads FAQ answers from the knowledge API inside shop settings", async () => {
    render(<FaqSettings />);

    await waitFor(() => {
      expect(apiClient.listKnowledgeFaqs).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("What is the delivery charge?")).toBeInTheDocument();
    expect(screen.getByText("Inside Dhaka delivery is 80 BDT.")).toBeInTheDocument();
    expect(screen.getByText("manageShop.faqs.status.active")).toBeInTheDocument();
  });
});
