import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BotPageApiError, type botPageApi } from "../api";
import { BotPageApp } from "../BotPageApp";
import { parseSse } from "../../hooks/chatStream/sse";
import type { PublicBotPage, PublicSession } from "../types";

const PAGE: PublicBotPage = {
  slug: "sunrise-mind",
  access: "invite",
  branding: {
    logoUrl: null,
    accentColour: "#0F766E",
    title: "Sunrise Mind",
    subtitle: "Questions about our clinic",
    assistantName: "Sunny",
    avatarUrl: null,
    disclaimer: "Not a crisis service.",
    footerLink: { label: "Privacy", url: "https://sunrise.example/privacy" },
  },
  suggestedQuestions: ["What are your fees?"],
  prechat: [
    { id: "name", label: "Your name", type: "text", required: true },
    {
      id: "reason",
      label: "Reason",
      type: "choice",
      required: true,
      options: ["Therapy", "Workshops"],
    },
  ],
  maxMessageChars: 200,
  language: "en",
  turnstileSiteKey: null,
};

const READY: PublicSession = { state: "ready", intakeDone: false, signedInAs: "a***@example.com" };

type Api = typeof botPageApi;

function fakeApi(over: Partial<Record<keyof Api, unknown>> = {}) {
  const api = {
    page: vi.fn().mockResolvedValue(PAGE),
    session: vi.fn(async (_slug: string, body?: { email?: string }) =>
      body?.email
        ? ({ state: "needs_code", intakeDone: false, signedInAs: null } as PublicSession)
        : ({ state: "needs_email", intakeDone: false, signedInAs: null } as PublicSession),
    ),
    verify: vi.fn().mockResolvedValue(READY),
    intake: vi.fn().mockResolvedValue({ intakeDone: true }),
    conversation: vi.fn().mockRejectedValue(new BotPageApiError("BOT_PAGE_START_AGAIN", 401)),
    newConversation: vi.fn().mockResolvedValue({ ok: true }),
    send: vi.fn(
      async (
        _slug: string,
        _text: string,
        handlers: { onStatus(c: string): void; onToken(t: string): void },
      ) => {
        handlers.onStatus("searching");
        handlers.onToken("Sessions cost ");
        handlers.onToken("1500.");
        return {
          reply: "Sessions cost 1500.",
          citations: [{ title: "Fees", url: "https://sunrise.example/fees" }],
          messageId: "m2",
          conversationId: "c1",
        };
      },
    ),
    ...over,
  };
  return api as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

describe("BotPageApp", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never; // reduced motion: instant reveal
  });

  it("goes cover → email → code → pre-chat questions one at a time → chat, then streams a reply", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    api.conversation
      .mockRejectedValueOnce(new BotPageApiError("BOT_PAGE_START_AGAIN", 401))
      .mockResolvedValue({ conversationId: null, messages: [] });
    render(<BotPageApp slug="sunrise-mind" api={api} />);

    expect(await screen.findByRole("heading", { name: "Sunrise Mind" })).toBeInTheDocument();
    expect(screen.getByText("Not a crisis service.")).toBeInTheDocument();
    expect(screen.getByText("Only invited people can use this chat.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));

    await screen.findByRole("heading", { name: "Confirm your email" });
    await user.type(screen.getByLabelText("Email address"), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(api.session).toHaveBeenLastCalledWith("sunrise-mind", { email: "asha@example.com" });

    await screen.findByRole("heading", { name: "Enter your code" });
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(api.verify).toHaveBeenCalledWith("sunrise-mind", "asha@example.com", "123456");

    await screen.findByRole("heading", { name: "Your name" });
    expect(screen.getByText("Question 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please answer this question.");
    await user.type(screen.getByRole("textbox"), "Asha");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Reason" });
    expect(screen.getByText("Question 2 of 2")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Therapy"));
    await user.click(screen.getByRole("button", { name: "Start chatting" }));
    expect(api.intake).toHaveBeenCalledWith("sunrise-mind", [
      { id: "name", value: "Asha" },
      { id: "reason", value: "Therapy" },
    ]);

    await screen.findByText("Signed in as a***@example.com");
    await user.click(screen.getByRole("button", { name: "What are your fees?" }));
    // The stored reply replaces the revealed text, with its sources under it.
    expect(await screen.findByRole("link", { name: "Fees" })).toHaveAttribute(
      "href",
      "https://sunrise.example/fees",
    );
    expect(screen.getByText("Sessions cost 1500.")).toBeInTheDocument();
    expect(api.send.mock.calls[0][1]).toBe("What are your fees?");
  });

  it("resumes an open conversation on reload, skipping the cover", async () => {
    const api = fakeApi({
      conversation: vi.fn().mockResolvedValue({
        conversationId: "c1",
        messages: [
          { id: "m1", role: "user", text: "Hi", citations: [], createdAt: "" },
          {
            id: "m2",
            role: "assistant",
            text: "Hello! How can I help?",
            citations: [],
            createdAt: "",
          },
        ],
      }),
      session: vi.fn().mockResolvedValue({ ...READY, intakeDone: true }),
    });
    render(<BotPageApp slug="sunrise-mind" api={api} />);
    expect(await screen.findByText("Hello! How can I help?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("New chat clears the thread", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      conversation: vi.fn().mockResolvedValue({
        conversationId: "c1",
        messages: [{ id: "m1", role: "user", text: "Hi", citations: [], createdAt: "" }],
      }),
      session: vi.fn().mockResolvedValue({ ...READY, intakeDone: true }),
    });
    render(<BotPageApp slug="sunrise-mind" api={api} />);
    await screen.findByText("Hi");
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(api.newConversation).toHaveBeenCalledWith("sunrise-mind");
    await waitFor(() => expect(screen.queryByText("Hi")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "What are your fees?" })).toBeInTheDocument();
  });

  it.each([
    [new BotPageApiError("BOT_PAGE_THROTTLED", 429, 300), "Please wait 5 min"],
    [new BotPageApiError("BOT_PAGE_BUSY_UNAVAILABLE", 503), "We're busy right now"],
  ])("explains a limit and puts the message back in the box", async (refusal, text) => {
    const user = userEvent.setup();
    const api = fakeApi({
      conversation: vi
        .fn()
        .mockResolvedValue({
          conversationId: "c1",
          messages: [{ id: "m1", role: "user", text: "Hi", citations: [], createdAt: "" }],
        }),
      session: vi.fn().mockResolvedValue({ ...READY, intakeDone: true }),
      send: vi.fn().mockRejectedValue(refusal),
    });
    render(<BotPageApp slug="sunrise-mind" api={api} />);
    await screen.findByText("Hi");
    await user.type(screen.getByLabelText("Your message"), "one more{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Your message")).toHaveValue("one more");
  });

  it("says a link is not available", async () => {
    const api = fakeApi({
      page: vi.fn().mockRejectedValue(new BotPageApiError("BOT_PAGE_NOT_FOUND", 404)),
    });
    render(<BotPageApp slug="gone" api={api} />);
    expect(await screen.findByRole("heading", { name: /isn't available/ })).toBeInTheDocument();
  });

  it("explains a wrong code and lets the visitor try again", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      verify: vi.fn().mockRejectedValue(new BotPageApiError("BOT_PAGE_CODE_WRONG", 400)),
    });
    render(<BotPageApp slug="sunrise-mind" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Email address"), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't right.");
    expect(screen.getByRole("heading", { name: "Enter your code" })).toBeInTheDocument();
  });

  it("speaks Hindi when the page is set to Hindi", async () => {
    const api = fakeApi({ page: vi.fn().mockResolvedValue({ ...PAGE, language: "hi" }) });
    render(<BotPageApp slug="sunrise-mind" api={api} />);
    expect(await screen.findByRole("button", { name: "शुरू करें" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("hi");
  });

  it("refuses a message over the page's limit before sending it", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      conversation: vi
        .fn()
        .mockResolvedValue({
          conversationId: "c1",
          messages: [{ id: "m1", role: "user", text: "Hi", citations: [], createdAt: "" }],
        }),
      session: vi.fn().mockResolvedValue({ ...READY, intakeDone: true }),
    });
    render(<BotPageApp slug="sunrise-mind" api={api} />);
    await screen.findByText("Hi");
    await act(async () => {
      await user.click(screen.getByLabelText("Your message"));
      await user.paste("x".repeat(201));
    });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText("201 of 200 characters")).toBeInTheDocument();
  });
});

describe("parseSse", () => {
  it("splits frames across chunks and skips pings", () => {
    const first = parseSse('event: status\ndata: {"code":"thinking"}\n\n: ping\n\nevent: tok');
    expect(first.events).toEqual([{ type: "status", data: { code: "thinking" } }]);
    const second = parseSse(`${first.rest}en\ndata: {"text":"Hi"}\n\n`);
    expect(second.events).toEqual([{ type: "token", data: { text: "Hi" } }]);
  });
});
