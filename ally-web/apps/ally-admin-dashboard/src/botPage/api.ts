import { readSse } from "../hooks/chatStream/sse";

import type {
  AnswerFeedback,
  BotPageErrorCode,
  PublicBotPage,
  PublicFinal,
  PublicMessage,
  PublicSession,
  StatusCode,
  VisitorEvent,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/** A refusal or failure the page explains in its own words. */
export class BotPageApiError extends Error {
  constructor(
    readonly code: BotPageErrorCode,
    readonly status = 0,
    readonly retryAfterSeconds?: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "BotPageApiError";
  }
}

const url = (slug: string, path = "") =>
  `${API_BASE_URL}/api/v1/public/bots/${encodeURIComponent(slug)}${path}`;

/**
 * Inside the website widget (chunk 13): where the frame is, and how the visitor is carried. Its own
 * partitioned cookie when the browser lets that through; otherwise a token ally-be hands over on
 * request, held here in memory only (a reload starts the chat again).
 */
let embed: { host: string; page: string | null; askToken: boolean; token: string | null } | null =
  null;

const embedHeaders = (): Record<string, string> =>
  embed
    ? {
        "X-Ally-Embed": "1",
        ...(embed.askToken ? { "X-Ally-Embed-Token": "1" } : {}),
        ...(embed.token ? { "X-Ally-Visitor": embed.token } : {}),
      }
    : {};

const embedBody = () => (embed ? { embed: { host: embed.host, page: embed.page } } : {});

/** Keep the widget's token when ally-be sends one. */
const keepToken = (session: PublicSession): PublicSession => {
  if (embed && session.visitorToken) embed.token = session.visitorToken;
  return session;
};

/**
 * Every call sends the visitor cookie (httpOnly, set by ally-be) and nothing else: no admin token,
 * no stored ids. A non-2xx answer becomes a BotPageApiError carrying ally-be's `errorCode`.
 */
async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...embedHeaders(), ...(init.headers ?? {}) },
    });
  } catch {
    throw new BotPageApiError("NETWORK");
  }
  if (!response.ok) throw await toError(response);
  return (await response.json()) as T;
}

async function toError(response: Response): Promise<BotPageApiError> {
  let body: {
    errorCode?: BotPageErrorCode;
    retryAfterSeconds?: number;
    details?: Record<string, unknown>;
  } = {};
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON error body: the status alone has to do.
  }
  return new BotPageApiError(
    body.errorCode ?? (response.status === 404 ? "BOT_PAGE_NOT_FOUND" : "INTERNAL"),
    response.status,
    body.retryAfterSeconds,
    body.details,
  );
}

export const botPageApi = {
  /**
   * Run inside the website widget, on this host: check whether the widget's cookie gets through
   * (a throwaway one, set and read back); if not, ask ally-be for the in-memory token from now on.
   */
  async startEmbed(slug: string, host: string, page: string | null): Promise<void> {
    embed = { host, page, askToken: false, token: null };
    try {
      await fetch(url(slug, "/embed/probe"), {
        method: "POST",
        credentials: "include",
        headers: embedHeaders(),
      });
      const probe = await call<{ cookies: boolean }>(url(slug, "/embed/probe"));
      embed.askToken = !probe.cookies;
    } catch {
      embed.askToken = true;
    }
  },

  page: (slug: string) => call<PublicBotPage>(url(slug)),

  session: (slug: string, body: { email?: string; turnstileToken?: string } = {}) =>
    call<PublicSession>(url(slug, "/session"), {
      method: "POST",
      body: JSON.stringify({ ...body, ...embedBody() }),
    }).then(keepToken),

  verify: (slug: string, email: string, code: string) =>
    call<PublicSession>(url(slug, "/otp/verify"), {
      method: "POST",
      body: JSON.stringify({ email, code, ...embedBody() }),
    }).then(keepToken),

  intake: (slug: string, answers: { id: string; value: string }[]) =>
    call<{ intakeDone: true }>(url(slug, "/intake"), {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),

  conversation: (slug: string) =>
    call<{ conversationId: string | null; messages: PublicMessage[] }>(url(slug, "/conversation")),

  /** "Was this helpful?" on one answer; rating again changes it (chunk Q2a). */
  feedback: (slug: string, messageId: string, body: AnswerFeedback) =>
    call<{ rating: "up" | "down" }>(url(slug, `/messages/${messageId}/feedback`), {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** "Talk to a person" (chunk 11a): asks the team to join; returns what the visitor is told. */
  askForPerson: (slug: string) =>
    call<{ reply: string; messageId: string; conversationId: string }>(url(slug, "/handover"), {
      method: "POST",
      body: "{}",
    }),

  /**
   * The visitor's live stream (chunk 11a): a team member's replies and changes of hands, as they
   * happen. Resolves when the stream ends (no chat yet, or the connection dropped).
   */
  async listen(
    slug: string,
    onEvent: (event: VisitorEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(url(slug, "/conversation/events"), {
      credentials: "include",
      headers: { Accept: "text/event-stream", ...embedHeaders() },
      signal,
    });
    if (!response.ok || !response.body) throw await toError(response);
    await readSse(response.body, event => {
      onEvent({ ...(event.data as object), type: event.type } as VisitorEvent);
      return false;
    });
  },

  newConversation: (slug: string) =>
    call<{ ok: true }>(url(slug, "/conversation/new"), { method: "POST", body: "{}" }),

  /**
   * One message, streamed: status codes and checked text as they come, then the stored reply.
   * Refusals before the reply (limits, busy, pre-chat questions) are plain HTTP errors.
   */
  async send(
    slug: string,
    message: string,
    handlers: { onStatus(code: StatusCode): void; onToken(text: string): void },
    signal?: AbortSignal,
  ): Promise<PublicFinal> {
    let response: Response;
    try {
      response = await fetch(url(slug, "/messages/stream"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...embedHeaders(),
        },
        body: JSON.stringify({ message }),
        signal,
      });
    } catch {
      throw new BotPageApiError("NETWORK");
    }
    if (!response.ok || !response.body) throw await toError(response);

    let final: PublicFinal | undefined;
    try {
      await readSse(response.body, event => {
        if (event.type === "final") {
          final = event.data as PublicFinal;
          return true;
        }
        if (event.type === "error") throw new BotPageApiError("INTERNAL");
        if (event.type === "status") handlers.onStatus((event.data as { code: StatusCode }).code);
        else if (event.type === "token") handlers.onToken((event.data as { text: string }).text);
        return false;
      });
    } catch (error) {
      if (error instanceof BotPageApiError) throw error;
      throw new BotPageApiError("NETWORK");
    }
    if (!final) throw new BotPageApiError("NETWORK");
    return final;
  },
};
