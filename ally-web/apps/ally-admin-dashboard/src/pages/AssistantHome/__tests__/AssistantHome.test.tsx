import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { ChatbotMemberRole as R, ChatbotStatus, type Chatbot } from "@types";

let mockBot: Partial<Chatbot>;

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetChatbotQuery: () => ({ data: mockBot, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetAssistantHomeQuery: () => ({
    data: { canEdit: true, fields: {}, safety: {} },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetBotPageQuery: () => ({ data: undefined }),
  useGetChatbotsQuery: () => ({ data: { chatbots: [mockBot] } }),
}));

// Each section is its own suite; here they are labelled stubs, so the test sees only the frame.
const stub = (name: string) => () => <div>{`stub:${name}`}</div>;
vi.mock("../sections/Overview", () => ({ OverviewSection: stub("overview") }));
vi.mock("../sections/Build", () => ({
  BuildSection: ({ part }: { part: string }) => <div>{`stub:build:${part}`}</div>,
}));
vi.mock("../sections/Conversations", () => ({ ConversationsSection: stub("conversations") }));
vi.mock("../sections/Channels", () => ({ ChannelsSection: stub("channels") }));
vi.mock("../sections/Knowledge", () => ({
  KnowledgeSection: ({ part }: { part: string }) => <div>{`stub:knowledge:${part}`}</div>,
}));
vi.mock("../sections/Settings", () => ({ SettingsSection: stub("settings") }));
vi.mock("../ui/useRestoreAssistant", () => ({
  useRestoreAssistant: () => ({ restore: vi.fn(), restoring: false }),
}));
vi.mock("../ChangePanel", () => ({ ChangePanel: stub("change") }));
vi.mock("../TryIt", () => ({ TryIt: stub("try") }));
vi.mock("../EnginePanel", () => ({ EnginePanel: stub("engine") }));
vi.mock("../SettingsPanel", () => ({ SettingsPanel: stub("settings-panel") }));

const { AssistantHome } = await import("../AssistantHome");

const bot = (over: Partial<Chatbot> = {}): Partial<Chatbot> => ({
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
  ...over,
});

const show = (query = "") =>
  render(
    <MemoryRouter initialEntries={[`/assistants/b1${query}`]}>
      <Routes>
        <Route path="/assistants/:botId" element={<AssistantHome />} />
      </Routes>
    </MemoryRouter>,
  );

describe("AssistantHome sections", () => {
  beforeEach(() => {
    mockBot = bot();
  });

  it("shows six sections in order", () => {
    show();
    const labels = [...screen.getByTestId("home-nav").querySelectorAll("button")].map(b =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual([
      "Overview",
      "Build",
      "Conversations",
      "Channels",
      "Knowledge",
      "Settings",
    ]);
  });

  it("opens Overview by default", () => {
    show();
    expect(screen.getByText("stub:overview")).toBeTruthy();
  });

  it.each([
    ["?section=settings", "stub:settings"],
    ["?section=channels", "stub:channels"],
    ["?section=build&part=checkup", "stub:build:checkup"],
    ["?section=knowledge&part=lists", "stub:knowledge:lists"],
    // The ten old sections, and the classic tabs, still land somewhere.
    ["?section=share", "stub:channels"],
    ["?section=page", "stub:channels"],
    ["?section=how", "stub:settings"],
    ["?section=safety", "stub:settings"],
    ["?section=personality", "stub:build:personality"],
    ["?section=checkup", "stub:build:checkup"],
    ["?section=knows", "stub:knowledge:knows"],
    ["?section=lists", "stub:knowledge:lists"],
    ["?section=lists&tool=memory", "stub:settings"],
    ["?section=lists&tool=pages", "stub:channels"],
    ["?tab=persona", "stub:build:personality"],
    ["?tab=settings&section=people", "stub:settings"],
    ["?tab=conversations", "stub:conversations"],
  ])("old and new links resolve: %s", (query, text) => {
    show(query);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("marks the section on the page so Build can use the full width", () => {
    const { container } = show("?section=build");
    expect(container.querySelector('.ally-home[data-section="build"]')).toBeTruthy();
    expect(container.querySelector(".ally-home__panel")).toBeNull();
  });

  it("moves between sections and keeps the part in the address", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("stub:settings")).toBeTruthy();
  });

  it("shows the waiting count on Conversations", () => {
    mockBot = bot({ waitingForPerson: 4 });
    show();
    expect(screen.getByTestId("waiting-count").textContent).toBe("4");
  });

  describe("a Responder-only member", () => {
    beforeEach(() => {
      mockBot = bot({ myRole: R.RESPONDER, myRoles: [R.RESPONDER] });
    });

    it("sees only Conversations, whatever the link asks for", () => {
      for (const query of ["", "?section=settings", "?section=lists&tool=memory", "?tab=test"]) {
        const { unmount } = show(query);
        expect(screen.getByText("stub:conversations")).toBeTruthy();
        for (const other of ["overview", "settings", "channels", "build", "knowledge"]) {
          expect(screen.queryByText(new RegExp(`^stub:${other}`))).toBeNull();
        }
        unmount();
      }
    });

    it("has no section list, and none of the build controls", () => {
      show();
      expect(screen.getByTestId("home-nav").hasAttribute("hidden")).toBe(true);
      expect(screen.queryByRole("button", { name: "Try it" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Change your assistant" })).toBeNull();
    });
  });

  it("a Responder who also edits sees the whole home", () => {
    mockBot = bot({ myRole: R.EDITOR, myRoles: [R.RESPONDER, R.EDITOR] });
    show("?section=settings");
    expect(screen.getByText("stub:settings")).toBeTruthy();
    expect(screen.getByTestId("home-nav").hasAttribute("hidden")).toBe(false);
  });
});
