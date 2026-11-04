import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotMemberRole,
  ChatbotStatus,
  type Chatbot,
} from "@types";

/**
 * The chatbot shell: a home listing the bots you can work on (and, for platform admins, what every
 * bot shares), and one page per bot whose tabs and actions follow your role on it.
 */
vi.mock("@constants", async () => {
  const bots = {
    listEmpty: "No chatbots yet",
    listEmptyMember: "You haven't been added to a chatbot yet",
    listEmptyHint: "Create one",
    listEmptyMemberHint: "Ask an admin",
    create: "New chatbot",
    loadFailed: "Could not load",
    homeTabs: {
      bots: "Chatbots",
      connectors: "Connectors",
      defaults: "Defaults",
      library: "Knowledge library",
    },
    status: { draft: "Draft", live: "Live", paused: "Paused" },
    role: { viewer: "Viewer", editor: "Editor", owner: "Owner" },
    noConnector: "Not connected",
    cardMessages: "{count} messages",
    cardPeople: "{count} people",
    cardDocs: "{count} documents",
    back: "All chatbots",
    defaults: {
      intro: "Defaults are the starting point",
      sectionSettings: "Settings",
      sectionReplies: "Quick replies",
      repliesIntro: "Fixed replies",
    },
    tabs: {
      overview: "Overview",
      persona: "Persona",
      knowledge: "Knowledge",
      replies: "Replies",
      people: "People",
      connectors: "Connectors",
      settings: "Settings",
      test: "Test",
      conversations: "Conversations",
      unanswered: "Unanswered",
      usage: "Usage",
    },
  };
  return {
    en: { whatsappBot: { title: "Chatbots", subtitle: "Bots", bots } },
    ROUTES: { WHATSAPP_BOT: "/chatbots", CHATBOT_DETAIL: "/chatbots/:botId" },
  };
});

const bot = (over: Partial<Chatbot> = {}): Chatbot => ({
  id: "bot-1",
  name: "Policy helper",
  description: null,
  status: ChatbotStatus.LIVE,
  accessMode: ChatbotAccessMode.LISTED,
  answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
  knowledgeSource: ChatbotKnowledgeSource.SELECTED,
  persona: { displayName: "Ava" },
  model: null,
  myRole: ChatbotMemberRole.OWNER,
  connectors: [],
  documentCount: 3,
  audienceCount: 1,
  memberCount: 1,
  stats: { messages: 5, people: 2, answered: 4, declined: 1, openUnanswered: 0, lastMessageAt: null },
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:00:00Z",
  ...over,
});

let mockList: { chatbots: Chatbot[]; canCreate: boolean };
let mockBot: Chatbot | undefined;

vi.mock("@api", () => ({
  useGetChatbotsQuery: () => ({ data: mockList, isLoading: false, isError: false }),
  useGetChatbotQuery: () => ({ data: mockBot, isLoading: false, isError: false }),
}));

/** Mirrors the shared Tabs: one span per tab. */
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tabs: ({ items }: { items: { id: string; label: string }[] }) => (
    <div data-testid="tabs">
      {items.map(item => (
        <span key={item.id} data-testid={`tab-${item.id}`}>
          {item.label}
        </span>
      ))}
    </div>
  ),
  SkeletonText: () => null,
}));

