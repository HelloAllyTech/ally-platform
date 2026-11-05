import React from "react";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Engine field (v1 / Shadow / v2) changes who answers real people, so only platform admins see
 * it — the API refuses everyone else too. It also says when the platform kill switch is holding a
 * v2 bot on v1.
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
  useUpdateChatbotMutation: () => [vi.fn(), { isLoading: false }],
}));

const { ChatbotSettingsTab } = await import("../ChatbotSettingsTab");

const renderTab = () =>
  render(<ChatbotSettingsTab chatbotId="bot-1" chatbotName="Ally FAQ" canEdit />);

describe("ChatbotSettingsTab — Engine", () => {
  beforeEach(() => {
    canCreate = false;
    bot = { id: "bot-1", runtime: "v1", effectiveRuntime: "v1", features: {} };
  });

  it("is hidden from anyone who is not a platform admin", () => {
    renderTab();
    expect(screen.queryByText("Engine")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Shadow/)).not.toBeInTheDocument();
  });

  it("shows platform admins v1, Shadow and v2 with the bot's setting selected", () => {
    canCreate = true;
    bot = { ...bot, runtime: "shadow", effectiveRuntime: "shadow" };
    renderTab();
    expect(screen.getByText("Engine")).toBeInTheDocument();
    expect(screen.getByLabelText(/^v1 —/)).not.toBeChecked();
    expect(screen.getByLabelText(/^Shadow —/)).toBeChecked();
    expect(screen.getByLabelText(/^v2 —/)).not.toBeChecked();
    expect(screen.queryByText(/turned off in Defaults/)).not.toBeInTheDocument();
  });

  it("says when the new engine is turned off platform-wide", () => {
    canCreate = true;
    bot = { ...bot, runtime: "v2", effectiveRuntime: "v1" };
    renderTab();
    expect(screen.getByText(/turned off in Defaults/)).toBeInTheDocument();
  });
});
