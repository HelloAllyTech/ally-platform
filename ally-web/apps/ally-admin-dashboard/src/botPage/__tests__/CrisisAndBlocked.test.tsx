import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BotPageApiError, type botPageApi } from "../api";
import { BotPageApp } from "../BotPageApp";
import { blockedNotice, crisisLine } from "../blocked";
import { en } from "../copy/en";
import { hi } from "../copy/hi";
import { AccessEmail } from "../screens/Access";
import type { PublicBotPage, PublicSession } from "../types";

const PAGE: PublicBotPage = {
  slug: "sunrise-mind",
  access: "invite",
  branding: {
    logoUrl: null,
    accentColour: "#0F766E",
    title: "Sunrise Mind",
    subtitle: "Questions",
    assistantName: "Sunny",
    avatarUrl: null,
    disclaimer: "",
    footerLink: null,
  },
  suggestedQuestions: [],
  prechat: [],
  maxMessageChars: 200,
  language: "en",
  turnstileSiteKey: null,
};

const READY: PublicSession = { state: "ready", intakeDone: true, signedInAs: "a***@example.com" };

type Api = typeof botPageApi;

function chatApi(send: unknown, page: PublicBotPage = PAGE) {
  return {
    page: vi.fn().mockResolvedValue(page),
    session: vi.fn().mockResolvedValue(READY),
    verify: vi.fn(),
    intake: vi.fn(),
    conversation: vi.fn().mockResolvedValue({
      conversationId: "c1",
      messages: [{ id: "m1", role: "user", text: "Hi", citations: [], createdAt: "" }],
    }),
    newConversation: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    askForPerson: vi.fn(),
    feedback: vi.fn(),
    send,
  } as unknown as Api;
}

describe("sign-in screen crisis information", () => {
  it("shows the helpline link and 'If you were invited, check your email' before any code is asked for", () => {
    render(<AccessEmail branding={PAGE.branding} copy={en} onSubmit={vi.fn()} />);
    const info = screen.getByTestId("bp-crisis-info");
    expect(info).toHaveTextContent("If you need support now");
    expect(screen.getByRole("link", { name: /findahelpline\.com/ })).toHaveAttribute(
      "href",
      "https://findahelpline.com",
    );
    expect(screen.getByTestId("bp-invited-line")).toHaveTextContent(
      "If you were invited, check your email.",
    );
    expect(screen.queryByTestId("bp-crisis-numbers")).toBeNull();
  });

  it("puts the chatbot's own numbers first when the public view returns them", () => {
    render(
      <AccessEmail
        branding={PAGE.branding}
        copy={en}
        crisis={{ numbers: "1800-000-111" }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("bp-crisis-numbers")).toHaveTextContent("1800-000-111");
  });

  it("is the same for every visitor: it says nothing about the list or the address typed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AccessEmail branding={PAGE.branding} copy={en} onSubmit={onSubmit} />);
    const before = screen.getByTestId("bp-crisis-info").textContent;
    await user.type(screen.getByLabelText("Email address"), "stranger@example.com");
    expect(screen.getByTestId("bp-crisis-info").textContent).toBe(before);
    expect(document.body.textContent).not.toMatch(/not on the list|isn't on|can't use this chat/i);
  });

  it("is shown on the page's own sign-in step, in Hindi too", async () => {
    const api = chatApi(vi.fn());
    (api.session as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: "needs_email",
      intakeDone: false,
      signedInAs: null,
    });
    (api.conversation as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new BotPageApiError("BOT_PAGE_START_AGAIN", 401),
    );
    render(<BotPageApp slug="sunrise-mind" api={api} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByTestId("bp-crisis-info")).toBeInTheDocument();
    expect(hi.crisis.invited).not.toBe("");
  });
});

describe("blocked turns", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
  });

  it("builds the fixed notification from the page's own lines, link only by default", () => {
    expect(blockedNotice(en, "OUT_OF_CREDITS", PAGE)).toBe(
      "This assistant can't reply right now. If you need support now, you can find a helpline near you at findahelpline.com",
    );
    expect(blockedNotice(en, "REMOVED_FROM_LIST", PAGE)).toContain("by invitation only");
    expect(crisisLine(en, { ...PAGE, crisis: { numbers: "1800-000-111" } })).toMatch(
      /^You can call 1800-000-111\./,
    );
  });

  it("prefers the server's fixed text", () => {
    expect(blockedNotice(en, "OUT_OF_CREDITS", PAGE, "Server words")).toBe("Server words");
  });

  it("renders a blocked final as the fixed notification, not rateable", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue({
      reply: "",
      citations: [],
      messageId: "m2",
      conversationId: "c1",
      blocked: "REMOVED_FROM_LIST",
    });
    render(<BotPageApp slug="sunrise-mind" api={chatApi(send)} />);
    await screen.findByText("Hi");
    await user.type(screen.getByLabelText("Your message"), "hello{Enter}");
    expect(await screen.findByText(/available by invitation only/)).toBeInTheDocument();
    expect(screen.getByText(/findahelpline\.com/)).toBeInTheDocument();
    expect(screen.queryByText("Was this helpful?")).toBeNull();
  });

  it("renders a blocked refusal as the notification instead of an error, keeping the message", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockRejectedValue(new BotPageApiError("BOT_PAGE_OUT_OF_CREDITS", 402));
    render(<BotPageApp slug="sunrise-mind" api={chatApi(send)} />);
    await screen.findByText("Hi");
    await user.type(screen.getByLabelText("Your message"), "hello{Enter}");
    await waitFor(() => expect(screen.getByText(/can't reply right now/)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
