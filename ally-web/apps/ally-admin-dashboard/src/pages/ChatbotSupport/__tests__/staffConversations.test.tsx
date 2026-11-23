import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  access: {
    current: { data: undefined, isLoading: false, isFetching: false, isError: false } as Record<
      string,
      unknown
    >,
  },
  refetch: vi.fn(),
  listError: { current: undefined as unknown },
  threadError: { current: undefined as unknown },
  items: { current: [] as unknown[] },
  thread: { current: null as unknown },
  memory: { current: null as unknown },
  countsSkip: { current: undefined as unknown },
  streamEnabled: { current: undefined as unknown },
  takeOver: vi.fn(),
  handBack: vi.fn(),
  reply: vi.fn(),
  forgetPerson: vi.fn(),
}));

const unwrapped = (fn: (args: unknown) => unknown) => (args: unknown) => ({
  unwrap: () => Promise.resolve(fn(args)),
});

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetInboxCountsQuery: (_arg: unknown, options?: { skip?: boolean }) => {
    h.countsSkip.current = options?.skip;
    return { data: options?.skip ? undefined : { unread: 3, needsPerson: 2, safety: 0 } };
  },
  useGetInboxQuery: () => ({
    data: h.listError.current ? undefined : h.items.current,
    isLoading: false,
    error: h.listError.current,
  }),
  useGetChatbotsQuery: () => ({ data: { chatbots: [] } }),
  useGetInboxThreadQuery: () => ({
    data: h.threadError.current ? undefined : h.thread.current,
    isLoading: false,
    error: h.threadError.current,
  }),
  useGetPersonMemoryQuery: () => ({
    data: h.memory.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useTakeOverMutation: () => [unwrapped(h.takeOver), { isLoading: false }],
  useHandBackMutation: () => [unwrapped(h.handBack), { isLoading: false }],
  useReplyInInboxMutation: () => [unwrapped(h.reply), { isLoading: false }],
  useAddCheckupCaseMutation: () => [vi.fn(), { isLoading: false }],
  useEditMemoryLineMutation: () => [vi.fn(), { isLoading: false }],
  useForgetMemoryLineMutation: () => [vi.fn(), { isLoading: false }],
  useForgetPersonMutation: () => [unwrapped(h.forgetPerson), { isLoading: false }],
}));
vi.mock("@hooks", () => ({ useUser: () => ({ user: { id: 50 } }) }));
vi.mock("../../Inbox/useInboxStream", () => ({
  useInboxStream: (_onEvent: unknown, enabled = true) => {
    h.streamEnabled.current = enabled;
  },
}));
vi.mock("../staffAccessApi", () => ({
  useGetStaffConversationAccessQuery: () => ({ ...h.access.current, refetch: h.refetch }),
}));

// eslint-disable-next-line import/first
import { ReadOnlyContext } from "../../AssistantHome/readOnly";
// eslint-disable-next-line import/first
import { INBOX } from "../../Inbox/copy";
// eslint-disable-next-line import/first
import { STAFF_CONVERSATIONS_COPY } from "../copy";
// eslint-disable-next-line import/first
import { disableEditable } from "../ReadOnlyFrame";
// eslint-disable-next-line import/first
import { StaffConversations } from "../StaffConversations";

const c = STAFF_CONVERSATIONS_COPY;
const BOT = "b1";

const item = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  chatbotId: BOT,
  assistant: "Sunrise Mind",
  channel: "web",
  visitor: "Asha",
  preview: "Can I talk to someone?",
  lastMessageAt: "2026-11-09T10:00:00.000Z",
  unread: 2,
  state: "needs_person",
  needsPersonReason: "asked",
  heldBy: null,
  safety: false,
  ...over,
});

const thread = (over: Record<string, unknown> = {}) => ({
  ...item(),
  contactId: "p1",
  intake: [],
  replyWindowClosesAt: null,
  messages: [
    {
      id: "m1",
      role: "user",
      text: "Can I talk to someone?",
      citations: [],
      handledBy: null,
      at: "2026-11-09T10:00:00.000Z",
      sentBy: null,
      rating: null,
      ratingReason: null,
    },
    {
      id: "m2",
      role: "assistant",
      text: "I've asked the team to join.",
      citations: [],
      handledBy: "handover",
      at: "2026-11-09T10:00:01.000Z",
      sentBy: null,
      rating: null,
      ratingReason: null,
    },
  ],
  ...over,
});

const granted = (expiresAt = new Date(Date.now() + 3600_000).toISOString()) => {
  h.access.current = {
    data: { granted: true, expiresAt },
    isLoading: false,
    isFetching: false,
    isError: false,
  };
};

const show = (path = "/admin/chatbot-support/b1") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ReadOnlyContext.Provider value>
        <StaffConversations chatbotId={BOT} />
      </ReadOnlyContext.Provider>
    </MemoryRouter>,
  );

