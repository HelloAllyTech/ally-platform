import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      inbox: "Inbox",
      connectors: "Connectors",
      defaults: "Defaults",
      library: "Knowledge library",
      archived: "Archived",
    },
    archived: {
      empty: "Nothing archived",
      emptyHint: "Removed ones appear here",
      removed: "Removed {date}",
      loadFailed: "Could not load archived",
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
      test: "Test",
      conversations: "Conversations",
      unanswered: "Unanswered",
      usage: "Usage",
      settings: "Settings",
    },
    settingsSections: {
      agent: "Agent",
      replies: "Replies",
      people: "People",
      connectors: "Connectors",
      general: "General",
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
  stats: {
    messages: 5,
    people: 2,
    answered: 4,
    declined: 1,
    openUnanswered: 0,
    lastMessageAt: null,
  },
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:00:00Z",
  ...over,
});

let mockList: { chatbots: Chatbot[]; canCreate: boolean };
const mockArchive = vi.fn((_id: string) => ({ unwrap: () => Promise.resolve() }));
const mockRestore = vi.fn((_id: string) => ({ unwrap: () => Promise.resolve() }));
let mockBot: Chatbot | undefined;
let mockArchived: { chatbots: Chatbot[] };

vi.mock("@api", () => ({
  useGetChatbotsQuery: () => ({ data: mockList, isLoading: false, isError: false }),
  useGetChatbotQuery: () => ({ data: mockBot, isLoading: false, isError: false }),
  useArchiveChatbotMutation: () => [mockArchive, { isLoading: false }],
  useRestoreChatbotMutation: () => [mockRestore, { isLoading: false }],
  useGetArchivedChatbotsQuery: () => ({
    data: mockArchived,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
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

// The inbox (chunk 11a) has its own tests; here it's just the tab's content.
vi.mock("../../Inbox", () => ({ Inbox: () => <div data-testid="inbox" /> }));
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
vi.mock("../TemplatesTab", () => ({ TemplatesTab: stub("replies") }));
vi.mock("../AgentTab", () => ({ AgentTab: withRoles("agent") }));
vi.mock("../ChatbotSettingsTab", () => ({ ChatbotSettingsTab: withRoles("settings") }));

const { WhatsAppBot } = await import("../WhatsAppBot");

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chatbots" element={<WhatsAppBot />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Chatbots home", () => {
  beforeEach(() => {
    mockList = { chatbots: [bot()], canCreate: true };
    mockArchived = { chatbots: [] };
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

  it("shows a member only their bots and the inbox — no creating, no platform tabs", () => {
    mockList = { chatbots: [bot({ myRole: ChatbotMemberRole.VIEWER })], canCreate: false };
    renderAt("/chatbots?tab=defaults");
    expect(screen.queryByText("New chatbot")).toBeNull();
    // The inbox (chunk 11a) is for everyone who can see an assistant.
    expect(screen.getByTestId("tabs").textContent).toBe("ChatbotsInboxArchived");
    expect(screen.queryByTestId("defaults-settings")).toBeNull();
    expect(screen.queryByTestId("defaults-settings")).toBeNull();
    expect(screen.getByText("Policy helper")).toBeTruthy();
  });

  it("lets an owner remove an assistant from its ··· menu, even one still being set up", async () => {
    mockList = {
      chatbots: [bot({ status: ChatbotStatus.DRAFT, setupDraftId: "draft-1" })],
      canCreate: true,
    };
    mockArchive.mockClear();
    renderAt("/chatbots");
    fireEvent.click(screen.getByRole("button", { name: "More for Policy helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove assistant" }));
    // Asked in a dialog on the page, not the browser's own confirm box.
    const dialog = screen.getByRole("dialog", { name: "Remove Policy helper?" });
    expect(dialog.textContent).toContain("Its conversations are kept.");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(mockArchive).toHaveBeenCalledWith("bot-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("removes nothing when the owner keeps it", () => {
    mockArchive.mockClear();
    renderAt("/chatbots");
    fireEvent.click(screen.getByRole("button", { name: "More for Policy helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(mockArchive).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so, and stays open, when removing fails", async () => {
    mockArchive.mockImplementationOnce(() => ({ unwrap: () => Promise.reject(new Error("500")) }));
    renderAt("/chatbots");
    fireEvent.click(screen.getByRole("button", { name: "More for Policy helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Couldn't remove it. Try again.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("gives no menu to someone who doesn't own the assistant", () => {
    mockList = { chatbots: [bot({ myRole: ChatbotMemberRole.EDITOR })], canCreate: true };
    renderAt("/chatbots");
    expect(screen.queryByRole("button", { name: "More for Policy helper" })).toBeNull();
  });

  it("keeps removed assistants under Archived, to open and read", () => {
    mockArchived = {
      chatbots: [bot({ id: "bot-9", name: "Old helper", archivedAt: "2026-11-10T09:00:00Z" })],
    };
    renderAt("/chatbots?tab=archived");
    expect(screen.getByText("Old helper")).toBeTruthy();
    expect(screen.getByText(/^Removed /)).toBeTruthy();
    // Removed already: its menu offers Restore, never Remove.
    fireEvent.click(screen.getByRole("button", { name: "More for Old helper" }));
    expect(screen.queryByRole("menuitem", { name: "Remove assistant" })).toBeNull();
  });

  it("lets an owner restore a removed assistant from its ··· menu", async () => {
    mockArchived = {
      chatbots: [bot({ id: "bot-9", name: "Old helper", archivedAt: "2026-11-10T09:00:00Z" })],
    };
    mockRestore.mockClear();
    renderAt("/chatbots?tab=archived");
    fireEvent.click(screen.getByRole("button", { name: "More for Old helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore assistant" }));
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith("bot-9"));
  });

  it("gives no Restore to someone who doesn't own the removed assistant", () => {
    mockArchived = {
      chatbots: [
        bot({
          name: "Old helper",
          archivedAt: "2026-11-10T09:00:00Z",
          myRole: ChatbotMemberRole.VIEWER,
        }),
      ],
    };
    renderAt("/chatbots?tab=archived");
    expect(screen.queryByRole("button", { name: "More for Old helper" })).toBeNull();
  });

  it("says when nothing has been archived", () => {
    renderAt("/chatbots?tab=archived");
    expect(screen.getByText("Nothing archived")).toBeTruthy();
  });

  it("tells a member with no bots who to ask", () => {
    mockList = { chatbots: [], canCreate: false };
    renderAt("/chatbots");
    expect(screen.getByText("You haven't been added to a chatbot yet")).toBeTruthy();
  });
});
