import { readSse } from "../hooks/chatStream/sse";

import type {
  AnswerFeedback,
  BotPageErrorCode,
  PublicBotPage,
  PublicFinal,
  PublicMessage,
  PublicSession,
  StatusCode,
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
 * Every call sends the visitor cookie (httpOnly, set by ally-be) and nothing else: no admin token,
 * no stored ids. A non-2xx answer becomes a BotPageApiError carrying ally-be's `errorCode`.
 */
async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
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
  page: (slug: string) => call<PublicBotPage>(url(slug)),

  session: (slug: string, body: { email?: string; turnstileToken?: string } = {}) =>
    call<PublicSession>(url(slug, "/session"), { method: "POST", body: JSON.stringify(body) }),

  verify: (slug: string, email: string, code: string) =>
    call<PublicSession>(url(slug, "/otp/verify"), {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

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
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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
