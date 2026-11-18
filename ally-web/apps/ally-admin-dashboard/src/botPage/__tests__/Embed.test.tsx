import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BotPageApiError, type botPageApi } from "../api";
import { BotPageApp } from "../BotPageApp";
import { bridge, embedContext } from "../embed";
import type { PublicBotPage, PublicSession } from "../types";

const HOST = "https://sunrisemind.in";

const PAGE: PublicBotPage = {
  slug: "sunrise-mind",
  access: "invite",
  branding: {
    logoUrl: null,
    accentColour: "#0F766E",
    title: "Sunrise Mind",
    subtitle: "",
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

type Api = typeof botPageApi;

function fakeApi(over: Partial<Record<keyof Api, unknown>> = {}) {
  return {
    startEmbed: vi.fn().mockResolvedValue(undefined),
    page: vi.fn().mockResolvedValue(PAGE),
    session: vi
      .fn()
      .mockResolvedValue({ state: "needs_email", intakeDone: false, signedInAs: null }),
    verify: vi.fn(),
    intake: vi.fn(),
    conversation: vi.fn().mockRejectedValue(new BotPageApiError("BOT_PAGE_START_AGAIN", 401)),
    newConversation: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    askForPerson: vi.fn(),
    feedback: vi.fn(),
    send: vi.fn(),
    ...over,
  } as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

/** A window as the browser shows it to a framed page. */
const framedWindow = (opts: { ancestors?: string[]; referrer?: string; search?: string }) =>
  ({
    top: {},
    self: {},
    location: {
      search: opts.search ?? "?embed=1&page=https%3A%2F%2Fsunrisemind.in%2Ffees",
      ancestorOrigins: opts.ancestors,
    },
    document: { referrer: opts.referrer ?? "" },
  }) as unknown as Window;

describe("the website widget's frame (chunk 13)", () => {
  describe("embedContext: the host comes from the browser, never the URL", () => {
    it("is null on the page itself", () => {
      const win = { top: null, self: null, location: { search: "?embed=1" } } as unknown as Window;
      (win as unknown as { top: unknown }).top = win;
      (win as unknown as { self: unknown }).self = win;
      expect(embedContext(win)).toBeNull();
    });

    it("takes the ancestor origin (Chrome, Safari), else the referrer's origin (Firefox)", () => {
      expect(embedContext(framedWindow({ ancestors: [HOST] }))).toEqual({
        host: HOST,
        page: "https://sunrisemind.in/fees",
      });
      expect(
        embedContext(framedWindow({ referrer: "https://sunrisemind.in/contact?x=1" }))?.host,
      ).toBe(HOST);
    });

    it("finds no host when the browser names none: the page then refuses (fails closed)", () => {
      expect(embedContext(framedWindow({}))?.host).toBeNull();
      expect(embedContext(framedWindow({ referrer: "about:blank" }))?.host).toBeNull();
    });

    it("treats any framing as the widget, ?embed=1 or not", () => {
      expect(embedContext(framedWindow({ ancestors: [HOST], search: "" }))?.host).toBe(HOST);
    });
  });

  describe("bridge", () => {
    it("posts only to the host, and hears only the parent on that origin", () => {
      const heard = vi.fn();
      const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
      const link = bridge(HOST, heard);
      link.post({ type: "ally:close" });
      expect(post).toHaveBeenCalledWith({ type: "ally:close" }, HOST);

      const send = (origin: string, source: MessageEventSource | null, type = "ally:closed") =>
        window.dispatchEvent(new MessageEvent("message", { origin, source, data: { type } }));
      send("https://evil.example", window.parent);
      send(HOST, null);
      send(HOST, window.parent, "ally:steal");
      expect(heard).not.toHaveBeenCalled();
      send(HOST, window.parent);
      expect(heard).toHaveBeenCalledWith({ type: "ally:closed" });
      link.stop();
      post.mockRestore();
    });
  });

  describe("BotPageApp in the widget", () => {
    let post: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
      post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    });
    afterEach(() => post.mockRestore());

    it("skips the cover, checks cookies on this host first, and can close the panel", async () => {
      const user = userEvent.setup();
      const api = fakeApi();
      render(<BotPageApp slug="sunrise-mind" api={api} embed={{ host: HOST, page: null }} />);
      await screen.findByRole("heading", { name: "Confirm your email" });
      expect(api.startEmbed).toHaveBeenCalledWith("sunrise-mind", HOST, null);
      expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
      expect(post).toHaveBeenCalledWith({ type: "ally:ready" }, HOST);

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(post).toHaveBeenCalledWith({ type: "ally:close" }, HOST);
    });

    it("refuses when the browser named no host, with no way to retry", async () => {
      const api = fakeApi();
      render(<BotPageApp slug="sunrise-mind" api={api} embed={{ host: null, page: null }} />);
      expect(
        await screen.findByText("This chat isn't available on this website."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
      expect(api.page).not.toHaveBeenCalled();
    });

    it("says so when ally-be refuses the website", async () => {
      const api = fakeApi({
        session: vi.fn().mockRejectedValue(new BotPageApiError("BOT_PAGE_HOST_NOT_ALLOWED", 403)),
      });
      render(<BotPageApp slug="sunrise-mind" api={api} embed={{ host: HOST, page: null }} />);
      expect(
        await screen.findByText("This chat isn't available on this website."),
      ).toBeInTheDocument();
    });

    it("in the chat: Close in the header, Talk to a person, and a dot for replies while shut", async () => {
      const user = userEvent.setup();
      let push: ((event: unknown) => void) | undefined;
      const api = fakeApi({
        conversation: vi.fn().mockResolvedValue({
          conversationId: "c1",
          messages: [
            {
              id: "m1",
              role: "user",
              text: "Hi",
              citations: [],
              createdAt: "",
              rateable: false,
            },
          ],
        }),
        session: vi.fn().mockResolvedValue({
          state: "ready",
          intakeDone: true,
          signedInAs: null,
        } as PublicSession),
        listen: vi.fn(
          (_slug: string, onEvent: (event: unknown) => void, signal: AbortSignal) =>
            new Promise<void>(resolve => {
              push = onEvent;
              onEvent({ type: "hello", conversationId: "c1", by: "person" });
              signal.addEventListener("abort", () => resolve());
            }),
        ),
      });
      render(<BotPageApp slug="sunrise-mind" api={api} embed={{ host: HOST, page: null }} />);
      await screen.findByText("Hi");
      expect(screen.getByRole("button", { name: "Talk to a person" })).toBeInTheDocument();

      // The loader says the panel is shut; a team reply then asks for the dot.
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: HOST,
            source: window.parent,
            data: { type: "ally:closed" },
          }),
        );
      });
      await waitFor(() => expect(push).toBeDefined());
      act(() =>
        push!({
          type: "message",
          id: "m3",
          role: "agent_human",
          text: "Hi, I'm here.",
          sender: "Asha from Sunrise Mind",
          createdAt: "",
        }),
      );
      expect(post).toHaveBeenCalledWith({ type: "ally:unread", count: 1 }, HOST);

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(post).toHaveBeenCalledWith({ type: "ally:close" }, HOST);
    });

    it("the bot page itself is unchanged: the cover, no Close", async () => {
      const api = fakeApi();
      render(<BotPageApp slug="sunrise-mind" api={api} />);
      expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      expect(api.startEmbed).not.toHaveBeenCalled();
    });
  });
});
