import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The Engine field moved to the Agent tab: Settings no longer shows it, even to platform admins.
 */

// Stable across renders, as RTK Query's cached result is.
const settingsResult = {
  data: {
    chatbotId: "bot-1",
    defaults: {
      enabled: true,
      crisisClassifierEnabled: true,
      consentRequired: true,
      helplineNumbers: "",
      rateLimit: { perMinute: 6, perHour: 30, perDay: 100 },
      retrieval: { minSimilarity: 0.35, declineSimilarity: 0.42 },
      maxCitations: 3,
      conversationIdleMinutes: 1440,
    },
    overrides: {},
    effective: {},
  },
  isLoading: false,
  isError: false,
  refetch: () => undefined,
};

// The real copy, without the whole constants barrel (which cannot load in isolation).
vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  TooltipLocation: {},
}));

vi.mock("@components", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary" },
}));
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@api", () => ({
  useGetChatbotSettingsQuery: () => settingsResult,
  useUpdateChatbotSettingsMutation: () => [vi.fn(), { isLoading: false }],
}));

const { ChatbotSettingsTab } = await import("../ChatbotSettingsTab");

const renderTab = () =>
  render(<ChatbotSettingsTab chatbotId="bot-1" chatbotName="Ally FAQ" canEdit />);

describe("ChatbotSettingsTab — Engine", () => {
  it("is not here: it lives on the Agent tab", () => {
    renderTab();
    expect(screen.queryByText("Engine")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Shadow/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Agent mode")).not.toBeInTheDocument();
  });
});
