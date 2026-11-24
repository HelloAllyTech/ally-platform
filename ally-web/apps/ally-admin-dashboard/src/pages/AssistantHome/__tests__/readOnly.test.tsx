import React from "react";

import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import "@constants";

import { ChatbotMemberRole as R, ChatbotStatus, type Chatbot } from "@types";

const mockBot: Partial<Chatbot> = {
  id: "b1",
  name: "Sunrise",
  status: ChatbotStatus.LIVE,
  myRole: R.OWNER,
  connectors: [],
  persona: {},
  stats: {
    messages: 0,
    people: 0,
    answered: 0,
    declined: 0,
    openUnanswered: 0,
    lastMessageAt: null,
  },
};

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetChatbotQuery: () => ({ data: mockBot, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetAssistantHomeQuery: () => ({
    data: { canEdit: true, fields: {}, safety: {} },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetBotPageQuery: () => ({ data: { saved: true, link: "https://chat.example/b/sunrise" } }),
  useGetChatbotsQuery: () => ({ data: { chatbots: [mockBot] } }),
}));

// The section stub reports exactly what the home hands every section.
vi.mock("../sections/Overview", () => ({
  OverviewSection: (p: { canEdit: boolean; canManage: boolean; tryIt?: unknown }) => (
    <div data-testid="flags">{`edit=${p.canEdit} manage=${p.canManage} try=${!!p.tryIt}`}</div>
  ),
}));
vi.mock("../sections/Build", () => ({ BuildSection: () => <div /> }));
vi.mock("../sections/Conversations", () => ({ ConversationsSection: () => <div /> }));
vi.mock("../sections/Channels", () => ({ ChannelsSection: () => <div /> }));
vi.mock("../sections/Knowledge", () => ({ KnowledgeSection: () => <div /> }));
vi.mock("../sections/Settings", () => ({ SettingsSection: () => <div /> }));
vi.mock("../ui/useRestoreAssistant", () => ({
  useRestoreAssistant: () => ({ restore: vi.fn(), restoring: false }),
}));
vi.mock("../ChangePanel", () => ({ ChangePanel: () => <div>change-panel</div> }));
vi.mock("../TryIt", () => ({ TryIt: () => <div>try-panel</div> }));

const { AssistantHome } = await import("../AssistantHome");

const show = (readOnly: boolean, query = "") =>
  render(
    <MemoryRouter initialEntries={[`/assistants/b1${query}`]}>
      <Routes>
        <Route path="/assistants/:botId" element={<AssistantHome readOnly={readOnly} />} />
      </Routes>
    </MemoryRouter>,
  );

describe("AssistantHome readOnly (staff support view)", () => {
  it("is the control group: an owner sees Try it, Change and More", () => {
    show(false);
    expect(screen.getByRole("button", { name: "Try it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change your assistant" })).toBeTruthy();
    expect(screen.getByTestId("flags")).toHaveTextContent("edit=true manage=true try=true");
  });

  it("has no Try it, Change, More menu or switcher, and keeps Open page as a plain link", () => {
    show(true);
    expect(screen.queryByRole("button", { name: "Try it" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change your assistant" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    const open = screen.getByRole("link", { name: "Open page" });
    expect(open).toHaveAttribute("href", "https://chat.example/b/sunrise");
  });

  it("hands every section edit=false, manage=false and no Try it", () => {
    show(true);
    expect(screen.getByTestId("flags")).toHaveTextContent("edit=false manage=false try=false");
  });

  it("does not open Try it from the link, and shows Conversations (read-only inbox)", () => {
    show(true, "?section=test");
    expect(screen.queryByText("try-panel")).toBeNull();
    expect(screen.queryByText("change-panel")).toBeNull();
    const labels = [...screen.getByTestId("home-nav").querySelectorAll("button")].map(b =>
      b.textContent?.trim(),
    );
    expect(labels.some(label => label?.startsWith("Conversations"))).toBe(true);
  });
});
