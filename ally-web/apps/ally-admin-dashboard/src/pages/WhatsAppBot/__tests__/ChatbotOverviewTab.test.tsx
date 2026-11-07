import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Chatbot } from "@types";

/**
 * The Overview checklist: a step is done only when it really is, and every step (done or not)
 * opens the tab where it's done. Publish waits for every step before it, and says what's missing.
 */

vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  ROUTES: { WHATSAPP_BOT: "/chatbots" },
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

const channel = (status: string) => ({
  id: `c-${status}`,
  type: "whatsapp",
  typeLabel: "WhatsApp",
  name: "Front desk",
  chatbotId: "bot-1",
  chatbotName: "Harbour Dental Care",
  summary: { address: "+1 555", status, lastError: null, lastInboundAt: null, details: {} },
  createdAt: "2026-11-01T00:00:00Z",
});

/** Every step before publishing done: tested, with a working channel. */
const READY = { lastTestedAt: "2026-11-05T10:00:00Z", connectors: [channel("connected")] };

describe("ChatbotOverviewTab — channel and publish", () => {
  it("doesn't count a channel that is still waiting for Meta or needs attention", () => {
    for (const status of ["awaiting_webhook", "error"]) {
      const { unmount } = render(
        <ChatbotOverviewTab
          bot={bot({ ...READY, connectors: [channel(status)] } as Partial<Chatbot>)}
          canEdit
          canManage
          onGo={vi.fn()}
        />,
      );
      const step = row("Add a channel");
      expect(step).toHaveTextContent("Finish connecting your channel");
      expect(step).toHaveTextContent("Open");
      unmount();
    }
  });

  it("counts a connected channel", () => {
    render(
      <ChatbotOverviewTab bot={bot(READY as Partial<Chatbot>)} canEdit canManage onGo={vi.fn()} />,
    );
    expect(row("Add a channel")).toHaveTextContent("View");
  });

  it("keeps Publish off until every step before it is done, and names what's missing", () => {
    render(<ChatbotOverviewTab bot={bot()} canEdit canManage onGo={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByTestId("publish-needs")).toHaveTextContent(
      "Before you can publish: Try it in Preview, Add a channel",
    );
  });

  it("lets a ready chatbot be published", () => {
    render(
      <ChatbotOverviewTab bot={bot(READY as Partial<Chatbot>)} canEdit canManage onGo={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(screen.queryByTestId("publish-needs")).not.toBeInTheDocument();
  });

  it("doesn't call a published chatbot that still needs steps 'ready to publish'", () => {
    render(
      <ChatbotOverviewTab
        bot={bot({ status: "live", lastTestedAt: "2026-11-05T10:00:00Z" } as Partial<Chatbot>)}
        canEdit
        canManage
        onGo={vi.fn()}
      />,
    );
    expect(screen.queryByText("Get this chatbot ready to publish")).not.toBeInTheDocument();
    expect(screen.getByText("Published, but still needs: Add a channel")).toBeInTheDocument();
  });
});
