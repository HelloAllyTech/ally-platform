import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * "Show typing on WhatsApp" is for platform admins only (it turns on read receipts too). On unless
 * switched off, and saved only as `showTyping: false`.
 */

const save = vi.fn();
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

vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  TooltipLocation: {},
}));
vi.mock("@components", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary", TERTIARY: "tertiary" },
}));
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", () => ({
  useGetChatbotSettingsQuery: () => settingsResult,
  useUpdateChatbotSettingsMutation: () => [
    (args: unknown) => {
      save(args);
      return { unwrap: async () => ({}) };
    },
    { isLoading: false },
  ],
}));

const { ChatbotSettingsTab } = await import("../ChatbotSettingsTab");

describe("ChatbotSettingsTab — Show typing", () => {
  it("is hidden from everyone but platform admins", () => {
    render(<ChatbotSettingsTab chatbotId="bot-1" chatbotName="Ally FAQ" canEdit />);
    expect(screen.queryByText("Show typing on WhatsApp")).toBeNull();
  });

  it("is on by default for a platform admin, and switching it off saves showTyping: false", () => {
    render(<ChatbotSettingsTab chatbotId="bot-1" chatbotName="Ally FAQ" canEdit isPlatformAdmin />);
    const toggle = document.getElementById("wa-org-show-typing") as HTMLInputElement;
    expect(screen.getByText("Show typing on WhatsApp")).toBeInTheDocument();
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    const saveButton = screen
      .getAllByRole("button")
      .find(b => /save/i.test(b.textContent ?? "")) as HTMLButtonElement;
    fireEvent.click(saveButton);

    expect(save).toHaveBeenCalledWith({ id: "bot-1", settings: { showTyping: false } });
  });
});