vi.mock("@components", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@components/types", () => ({ ButtonVariant: { PRIMARY: "primary" } }));

vi.mock("../shared", () => ({
  fill: (text: string, values: Record<string, unknown>) =>
    text.replace(/\{(\w+)\}/g, (_m, key: string) => String(values[key])),
  LoadError: ({ title }: { title: string }) => <div role="alert">{title}</div>,
  StatusPill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const { useChatbotId } = await import("../chatbotContext");
const stub = (id: string) => () => <div data-testid={id} data-bot={useChatbotId() ?? ""} />;
const withRoles =
  (id: string) =>
  ({ canEdit, canManage }: { canEdit?: boolean; canManage?: boolean }) => (
    <div data-testid={id} data-edit={String(canEdit)} data-manage={String(canManage)} />
  );

vi.mock("../BotSettingsTab", () => ({ BotSettingsTab: stub("defaults-settings") }));
vi.mock("../ConnectorsTab", () => ({
  AllConnectorsTab: stub("all-connectors"),
  BotConnectorsTab: withRoles("bot-connectors"),
}));
vi.mock("../CorpusTab", () => ({ CorpusTab: stub("library") }));
vi.mock("../CreateChatbotPanel", () => ({ CreateChatbotPanel: () => null }));
vi.mock("../TemplatesTab", () => ({ TemplatesTab: stub("replies") }));
vi.mock("../ChatbotOverviewTab", () => ({ ChatbotOverviewTab: withRoles("overview") }));
vi.mock("../ChatbotSettingsTab", () => ({ ChatbotSettingsTab: withRoles("settings") }));
vi.mock("../ChatbotTestTab", () => ({ ChatbotTestTab: stub("test") }));
vi.mock("../ConversationsTab", () => ({ ConversationsTab: stub("conversations") }));
vi.mock("../KnowledgeTab", () => ({ KnowledgeTab: withRoles("knowledge") }));
vi.mock("../PeopleTab", () => ({ PeopleTab: withRoles("people") }));
vi.mock("../PersonaTab", () => ({ PersonaTab: withRoles("persona") }));
vi.mock("../UnansweredTab", () => ({ UnansweredTab: stub("unanswered") }));
vi.mock("../UsageTab", () => ({ UsageTab: stub("usage") }));

const { WhatsAppBot } = await import("../WhatsAppBot");
const { ChatbotPage } = await import("../ChatbotPage");

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chatbots" element={<WhatsAppBot />} />
        <Route path="/chatbots/:botId" element={<ChatbotPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Chatbots home", () => {
  beforeEach(() => {
    mockList = { chatbots: [bot()], canCreate: true };
  });

  it("lists the bots as cards with their status and activity", () => {
    renderAt("/chatbots");
    expect(screen.getByText("Policy helper")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("5 messages")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
  });

  it("gives a platform admin what every bot shares", () => {
    renderAt("/chatbots?tab=defaults");
    expect(screen.getByTestId("tab-connectors")).toBeTruthy();
    expect(screen.getByTestId("defaults-settings")).toBeTruthy();
    // The shared replies, with no bot in context: the global set.
    fireEvent.click(screen.getByRole("tab", { name: "Quick replies" }));
    expect(screen.getByTestId("replies").dataset.bot).toBe("");
  });

  it("shows a member only their bots — no creating, no platform tabs", () => {
    mockList = { chatbots: [bot({ myRole: ChatbotMemberRole.VIEWER })], canCreate: false };
    renderAt("/chatbots?tab=defaults");
    expect(screen.queryByText("New chatbot")).toBeNull();
    expect(screen.queryByTestId("tabs")).toBeNull();
    expect(screen.queryByTestId("defaults-settings")).toBeNull();
    expect(screen.getByText("Policy helper")).toBeTruthy();
  });

  it("tells a member with no bots who to ask", () => {
    mockList = { chatbots: [], canCreate: false };
    renderAt("/chatbots");
    expect(screen.getByText("You haven't been added to a chatbot yet")).toBeTruthy();
  });
});

describe("Chatbot page", () => {
  beforeEach(() => {
    mockBot = bot();
  });

  it("opens on the overview", () => {
    renderAt("/chatbots/bot-1");
    expect(screen.getByTestId("overview")).toBeTruthy();
  });

  it("hands every tab the bot", () => {
    renderAt("/chatbots/bot-1?tab=conversations");
    expect(screen.getByTestId("conversations").dataset.bot).toBe("bot-1");
  });

  it("falls back to the overview for an unknown tab", () => {
    renderAt("/chatbots/bot-1?tab=nonsense");
    expect(screen.getByTestId("overview")).toBeTruthy();
  });

  it("lets a viewer look but not change", () => {
    mockBot = bot({ myRole: ChatbotMemberRole.VIEWER });
    renderAt("/chatbots/bot-1?tab=persona");
    expect(screen.getByTestId("persona").dataset.edit).toBe("false");
  });

  it("keeps team and numbers to owners", () => {
    mockBot = bot({ myRole: ChatbotMemberRole.EDITOR });
    renderAt("/chatbots/bot-1?tab=connectors");
    expect(screen.getByTestId("bot-connectors").dataset.manage).toBe("false");
  });

  it("puts the open-question count on the Unanswered tab", () => {
    mockBot = bot({ stats: { ...bot().stats, openUnanswered: 4 } });
    renderAt("/chatbots/bot-1");
    expect(screen.getByTestId("tab-unanswered").textContent).toBe("Unanswered (4)");
  });
});
