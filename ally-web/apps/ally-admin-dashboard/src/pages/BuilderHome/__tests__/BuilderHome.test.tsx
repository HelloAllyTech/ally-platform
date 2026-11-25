import React from "react";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { ASSISTANT_HEADER_SLOT_ID } from "@components/assistant-only/headerSlot";

import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
  ChatbotMemberRole,
  ChatbotStatus,
  type Chatbot,
} from "@types";

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
  readyDocumentCount: 3,
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
  lastTestedAt: null,
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:00:00Z",
  ...over,
});

let mockList: { chatbots: Chatbot[]; canCreate: boolean };
let mockArchived: { chatbots: Chatbot[] };
const mockArchive = vi.fn((_id: string) => ({ unwrap: () => Promise.resolve() }));
const mockRestore = vi.fn((_id: string) => ({ unwrap: () => Promise.resolve() }));
const archivedCalls = vi.fn();

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetChatbotsQuery: () => ({ data: mockList, isLoading: false, isError: false }),
  useGetMyPlanQuery: () => ({ data: undefined }),
  useArchiveChatbotMutation: () => [mockArchive, { isLoading: false }],
  useRestoreChatbotMutation: () => [mockRestore, { isLoading: false }],
  useGetArchivedChatbotsQuery: (_arg: unknown, options?: { skip?: boolean }) => {
    if (!options?.skip) archivedCalls();
    return {
      data: options?.skip ? undefined : mockArchived,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));
const { BuilderHome } = await import("../BuilderHome");

/** Where the router ended up, so a test can see an automatic open. */
const Where: React.FC = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
};

const setWidth = (px: number) => {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min ? px >= Number(min[1]) : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }) as unknown as typeof window.matchMedia;
};

const renderHome = (path = "/assistants") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/assistants" element={<BuilderHome />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );

