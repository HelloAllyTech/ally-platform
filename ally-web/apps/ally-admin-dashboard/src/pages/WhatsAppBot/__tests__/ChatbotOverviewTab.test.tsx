import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Chatbot } from "@types";

/**
 * The Overview checklist: a step is done only when it really is, and every step (done or not)
 * opens the tab where it's done.
 */

vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  ROUTES: { WHATSAPP_BOT: "/chatbots" },
}));
vi.mock("@components", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary", TEXT: "text" },
}));
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@api", () => ({
  useSetChatbotStatusMutation: () => [vi.fn(), { isLoading: false }],
  useArchiveChatbotMutation: () => [vi.fn(), { isLoading: false }],
}));

const { ChatbotOverviewTab } = await import("../ChatbotOverviewTab");

const FULL_PERSONA = {
  displayName: "Hari",
  tone: "Friendly",
  systemPrompt: "You are Hari.",
  greeting: "Hi, I'm Hari.",
};

const bot = (over: Partial<Chatbot> = {}): Chatbot =>
  ({
    id: "bot-1",
    name: "Harbour Dental Care",
    status: "draft",
    accessMode: "anyone",
    knowledgeSource: "selected",
    persona: FULL_PERSONA,
    documentCount: 2,
    readyDocumentCount: 2,
    audienceCount: 0,
    connectors: [],
    lastTestedAt: null,
    stats: { messages: 0, people: 0, answered: 0, declined: 0, openUnanswered: 0 },
    ...over,
  }) as unknown as Chatbot;

const row = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

describe("ChatbotOverviewTab — checklist", () => {
  it("counts instructions done only when every field is filled, and says what's missing", () => {
    render(
      <ChatbotOverviewTab
        bot={bot({ persona: { ...FULL_PERSONA, greeting: " ", tone: "" } })}
        canEdit
        canManage
        onGo={vi.fn()}
      />,
    );
    const instructions = row("Write its instructions");
    expect(instructions).toHaveTextContent("Still to fill in: Tone, Welcome message");
    expect(instructions).toHaveTextContent("Open");
  });

  it("doesn't count documents that can't be answered from yet", () => {
    render(
      <ChatbotOverviewTab
        bot={bot({ documentCount: 1, readyDocumentCount: 0 })}
        canEdit
        canManage
        onGo={vi.fn()}
      />,
    );
    const knowledge = row("Add knowledge");
    expect(knowledge).toHaveTextContent("Your documents are still being prepared");
    expect(knowledge).toHaveTextContent("Open");
  });

  it("keeps a way into every step that is already done", () => {
    const onGo = vi.fn();
    render(<ChatbotOverviewTab bot={bot()} canEdit canManage onGo={onGo} />);
    fireEvent.click(row("Write its instructions").querySelector("button")!);
    fireEvent.click(row("Add knowledge").querySelector("button")!);
    expect(onGo.mock.calls).toEqual([["persona"], ["knowledge"]]);
    expect(row("Write its instructions")).toHaveTextContent("View");
  });
});
