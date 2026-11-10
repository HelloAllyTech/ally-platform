import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  items: { current: [] as unknown[] },
  thread: { current: null as unknown },
  takeOver: vi.fn(),
  handBack: vi.fn(),
  reply: vi.fn(),
  addCase: vi.fn(),
}));

const unwrapped = (fn: (args: unknown) => unknown) => (args: unknown) => ({
  unwrap: () => Promise.resolve(fn(args)),
});

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetInboxQuery: () => ({ data: h.items.current, isLoading: false }),
  useGetChatbotsQuery: () => ({
    data: { chatbots: [{ id: "b1", name: "Sunrise Mind", myRole: "editor" }] },
  }),
  useGetInboxThreadQuery: () => ({ data: h.thread.current, isLoading: false }),
  useTakeOverMutation: () => [unwrapped(h.takeOver), { isLoading: false }],
  useHandBackMutation: () => [unwrapped(h.handBack), { isLoading: false }],
  useReplyInInboxMutation: () => [unwrapped(h.reply), { isLoading: false }],
  useAddCheckupCaseMutation: () => [unwrapped(h.addCase), { isLoading: false }],
}));
vi.mock("@hooks", () => ({ useUser: () => ({ user: { id: 7 } }) }));
vi.mock("../useInboxStream", () => ({ useInboxStream: () => undefined }));

// eslint-disable-next-line import/first
import { INBOX } from "../copy";
// eslint-disable-next-line import/first
import { Inbox } from "../Inbox";
// eslint-disable-next-line import/first
import { backoff, BACKOFF_MS } from "../useInboxStream.backoff";

const DECK = readFileSync(
  resolve(__dirname, "../../../../../../../docs/agents-v2/ONBOARDING-COPY.md"),
  "utf8",
);
const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

const item = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  chatbotId: "b1",
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
  intake: [{ id: "q1", label: "Your name", value: "Asha" }],
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
      rating: "down",
      ratingReason: "not_answered",
    },
  ],
  ...over,
});

const open = (path = "/inbox") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Inbox />
    </MemoryRouter>,
  );