describe("Staff read-only conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = {
      data: { granted: false },
      isLoading: false,
      isFetching: false,
      isError: false,
    };
    h.listError.current = undefined;
    h.threadError.current = undefined;
    h.items.current = [item(), item({ id: "c2", visitor: "Ravi", state: "live" })];
    h.thread.current = thread();
    h.memory.current = null;
  });

  it("without a live grant shows the no-grant panel and no list", () => {
    show();
    expect(screen.getByTestId("staff-conversations-no-grant")).toHaveTextContent(c.noGrant);
    expect(screen.queryByTestId("inbox")).toBeNull();
    expect(screen.queryByTestId("inbox-list")).toBeNull();
  });

  it("while checking shows a quiet line; a failed check offers a retry", () => {
    h.access.current = { isLoading: true, isFetching: true, isError: false };
    const { unmount } = show();
    expect(screen.getByTestId("staff-conversations-checking")).toBeInTheDocument();
    unmount();
    h.access.current = { isLoading: false, isFetching: false, isError: true };
    show();
    fireEvent.click(screen.getByRole("button", { name: c.retry }));
    expect(h.refetch).toHaveBeenCalled();
    expect(screen.queryByTestId("inbox")).toBeNull();
  });

  it("with a live grant lists the conversations under the read-only banner and its expiry", () => {
    granted();
    show();
    expect(screen.getByTestId("staff-conversations-banner")).toHaveTextContent(c.banner);
    expect(screen.getByTestId("staff-conversations-banner")).toHaveTextContent(
      "The owner allows this until",
    );
    const list = screen.getByTestId("inbox-list");
    expect(list).toHaveTextContent("Asha");
    expect(list).toHaveTextContent("Ravi");
    // No live stream (nothing marked read, no notifications), no counts, no sound or alerts.
    expect(h.streamEnabled.current).toBe(false);
    expect(h.countsSkip.current).toBe(true);
    expect(screen.queryByRole("button", { name: INBOX.soundTipOn })).toBeNull();
    expect(screen.queryByRole("button", { name: INBOX.soundTipOff })).toBeNull();
    expect(screen.queryByText(INBOX.turnOnNotifications)).toBeNull();
  });

  it("an open chat shows its messages, with no take over, hand back, reply or checkup", () => {
    granted();
    show("/admin/chatbot-support/b1?conversation=c1&bot=b1");
    expect(screen.getByTestId("inbox-chat")).toHaveTextContent("I've asked the team to join.");
    expect(screen.queryByRole("button", { name: INBOX.takeOver })).toBeNull();
    expect(screen.queryByRole("button", { name: INBOX.handBack })).toBeNull();
    expect(screen.queryByRole("button", { name: INBOX.addToCheckup })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: INBOX.send })).toBeNull();
    expect(h.takeOver).not.toHaveBeenCalled();
  });

  it("a chat held by someone shows who, and still no hand back or composer", () => {
    granted();
    // Even if the staff member's id matched the holder's, nothing to act with.
    h.thread.current = thread({ heldBy: { id: 50, name: "Meera" }, state: "held" });
    show("/admin/chatbot-support/b1?conversation=c1&bot=b1");
    expect(screen.queryByRole("button", { name: INBOX.handBack })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: INBOX.send })).toBeNull();
  });

  it("the memory is shown with no forget or edit controls", () => {
    granted();
    h.memory.current = {
      on: true,
      name: "Asha",
      lines: [
        {
          id: "l1",
          section: "preferences",
          text: "Prefers Hindi",
          saidAt: "2026-11-09T10:00:00.000Z",
          expiresAt: null,
          sourceKind: "person",
          sourceMessageId: null,
          sourceConversationId: null,
        },
      ],
      beforeChat: [],
      summary: null,
      neverStore: ["Health details"],
    };
    show("/admin/chatbot-support/b1?conversation=c1&bot=b1");
    expect(screen.getAllByText("Prefers Hindi").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Forget/ })).toBeNull();
    expect(screen.queryByRole("button", { name: INBOX.memory.edit })).toBeNull();
    expect(screen.queryByText(INBOX.memory.forgetPerson)).toBeNull();
    expect(screen.queryByRole("link", { name: INBOX.memory.changeNever })).toBeNull();
  });

  it("a 403 from the list (the grant ended) returns to the no-grant panel and asks again", () => {
    granted();
    h.listError.current = { status: 403, data: { message: "no grant" } };
    show();
    expect(h.refetch).toHaveBeenCalled();
    expect(screen.getByTestId("staff-conversations-no-grant")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox")).toBeNull();
  });

  it("a 403 on an open chat does the same", () => {
    granted();
    h.threadError.current = { status: 403 };
    show("/admin/chatbot-support/b1?conversation=c1&bot=b1");
    expect(h.refetch).toHaveBeenCalled();
    expect(screen.getByTestId("staff-conversations-no-grant")).toBeInTheDocument();
  });

  it("asks again when the grant expires", () => {
    vi.useFakeTimers();
    try {
      granted(new Date(Date.now() + 60_000).toISOString());
      show();
      expect(h.refetch).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(62_000);
      });
      expect(h.refetch).toHaveBeenCalled();
      expect(screen.getByTestId("staff-conversations-no-grant")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the read-only frame leaves the channel filter usable", () => {
    granted();
    show();
    const root = screen.getByTestId("staff-conversations");
    disableEditable(root);
    expect(screen.getByRole("combobox")).not.toBeDisabled();
  });
});
