import { useCallback, useEffect, useRef } from "react";

import { ApiEndpoints, HttpMethod, LOCAL_STORAGE_KEYS } from "@constants";
import {
  AgentTraceStep,
  ChatbotTestStatus,
  RefreshResponse,
  TestChatbotRequest,
  TestChatbotResponse,
} from "@types";

import { readSse } from "./chatStream/sse";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/** What a streamed Preview reply sends before its `final`. */
export interface ChatbotTestStreamHandlers {
  onStatus(status: ChatbotTestStatus): void;
  onStep(step: AgentTraceStep): void;
  /** Reply text the check and the crisis check have both cleared. */
  onToken(text: string): void;
}

/**
 * The stream could not start (a network error, an error status, or it closed before its first
 * event). Nothing ran that the person saw, so the caller asks `/test` instead.
 */
export class ChatbotTestStreamUnavailable extends Error {
  constructor(readonly status?: number) {
    super("The streamed test could not start");
    this.name = "ChatbotTestStreamUnavailable";
  }
}

type StreamEvent =
  | { type: "run_started"; data: { run_id: string } }
  | { type: "status"; data: ChatbotTestStatus }
  | { type: "step"; data: AgentTraceStep }
  | { type: "token"; data: { text: string } }
  | { type: "final"; data: TestChatbotResponse }
  | { type: "error"; data: { code: string } };

/** Same bearer and one-shot 401 refresh-and-retry as the other admin SSE hooks. */
const fetchWithReauth = async (
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> => {
  const request = (token: string | null) =>
    fetch(url, {
      method: HttpMethod.POST,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

  const response = await request(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN));
  if (response.status !== 401) return response;
  const refreshToken = localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN);
  if (!refreshToken) return response;
  const refreshed = await fetch(`${API_BASE_URL}/api${ApiEndpoints.AUTH.REFRESH}`, {
    method: HttpMethod.POST,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    signal,
  });
  if (!refreshed.ok) return response;
  const tokens = (await refreshed.json()) as RefreshResponse;
  localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN, tokens.accessToken);
  localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN, tokens.refreshToken);
  return request(tokens.accessToken);
};

/**
 * One Preview message over SSE (POST /v1/chatbots/:id/test/stream). `run` resolves with the same
 * result `/test` returns — the stream's `final` — while the handlers see the agent work. It
 * rejects with `ChatbotTestStreamUnavailable` when the stream never started, so the caller can
 * fall back to `/test`; after the first event it never re-sends (that would run the bot twice).
 *
 * The request is aborted on unmount and by `cancel` (New thread), which stops the run.
 */
export const useChatbotTestStream = () => {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const run = useCallback(
    async (
      { id, ...body }: TestChatbotRequest,
      handlers: ChatbotTestStreamHandlers,
    ): Promise<TestChatbotResponse> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let response: Response;
      try {
        response = await fetchWithReauth(
          `${API_BASE_URL}/api${ApiEndpoints.CHATBOTS.TEST_STREAM(id)}`,
          body,
          controller.signal,
        );
      } catch {
        if (controller.signal.aborted) throw new Error("cancelled");
        throw new ChatbotTestStreamUnavailable();
      }
      if (!response.ok || !response.body) {
        throw new ChatbotTestStreamUnavailable(response.status);
      }

      let started = false;
      let final: TestChatbotResponse | undefined;
      try {
        ({ started } = await readSse(response.body, raw => {
          started = true;
          const event = raw as StreamEvent;
          if (event.type === "final") {
            final = event.data;
            return true;
          }
          if (event.type === "error") throw new Error(event.data.code);
          if (event.type === "status") handlers.onStatus(event.data);
          else if (event.type === "step") handlers.onStep(event.data);
          else if (event.type === "token") handlers.onToken(event.data.text);
          return false;
        }));
      } catch (error) {
        if (!started && !controller.signal.aborted) throw new ChatbotTestStreamUnavailable();
        throw error;
      }
      if (final) return final;
      if (!started) throw new ChatbotTestStreamUnavailable();
      throw new Error("The test ended without a reply");
    },
    [],
  );

  return { run, cancel };
};
