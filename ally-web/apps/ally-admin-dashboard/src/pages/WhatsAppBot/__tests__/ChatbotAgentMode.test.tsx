import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agent mode (Agents v2): a toggle under the Engine field, for platform admins only and only for a
 * v2 bot. It saves the `features.agent` flag through the same PATCH as the engine.
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

let canCreate = false;
const updateSpy = vi.fn(() => ({ unwrap: async () => ({}) }));
let bot: Record<string, unknown> = {};

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
  useGetChatbotsQuery: () => ({ data: { chatbots: [], canCreate } }),
  useGetChatbotQuery: () => ({ data: bot }),
  useUpdateChatbotMutation: () => [updateSpy, { isLoading: false }],
}));

const { ChatbotSettingsTab } = await import("../ChatbotSettingsTab");

const renderTab = () =>
  render(<ChatbotSettingsTab chatbotId="bot-1" chatbotName="Ally FAQ" canEdit />);

describe("ChatbotSettingsTab — Agent mode", () => {
  beforeEach(() => {
    canCreate = true;
    updateSpy.mockClear();
    bot = { id: "bot-1", runtime: "v2", effectiveRuntime: "v2", features: {} };
  });

  it("is hidden from anyone who is not a platform admin", () => {
    canCreate = false;
    renderTab();
    expect(screen.queryByLabelText("Agent mode")).not.toBeInTheDocument();
  });

  it("is shown only while the engine is v2", () => {
    bot = { ...bot, runtime: "v1", effectiveRuntime: "v1" };
    renderTab();
    expect(screen.queryByLabelText("Agent mode")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^v2 —/));
    expect(screen.getByLabelText("Agent mode")).toBeInTheDocument();
  });

  it("shows the saved flag and saves only what changed", () => {
    renderTab();
    const toggle = screen.getByLabelText("Agent mode");
    expect(toggle).not.toBeChecked();
    const save = screen.getByRole("button", { name: "Save engine" });
    expect(save).toBeDisabled();

    fireEvent.click(toggle);
    fireEvent.click(save);
    expect(updateSpy).toHaveBeenCalledWith({ id: "bot-1", features: { agent: true } });
  });

  it("starts on when the bot already has it", () => {
    bot = { ...bot, features: { agent: true } };
    renderTab();
    expect(screen.getByLabelText("Agent mode")).toBeChecked();
  });
});
