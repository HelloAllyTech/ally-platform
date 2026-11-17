import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BotPageApiError, type botPageApi } from "../api";
import { BotPageApp } from "../BotPageApp";
import { en } from "../copy/en";
import { hi } from "../copy/hi";
import { MIN_STEP_MS, SLOW_AFTER_MS, doingLine, doneLines, useLiveSteps } from "../liveSteps";
import type { PublicBotPage, PublicFinal, PublicStep } from "../types";

/** Chunk 6b, section E: the assistant's live steps on the bot page and in the bubble. */

const PAGE = {
  slug: "lakeview",
  access: "public",
  branding: {
    logoUrl: null,
    accentColour: "#0F766E",
    title: "Lakeview Clinic",
    subtitle: "",
    assistantName: "Lakeview assistant",
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

const BOOKING: PublicStep[] = [
  { kind: "find", label: "Slots" },
  { kind: "create", label: "Thu 19 Nov 2026, 11:00" },
  { kind: "writing" },
];

describe("step lines", () => {
  it("say what it is doing in plain words, never a tool, id or query", () => {
    const lines = [
      doingLine("reading", en, "Lakeview Clinic"),
      doingLine({ kind: "search" }, en, "Lakeview Clinic"),
      ...BOOKING.map(s => doingLine(s, en, "Lakeview Clinic")),
      doingLine({ kind: "find", label: "Reservations" }, en, "x"),
      doingLine({ kind: "create" }, en, "x"),
      doingLine({ kind: "cancel" }, en, "x"),
      doingLine({ kind: "hand_over" }, en, "x"),
    ];
    expect(lines).toEqual([
      "Reading your message…",
      "Searching Lakeview Clinic's information…",
      "Checking free times…",
      "Booking Thu 19 Nov, 11:00…",
      "Writing a reply…",
      "Looking in Reservations…",
      "Saving your details…",
      "Cancelling your booking…",
      "Passing this to the team…",
    ]);
    for (const text of lines) expect(text).not.toMatch(/find_|create_|_id|[0-9a-f]{8}-/);
  });

  it("collapse into what it did, without writing the reply", () => {
    expect(doneLines(BOOKING, en, "Lakeview Clinic")).toEqual([
      "Checked free times",
      "Booked Thu 19 Nov, 11:00",
    ]);
  });

  it("have every line in Hindi too", () => {
    expect(Object.keys(hi.steps.doing)).toEqual(Object.keys(en.steps.doing));
    expect(Object.keys(hi.steps.done)).toEqual(Object.keys(en.steps.done));
  });
});

describe("pacing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds each step at least 400 ms, so lines don't flicker", () => {
    const { result } = renderHook(() => useLiveSteps());
    act(() => result.current.start());
    act(() => {
      result.current.push({ kind: "find", label: "Slots" });
      result.current.push({ kind: "writing" });
    });
    expect(result.current.current).toBe("reading");
    act(() => vi.advanceTimersByTime(MIN_STEP_MS));
    expect(result.current.current).toEqual({ kind: "find", label: "Slots" });
    act(() => vi.advanceTimersByTime(MIN_STEP_MS - 1));
    expect(result.current.current).toEqual({ kind: "find", label: "Slots" });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.current).toEqual({ kind: "writing" });
  });

  it("says it's still working after 12 s with nothing new", () => {
    const { result } = renderHook(() => useLiveSteps());
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS - 1));
    expect(result.current.slow).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.slow).toBe(true);
    act(() => result.current.stop());
    expect(result.current.current).toBeNull();
    expect(result.current.slow).toBe(false);
  });
});

type Api = typeof botPageApi;
function fakeApi(final: PublicFinal, steps: PublicStep[] = BOOKING) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(r => (release = r));
  const api = {
    page: vi.fn().mockResolvedValue(PAGE),
    session: vi.fn().mockResolvedValue({ state: "ready", intakeDone: true, signedInAs: null }),
    conversation: vi.fn().mockResolvedValue({ conversationId: "c1", messages: [] }),
    newConversation: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(
      async (
        _slug: string,
        _text: string,
        handlers: { onActivity?(s: PublicStep): void; onToken(t: string): void },
      ) => {
        for (const step of steps) handlers.onActivity?.(step);
        await gate;
        handlers.onToken(final.reply);
        return final;
      },
    ),
  };
  return { api: api as unknown as Api, release: () => release() };
}

describe("the bot page", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
  });

  it("shows the steps while it works, then a quiet line and the booking's card", async () => {
    const user = userEvent.setup();
    const { api, release } = fakeApi({
      reply: "Done: you're booked for Thursday 19 Nov at 11:00.",
      citations: [{ title: "Appointments · Thu 19 Nov 2026, 11:00", url: null }],
      messageId: "m2",
      conversationId: "c1",
      steps: BOOKING.slice(0, 2),
      confirmation: {
        action: "create",
        list: "Appointments",
        title: "Thu 19 Nov 2026, 11:00",
        details: [{ label: "Status", value: "booked" }],
      },
    });
    render(<BotPageApp slug="lakeview" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Your message"), "book thursday 11{Enter}");

    expect(await screen.findByTestId("live-step")).toHaveTextContent("Reading your message…");
    await waitFor(() =>
      expect(screen.getByTestId("live-step")).toHaveTextContent("Checking free times…"),
    );
    // Screen readers hear the step once, politely, from the status line.
    expect(screen.getByRole("status", { hidden: false })).toHaveTextContent(/free times|Booking/);
    release();

    const done = await screen.findByTestId("steps-done");
    expect(done).toHaveTextContent("Checked free times · Booked Thu 19 Nov, 11:00");
    expect(screen.queryByTestId("live-step")).not.toBeInTheDocument();
    await user.click(within(done).getByRole("button"));
    expect(within(done).getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(within(done).getAllByRole("listitem")).toHaveLength(2);

    const card = screen.getByTestId("confirmation-card");
    expect(card).toHaveTextContent("Booked · Appointments");
    expect(card).toHaveTextContent("Thu 19 Nov, 11:00");
    expect(within(card).getByText("Status")).toBeInTheDocument();
    expect(within(card).getByText("booked")).toBeInTheDocument();
  });

  it("a crisis reply arrives whole, with no steps and no card", async () => {
    const user = userEvent.setup();
    const { api, release } = fakeApi(
      {
        reply: "If this is an emergency, call 112 or an ambulance (108) now.",
        citations: [],
        messageId: "m3",
        conversationId: "c1",
        rateable: false,
      },
      [],
    );
    render(<BotPageApp slug="lakeview" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Your message"), "chest pain{Enter}");
    release();
    await waitFor(() =>
      expect(screen.getAllByText(/call 112 or an ambulance/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("steps-done")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confirmation-card")).not.toBeInTheDocument();
  });

  it("a failed run ends its steps with no step left on screen", async () => {
    const user = userEvent.setup();
    const api = {
      ...fakeApi({ reply: "", citations: [], messageId: "x", conversationId: "c1" }).api,
      send: vi.fn().mockRejectedValue(new BotPageApiError("INTERNAL")),
    } as unknown as Api;
    render(<BotPageApp slug="lakeview" api={api} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.type(await screen.findByLabelText("Your message"), "hello{Enter}");
    await screen.findByRole("alert");
    expect(screen.queryByTestId("live-step")).not.toBeInTheDocument();
  });
});
