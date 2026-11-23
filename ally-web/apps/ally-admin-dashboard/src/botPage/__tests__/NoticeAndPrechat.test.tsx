import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BotPageApiError, type botPageApi } from "../api";
import { BotPageApp } from "../BotPageApp";
import type { PublicBotPage, PublicSession } from "../types";

const PAGE: PublicBotPage = {
  slug: "s",
  access: "public",
  branding: {
    logoUrl: null,
    accentColour: "#0F766E",
    title: "Sunrise",
    assistantName: "Sunny",
    disclaimer: "OLD FREE TEXT DISCLAIMER",
  },
  suggestedQuestions: [],
  prechat: [{ id: "name", label: "Your name", type: "text", required: true }],
  maxMessageChars: 200,
  language: "en",
  turnstileSiteKey: null,
  notice: "You are talking to an AI, and people at Sunrise may read this chat.",
  disclaimer: "Not a crisis service.",
};
const READY: PublicSession = { state: "ready", intakeDone: false, signedInAs: null };
type Api = typeof botPageApi;

const final = { reply: "Hello.", citations: [], messageId: "m2", conversationId: "c1" };

function fakeApi(over: Partial<Record<keyof Api, unknown>> = {}, page = PAGE) {
  return {
    page: vi.fn().mockResolvedValue(page),
    session: vi.fn().mockResolvedValue(READY),
    verify: vi.fn(),
    intake: vi.fn().mockResolvedValue({ intakeDone: true }),
    conversation: vi
      .fn()
      .mockRejectedValueOnce(new BotPageApiError("BOT_PAGE_START_AGAIN", 401))
      .mockResolvedValue({ conversationId: "c1", messages: [] }),
    newConversation: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    askForPerson: vi.fn(),
    send: vi.fn().mockResolvedValue(final),
    feedback: vi.fn(),
    ...over,
  } as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

describe("notice and disclaimer", () => {
  it("shows the notice and disclaimer at the start of the chat, never the old free text", async () => {
    const user = userEvent.setup();
    const api = fakeApi({}, { ...PAGE, prechat: [] });
    api.session.mockResolvedValue({ ...READY, intakeDone: true });
    render(<BotPageApp slug="s" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText(PAGE.notice as string)).toBeInTheDocument();
    expect(screen.getByText("Not a crisis service.")).toBeInTheDocument();
    expect(screen.queryByText("OLD FREE TEXT DISCLAIMER")).not.toBeInTheDocument();
  });

  it("shows only the notice when the disclaimer is null", async () => {
    const user = userEvent.setup();
    const api = fakeApi({}, { ...PAGE, prechat: [], disclaimer: null });
    api.session.mockResolvedValue({ ...READY, intakeDone: true });
    render(<BotPageApp slug="s" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText(PAGE.notice as string)).toBeInTheDocument();
    expect(screen.queryByText("Not a crisis service.")).not.toBeInTheDocument();
  });
});

describe("pre-chat questions do not block a first message", () => {
  it("shows the questions with a message box and sends without answering", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<BotPageApp slug="s" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText(/Answer these so we can help you better/)).toBeInTheDocument();
    expect(screen.getByText(PAGE.notice as string)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Or type your message now"), "hi there");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send.mock.calls[0][1]).toBe("hi there");
    expect(await screen.findByText("Hello.")).toBeInTheDocument();
  });

  it("brings the questions back and keeps the message when the server wants them", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockRejectedValue(new BotPageApiError("BOT_PAGE_INTAKE_REQUIRED", 409));
    const api = fakeApi({ send });
    render(<BotPageApp slug="s" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Or type your message now"), "need help");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText(/Answer these so we can help you better/)).toBeInTheDocument();
    expect(screen.getByLabelText("Or type your message now")).toHaveValue("need help");

    // Answering then moves to the chat with the message ready to resend.
    await user.type(screen.getByRole("textbox", { name: "Your name" }), "Asha");
    await user.click(screen.getByRole("button", { name: "Start chatting" }));
    expect(await screen.findByLabelText("Your message")).toHaveValue("need help");
  });

  it("sends a crisis message the server accepts despite unanswered questions", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      send: vi.fn().mockResolvedValue({ ...final, reply: "Please call a helpline." }),
    });
    render(<BotPageApp slug="s" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Or type your message now"), "I want to die");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Please call a helpline.")).toBeInTheDocument();
    expect(api.intake).not.toHaveBeenCalled();
  });
});
