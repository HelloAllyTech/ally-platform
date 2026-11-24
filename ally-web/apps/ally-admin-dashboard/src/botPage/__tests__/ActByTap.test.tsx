import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { botPageApi } from "../api";
import { BotPageApp } from "../BotPageApp";
import type { PublicBotPage, PublicFinal } from "../types";

/** BT1: act by tap on the bot page (and so the bubble, which is the same page). */

type Api = typeof botPageApi;

const PAGE = {
  slug: "rha",
  access: "public",
  branding: {
    logoUrl: null,
    accentColour: "#0F766E",
    title: "Robin Hood Army",
    subtitle: "",
    assistantName: "RHA assistant",
    avatarUrl: null,
    disclaimer: "",
    footerLink: null,
  },
  suggestedQuestions: [],
  prechat: [],
  maxMessageChars: 500,
  language: "en",
  turnstileSiteKey: null,
} as unknown as PublicBotPage;

const CHIPS: PublicFinal = {
  reply: "These food drives have places:",
  citations: [],
  messageId: "m1",
  conversationId: "c1",
  parts: {
    choices: {
      list: "Food drives",
      options: [
        { kind: "choose", label: "Sun 29 Nov 2026, 10:00", token: "t-10" },
        { kind: "choose", label: "Sun 29 Nov 2026, 11:00", token: "t-11" },
      ],
    },
  },
};

const CARD: PublicFinal = {
  reply: "Shall I register you for Sun 29 Nov 2026, 11:00?",
  citations: [],
  messageId: "m2",
  conversationId: "c1",
  parts: {
    offer: {
      question: "Shall I register you for Sun 29 Nov 2026, 11:00?",
      action: "create",
      card: {
        list: "Registrations",
        title: "Sun 29 Nov 2026, 11:00",
        details: [
          { label: "Where", value: "Bandra West station" },
          { label: "Places", value: "1" },
        ],
      },
      buttons: [
        { kind: "confirm", label: "Confirm", token: "t-confirm" },
        { kind: "change", label: "Change", token: "t-change" },
      ],
    },
  },
};

const DONE: PublicFinal = {
  reply: "Done: you're registered for Sun 29 Nov 2026, 11:00, Bandra West station.",
  citations: [],
  messageId: "m3",
  conversationId: "c1",
  confirmation: {
    action: "create",
    list: "Registrations",
    title: "Sun 29 Nov 2026, 11:00",
    headline: "registered",
    details: [{ label: "Where", value: "Bandra West station" }],
  },
  parts: {
    done: {
      buttons: [
        { kind: "cancel", label: "Cancel", token: "t-cancel" },
        { kind: "move", label: "Move", token: "t-move" },
      ],
    },
  },
};

function fakeApi(finals: PublicFinal[]) {
  const queue = [...finals];
  const send = vi.fn(
    async (_slug: string, _text: string, handlers: { onToken(t: string): void }) => {
      const final = queue.shift()!;
      handlers.onToken(final.reply);
      return final;
    },
  );
  const api = {
    page: vi.fn().mockResolvedValue(PAGE),
    session: vi.fn().mockResolvedValue({ state: "ready", intakeDone: true, signedInAs: null }),
    conversation: vi.fn().mockResolvedValue({ conversationId: "c1", messages: [] }),
    newConversation: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    send,
  };
  return { api: api as unknown as Api, send };
}

describe("act by tap on the bot page", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
  });

  it("registers in 2 taps: a chip, then Confirm; each tap sends its label and its token", async () => {
    const user = userEvent.setup();
    const { api, send } = fakeApi([CHIPS, CARD, DONE]);
    render(<BotPageApp slug="rha" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Your message"), "food drive sunday{Enter}");

    const chips = await screen.findByRole("group", { name: "Food drives" });
    await user.click(within(chips).getByRole("button", { name: "Sun 29 Nov 2026, 11:00" }));
    expect(send.mock.calls[1][1]).toBe("Sun 29 Nov 2026, 11:00");
    expect(send.mock.calls[1][4]).toBe("t-11");

    const card = await screen.findByTestId("offer-card");
    expect(card).toHaveTextContent("Sun 29 Nov 2026, 11:00");
    expect(card).toHaveTextContent("Bandra West station");
    // The chips of an older reply can't be tapped any more.
    expect(within(chips).getByRole("button", { name: "Sun 29 Nov 2026, 10:00" })).toBeDisabled();

    await user.click(within(card).getByRole("button", { name: "Confirm" }));
    expect(send.mock.calls[2][1]).toBe("Confirm");
    expect(send.mock.calls[2][4]).toBe("t-confirm");

    const done = await screen.findByTestId("confirmation-card");
    expect(done).toHaveTextContent("Registered");
    expect(within(done).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(done).getByRole("button", { name: "Move" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("a crisis reply carries no chips or cards", async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([
      {
        reply: "It sounds like this may be urgent. If you're in danger, call 112 now.",
        citations: [],
        messageId: "m1",
        conversationId: "c1",
      },
    ]);
    render(<BotPageApp slug="rha" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Your message"), "I want to end it{Enter}");
    await screen.findByText(/call 112 now/);
    expect(screen.queryByTestId("offer-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("choices")).not.toBeInTheDocument();
    expect(screen.queryByTestId("suggestions")).not.toBeInTheDocument();
  });

  it("shows up to 3 next questions after an answer, and Try it's mark on a test card", async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([
      {
        reply: "We run food drives every Sunday.",
        citations: [],
        messageId: "m1",
        conversationId: "c1",
        parts: {
          suggestions: [
            { kind: "ask", label: "Where are you based?", token: "q1" },
            { kind: "ask", label: "How do I volunteer?", token: "q2" },
          ],
        },
      },
      {
        ...CARD,
        parts: { offer: { ...CARD.parts!.offer!, testOnly: "Test only, not saved" } },
      },
    ]);
    render(<BotPageApp slug="rha" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Your message"), "what do you do{Enter}");
    const next = await screen.findByTestId("suggestions");
    await user.click(within(next).getByRole("button", { name: "How do I volunteer?" }));
    expect(await screen.findByTestId("test-only")).toHaveTextContent("Test only, not saved");
  });
});