describe("BuilderHome", () => {
  beforeEach(() => {
    mockList = { chatbots: [bot(), bot({ id: "bot-2", name: "Second" })], canCreate: true };
    mockArchived = { chatbots: [] };
    archivedCalls.mockClear();
    setWidth(1440);
  });
  afterEach(() => {
    // @ts-expect-error jsdom has no matchMedia by default
    delete window.matchMedia;
  });

  it("offers Create new chatbot as one button at the right end of the tab row, above the chatbots to open", () => {
    renderHome();
    const create = screen.getByRole("button", { name: "Create new chatbot" });
    const bar = screen.getByTestId("builder-home").querySelector(".ally-list-page__tabbar");
    expect(bar?.contains(create)).toBe(true);
    expect(bar?.lastElementChild).toBe(create);
    expect(screen.getByRole("tablist").contains(create)).toBe(false);
    expect(screen.queryByRole("heading", { name: "Create new chatbot" })).toBeNull();
    expect(screen.getByTestId("choice-open")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Open a chatbot" })).toBeNull();
  });

  it("draws its title in the shell's top bar when there is one, and Create stays in the tab row", () => {
    const slot = document.createElement("div");
    slot.id = ASSISTANT_HEADER_SLOT_ID;
    document.body.appendChild(slot);
    try {
      renderHome();
      expect(slot.querySelector("h1")?.textContent).toBe("Your Ally Chatbots");
      expect(within(slot).queryByRole("button", { name: "Create new chatbot" })).toBeNull();
      const page = screen.getByTestId("builder-home");
      expect(page.querySelector("h1")).toBeNull();
      expect(within(page).getByRole("button", { name: "Create new chatbot" })).toBeTruthy();
    } finally {
      slot.remove();
    }
  });

  it("shows an illustration when there is no chatbot to open, and not when there are some", () => {
    mockList = { chatbots: [], canCreate: true };
    renderHome();
    expect(screen.getByTestId("empty-chatbots-art")).toBeTruthy();
    cleanup();
    mockList = { chatbots: [bot()], canCreate: true };
    renderHome();
    expect(screen.queryByTestId("empty-chatbots-art")).toBeNull();
  });

  it("has only the All / Active / Archived views: Inbox, Connectors, Defaults and Library are gone, and ?tab= is ignored", () => {
    renderHome("/assistants?tab=defaults");
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "All",
      "Active",
      "Archived",
    ]);
    for (const name of ["Inbox", "Connectors", "Channels", "Defaults", "Knowledge library"]) {
      expect(screen.queryByRole("tab", { name })).toBeNull();
    }
    expect(screen.getByText("Policy helper")).toBeTruthy();
  });

  it("lists the chatbots as cards with status and activity", () => {
    renderHome();
    expect(screen.getByText("Policy helper")).toBeTruthy();
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 messages, last 30 days").length).toBeGreaterThan(0);
  });

  it("hides Create from someone who cannot create", () => {
    mockList = { chatbots: [bot(), bot({ id: "bot-2", name: "Second" })], canCreate: false };
    renderHome();
    expect(screen.queryByRole("button", { name: "Create new chatbot" })).toBeNull();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("opens straight in when the person is on exactly one chatbot and cannot create", async () => {
    mockList = { chatbots: [bot()], canCreate: false };
    renderHome();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/assistants/bot-1"));
  });

  it("does not open straight in when the person can create, or is on several", () => {
    mockList = { chatbots: [bot()], canCreate: true };
    const first = renderHome();
    expect(screen.getByTestId("where").textContent).toBe("/assistants");
    first.unmount();
    mockList = { chatbots: [bot(), bot({ id: "bot-2" })], canCreate: false };
    renderHome();
    expect(screen.getByTestId("where").textContent).toBe("/assistants");
  });

  it("opens straight in with replace, so Back does not return to the home and bounce again", async () => {
    mockList = { chatbots: [bot()], canCreate: false };
    render(
      <MemoryRouter initialEntries={["/before", "/assistants"]} initialIndex={1}>
        <Where />
        <Routes>
          <Route path="/assistants" element={<BuilderHome />} />
          <Route path="*" element={<div />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/assistants/bot-1"));
  });

  it("leaves blank, untouched drafts out of the grid and of the open-straight count", async () => {
    mockList = {
      chatbots: [
        bot({ id: "keep", name: "Real one" }),
        bot({
          id: "blank-1",
          name: "Blank draft",
          status: ChatbotStatus.DRAFT,
          setupDraftId: "d1",
          documentCount: 0,
          readyDocumentCount: 0,
          stats: {
            messages: 0,
            people: 0,
            answered: 0,
            declined: 0,
            openUnanswered: 0,
            lastMessageAt: null,
          },
        }),
        bot({ id: "blank-2", name: "Flagged blank", blank: true }),
      ],
      canCreate: false,
    };
    renderHome();
    // One real chatbot is left, so it opens straight in; the blanks never counted.
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/assistants/keep"));
  });

  it("keeps a draft that has content, and sends it back to where setup left off", () => {
    mockList = {
      chatbots: [
        bot({ status: ChatbotStatus.DRAFT, setupDraftId: "draft-1", documentCount: 2 }),
        bot({ id: "bot-2", name: "Second" }),
      ],
      canCreate: true,
    };
    renderHome();
    expect(screen.getByText("Policy helper")).toBeTruthy();
    fireEvent.click(screen.getByText("Policy helper"));
    expect(screen.getByTestId("where").textContent).toBe("/assistants/new/draft-1");
  });

  // TF1 F5: before go-live the home was reachable only by URL.
  it("a draft's card also opens its home (knowledge, lists, settings)", () => {
    mockList = {
      chatbots: [
        bot({ id: "b9", status: ChatbotStatus.DRAFT, setupDraftId: "draft-1", documentCount: 2 }),
        bot({ id: "bot-2", name: "Second" }),
      ],
      canCreate: true,
    };
    renderHome();
    fireEvent.click(screen.getByTestId("open-home-b9"));
    expect(screen.getByTestId("where").textContent).toBe("/assistants/b9");
  });

  it("does not show a blank draft's card", () => {
    mockList = {
      chatbots: [
        bot({ id: "a", name: "Real one" }),
        bot({ id: "b", name: "Blank flagged", blank: true }),
      ],
      canCreate: true,
    };
    renderHome();
    expect(screen.queryByText("Blank flagged")).toBeNull();
  });

  describe("the waiting count", () => {
    it("shows on cards for people who can respond, edit or own", () => {
      mockList = {
        chatbots: [
          bot({ id: "own", name: "Mine", waitingForPerson: 3 }),
          bot({
            id: "rsp",
            name: "Resp",
            myRole: ChatbotMemberRole.RESPONDER,
            waitingForPerson: 2,
          }),
          bot({ id: "edt", name: "Edit", myRole: ChatbotMemberRole.EDITOR, waitingForPerson: 1 }),
        ],
        canCreate: true,
      };
      renderHome();
      expect(screen.getByTestId("waiting-own").textContent).toContain("3");
      expect(screen.getByTestId("waiting-rsp").textContent).toContain("2");
      expect(screen.getByTestId("waiting-edt").textContent).toContain("1");
    });

    it("is hidden from a viewer, and when nothing waits, and when the API does not send it", () => {
      mockList = {
        chatbots: [
          bot({ id: "v", name: "View", myRole: ChatbotMemberRole.VIEWER, waitingForPerson: 4 }),
          bot({ id: "z", name: "Zero", waitingForPerson: 0 }),
          bot({ id: "u", name: "Unsent" }),
        ],
        canCreate: true,
      };
      renderHome();
      expect(screen.queryByTestId("waiting-v")).toBeNull();
      expect(screen.queryByTestId("waiting-z")).toBeNull();
      expect(screen.queryByTestId("waiting-u")).toBeNull();
    });
  });

  describe("All / Active / Archived views", () => {
    const old = () => bot({ id: "bot-9", name: "Old helper", archivedAt: "2026-11-10T09:00:00Z" });
    const selected = () =>
      screen.getAllByRole("tab").find(tab => tab.getAttribute("aria-selected") === "true")
        ?.textContent;

    it("opens on All: the active chatbots, then the archived ones", () => {
      mockArchived = { chatbots: [old()] };
      renderHome();
      expect(selected()).toBe("All");
      expect(screen.getByText("Policy helper")).toBeTruthy();
      expect(screen.getByText("Old helper")).toBeTruthy();
      expect(screen.getByText(/^Removed /)).toBeTruthy();
    });

    it("Active shows only the active chatbots and does not load the archived ones", () => {
      mockArchived = { chatbots: [old()] };
      renderHome();
      archivedCalls.mockClear();
      fireEvent.click(screen.getByRole("tab", { name: "Active" }));
      expect(selected()).toBe("Active");
      expect(screen.getByText("Policy helper")).toBeTruthy();
      expect(screen.queryByText("Old helper")).toBeNull();
      expect(archivedCalls).not.toHaveBeenCalled();
    });

    it("Archived shows only the removed chatbots, to open and read", () => {
      mockArchived = { chatbots: [old()] };
      renderHome();
      fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
      expect(selected()).toBe("Archived");
      expect(screen.getByText("Old helper")).toBeTruthy();
      expect(screen.queryByText("Policy helper")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "More for Old helper" }));
      expect(screen.queryByRole("menuitem", { name: "Remove assistant" })).toBeNull();
    });

    it("moves between the tabs with the arrow keys", () => {
      renderHome();
      fireEvent.keyDown(screen.getByRole("tab", { name: "All" }), { key: "ArrowRight" });
      expect(selected()).toBe("Active");
      fireEvent.keyDown(screen.getByRole("tab", { name: "Active" }), { key: "ArrowLeft" });
      expect(selected()).toBe("All");
    });

    it("keeps the old ?archived=1 link working: it opens on Archived", () => {
      mockArchived = { chatbots: [old()] };
      renderHome("/assistants?archived=1");
      expect(selected()).toBe("Archived");
      expect(screen.getByText("Old helper")).toBeTruthy();
    });

    it("lets an author restore, and gives no menu to someone who does not own it", async () => {
      mockArchived = {
        chatbots: [
          old(),
          bot({
            id: "bot-8",
            name: "Not mine",
            myRole: ChatbotMemberRole.VIEWER,
            archivedAt: "2026-11-10T09:00:00Z",
          }),
        ],
      };
      mockRestore.mockClear();
      renderHome("/assistants?view=archived");
      expect(screen.queryByRole("button", { name: "More for Not mine" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "More for Old helper" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Restore assistant" }));
      await waitFor(() => expect(mockRestore).toHaveBeenCalledWith("bot-9"));
    });

    it("says when nothing has been archived", () => {
      renderHome("/assistants?view=archived");
      expect(screen.getByTestId("archived-empty").textContent).toContain("Nothing archived");
    });

    it("shows one empty state on All when there is nothing at all", () => {
      mockList = { chatbots: [], canCreate: true };
      renderHome();
      expect(screen.getByText("No Ally Chatbots here 😮")).toBeTruthy();
      expect(screen.queryByTestId("archived-empty")).toBeNull();
    });
  });

  describe("Create", () => {
    it("goes to the create screen on a wide screen", () => {
      renderHome();
      fireEvent.click(screen.getByRole("button", { name: "Create new chatbot" }));
      expect(screen.getByTestId("where").textContent).toBe("/assistants/new");
    });

    it("below 1280px creates nothing and says to open it on a laptop", () => {
      setWidth(1100);
      renderHome();
      fireEvent.click(screen.getByRole("button", { name: "Create new chatbot" }));
      expect(screen.getByTestId("where").textContent).toBe("/assistants");
      expect(screen.getByTestId("narrow-note").textContent).toContain("laptop");
    });
  });

  it("lets an author remove a chatbot from its menu", async () => {
    mockArchive.mockClear();
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "More for Policy helper" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(mockArchive).toHaveBeenCalledWith("bot-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("gives no menu to someone who does not own the chatbot", () => {
    mockList = {
      chatbots: [bot({ myRole: ChatbotMemberRole.EDITOR }), bot({ id: "bot-2", name: "Second" })],
      canCreate: true,
    };
    renderHome();
    expect(screen.queryByRole("button", { name: "More for Policy helper" })).toBeNull();
  });

  it("tells a member with nothing to open who to ask", () => {
    mockList = { chatbots: [], canCreate: false };
    renderHome();
    expect(screen.getByText(/Ask its author/)).toBeTruthy();
  });
});