describe("Inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.items.current = [
      item(),
      item({
        id: "c2",
        visitor: "…3210",
        channel: "whatsapp",
        state: "assistant",
        needsPersonReason: null,
        unread: 0,
        safety: true,
      }),
    ];
    h.thread.current = thread();
  });

  it("words every line as the deck does", () => {
    for (const line of strings(INBOX)) expect(DECK).toContain(line);
  });

  it("lists chats with Safety, Needs a person and unread counts", () => {
    open();
    expect(screen.getByText("Asha")).toBeTruthy();
    expect(screen.getByText("Needs a person · Asked for a person")).toBeTruthy();
    expect(screen.getByText(INBOX.safety)).toBeTruthy();
    expect(screen.getByLabelText("2 unread")).toBeTruthy();
    // No chat open yet: the other side says what to do.
    expect(screen.getByText(INBOX.pickChat)).toBeTruthy();
  });

  it("takes a chat over, replies, and hands it back", async () => {
    h.takeOver.mockReturnValue({ ok: true });
    open("/inbox?conversation=c1&bot=b1");
    expect(screen.getByText("Your name")).toBeTruthy();
    fireEvent.click(screen.getByText(INBOX.takeOver));
    await waitFor(() => expect(h.takeOver).toHaveBeenCalledWith({ chatbotId: "b1", id: "c1" }));
  });

  it("while you have it: the banner, the reply box, Hand back", async () => {
    h.thread.current = thread({ state: "held", heldBy: { id: 7, name: "Asha Rao" } });
    h.reply.mockReturnValue({ messageId: "m3" });
    h.handBack.mockReturnValue({ ok: true });
    open("/inbox?conversation=c1&bot=b1");
    expect(screen.getByText(INBOX.takenOver)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(INBOX.replyPlaceholder), {
      target: { value: "Hi Asha, I can help." },
    });
    fireEvent.click(screen.getByText(INBOX.send));
    await waitFor(() =>
      expect(h.reply).toHaveBeenCalledWith({
        chatbotId: "b1",
        id: "c1",
        text: "Hi Asha, I can help.",
      }),
    );
    fireEvent.click(screen.getByText(INBOX.handBack));
    await waitFor(() => expect(h.handBack).toHaveBeenCalled());
  });

  it("someone else has it: who, and no reply box", () => {
    h.thread.current = thread({ state: "held", heldBy: { id: 8, name: "Ravi" } });
    open("/inbox?conversation=c1&bot=b1");
    expect(screen.getByText("Ravi is replying in this chat.")).toBeTruthy();
    expect(screen.queryByPlaceholderText(INBOX.replyPlaceholder)).toBeNull();
  });

  it("WhatsApp after 24 hours: says why, and the reply box is closed", () => {
    h.thread.current = thread({
      channel: "whatsapp",
      state: "held",
      heldBy: { id: 7, name: "Asha Rao" },
      replyWindowClosesAt: "2026-11-01T10:00:00.000Z",
    });
    open("/inbox?conversation=c1&bot=b1");
    expect(screen.getByText(INBOX.windowClosed)).toBeTruthy();
    expect(
      (screen.getByPlaceholderText(INBOX.replyPlaceholder) as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  it("inside one assistant's home, held to that assistant (no assistant filter)", () => {
    render(
      <MemoryRouter initialEntries={["/chatbots/b1?section=conversations"]}>
        <Inbox chatbotId="b1" />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(INBOX.allAssistants)).toBeNull();
    expect(screen.getByLabelText(INBOX.channels.all)).toBeTruthy();
  });

  it("an open chat has a way back to the list (for phones)", () => {
    open("/inbox?conversation=c1&bot=b1");
    expect(screen.getByTestId("inbox").dataset.chatOpen).toBe("true");
    fireEvent.click(screen.getByText(INBOX.back));
    expect(screen.getByTestId("inbox").dataset.chatOpen).toBeUndefined();
  });

  it("names website chats Website, and filters them (chunk 13)", () => {
    h.items.current = [
      { ...(h.items.current[0] as object), id: "w1", source: "widget", visitor: "Ravi" },
    ];
    open();
    expect(screen.getAllByText(/· Website$/).length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: INBOX.channels.widget })).toBeTruthy();
  });

  it("shows the date once a day and groups one sender's messages within 2 minutes (20d-2)", () => {
    const base = thread().messages[0];
    h.thread.current = thread({
      messages: [
        { ...base, id: "a", at: "2026-11-08T09:00:00.000Z", text: "First" },
        { ...base, id: "b", at: "2026-11-08T09:01:00.000Z", text: "Second" },
        { ...base, id: "c", at: "2026-11-09T09:00:00.000Z", text: "Next day" },
      ],
    });
    open("/inbox?conversation=c1&bot=b1");
    const chat = screen.getByTestId("inbox-chat");
    expect(chat.querySelectorAll(".ally-inbox__day")).toHaveLength(2);
    // One name line for the two close together, one for the next day's.
    expect(chat.querySelectorAll(".ally-inbox__author")).toHaveLength(2);
    expect(chat.querySelectorAll(".ally-inbox__msg--grouped")).toHaveLength(1);
  });

  it("puts Take over on the name's line and labels a rating in words (20d-2)", () => {
    open("/inbox?conversation=c1&bot=b1");
    const name = screen.getByRole("heading", { name: "Asha" }).parentElement!;
    expect(name.querySelector("button")?.textContent).toBe(INBOX.takeOver);
    expect(screen.getByText(INBOX.notHelpful)).toBeTruthy();
  });

  it("the sound is an icon toggle that says what it does (20d-2)", () => {
    open();
    const sound = screen.getByRole("button", { name: /^Sound for new chats/ });
    const before = sound.getAttribute("aria-label");
    fireEvent.click(sound);
    expect(sound.getAttribute("aria-label")).not.toBe(before);
    expect([INBOX.soundTipOn, INBOX.soundTipOff]).toContain(sound.getAttribute("title"));
  });

  it("inside an assistant's home, doesn't repeat the Inbox title (20d-2)", () => {
    render(
      <MemoryRouter initialEntries={["/x"]}>
        <Inbox chatbotId="b1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("heading", { level: 1, name: INBOX.nav })).toBeNull();
  });

  it("Add to checkup on a reply is filled in with what they asked and what it said (20d-2)", async () => {
    h.thread.current = thread({
      messages: [
        { ...thread().messages[0], text: "Do you see couples?" },
        {
          ...thread().messages[1],
          text: "Yes. Couples sessions are 75 minutes with Sara.",
          rating: null,
        },
      ],
    });
    h.addCase.mockReturnValue({});
    render(
      <MemoryRouter initialEntries={["/inbox?conversation=c1&bot=b1"]}>
        <Inbox />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: INBOX.addToCheckup }));
    const editor = screen.getByTestId("checkup-editor");
    expect((editor.querySelector("input") as HTMLInputElement).value).toBe("Do you see couples?");
    expect(editor.textContent).toContain("Couples sessions are 75 minutes with Sara.");
    fireEvent.submit(editor);
    await waitFor(() =>
      expect(h.addCase).toHaveBeenCalledWith({
        id: "b1",
        input: expect.objectContaining({
          question: "Do you see couples?",
          facts: ["Yes.", "Couples sessions are 75 minutes with Sara."],
          addedFrom: "chat",
        }),
      }),
    );
  });

  it("an empty inbox says so", () => {
    h.items.current = [];
    open();
    expect(screen.getAllByText(INBOX.empty).length).toBeGreaterThan(0);
  });
});

describe("the stream's reconnect backoff", () => {
  it("waits longer each time, up to 30 s, with a little jitter", () => {
    expect(BACKOFF_MS).toEqual([1_000, 2_000, 5_000, 10_000, 30_000]);
    const first = backoff(0);
    expect(first).toBeGreaterThanOrEqual(1_000);
    expect(first).toBeLessThan(2_000);
    expect(backoff(99)).toBeGreaterThanOrEqual(30_000);
    expect(backoff(99)).toBeLessThan(31_000);
  });
});
