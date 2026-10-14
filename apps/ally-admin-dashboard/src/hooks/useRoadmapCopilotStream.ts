import { useCallback, useEffect, useRef, useState } from "react";

import { ApiEndpoints, HttpMethod, LOCAL_STORAGE_KEYS } from "@constants";
import {
  RefreshResponse,
  RoadmapCopilotActivity,
  RoadmapInterviewMessage,
  RoadmapInterviewTurn,
  RoadmapOpportunityBrief,
} from "@types";
import { logger } from "@utils";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/** What the copilot stream carries. `turn` or `error` always ends it; `ping` is ignored. */
export type RoadmapCopilotStreamEvent =
  | { type: "activity"; data: { id: string; label: string } }
  | { type: "activity_done"; data: { id: string; summary: string; ok: boolean } }
  | { type: "turn"; data: RoadmapInterviewTurn }
  | { type: "error"; data: { message: string } }
  | { type: "ping"; data: unknown };

/**
 * Parses complete SSE frames out of `buffer`, returning them plus the unconsumed remainder (a
 * frame still streaming in). Exported for unit tests.
 */
export const parseCopilotSse = (
  buffer: string,
): { events: RoadmapCopilotStreamEvent[]; rest: string } => {
  const events: RoadmapCopilotStreamEvent[] = [];
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    let eventName = "";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!eventName || dataLines.length === 0) continue;
    try {
      events.push({
        type: eventName,
        data: JSON.parse(dataLines.join("\n")),
      } as RoadmapCopilotStreamEvent);
    } catch {
      logger.warn(`[Roadmap copilot] Dropping malformed SSE frame for event "${eventName}"`);
    }
  }
  return { events, rest };
};

const FAILED = "That answer did not go through.";

/**
 * Drives one opportunity-copilot turn over SSE (POST ai/opportunity-interview/stream).
 *
 * `runTurn` resolves with the turn (and the lookups it made) or rejects with a message — the same contract the drawer had
 * with the JSON mutation — while `activity` fills in as the copilot researches, so a turn that
 * spends a minute reading analytics shows what it is doing instead of "Thinking…". Activity is
 * reset at the start of each turn: it describes this turn's work, not the conversation's.
 *
 * Same bearer + one-shot 401-refresh-retry as the other admin SSE hooks.
 */
export const useRoadmapCopilotStream = () => {
  const [activity, setActivity] = useState<RoadmapCopilotActivity[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fetchWithReauth = useCallback(
    async (url: string, body: unknown, signal: AbortSignal): Promise<Response> => {
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
    },
    [],
  );

  const runTurn = useCallback(
    async (body: {
      messages: RoadmapInterviewMessage[];
      brief: RoadmapOpportunityBrief | null;
    }): Promise<{ turn: RoadmapInterviewTurn; activity: RoadmapCopilotActivity[] }> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // Kept locally as well as in state, so the finished turn can hand its trail to the caller
      // without the caller reading state that has not re-rendered yet.
      let trail: RoadmapCopilotActivity[] = [];
      const record = (next: RoadmapCopilotActivity[]) => {
        trail = next;
        setActivity(next);
      };
      record([]);
      setIsThinking(true);

      try {
        const response = await fetchWithReauth(
          `${API_BASE_URL}/api${ApiEndpoints.PRODUCT_ROADMAP.AI_OPPORTUNITY_INTERVIEW_STREAM}`,
          // `brief: null` is omitted rather than sent: the DTO validates it as an object.
          { messages: body.messages, ...(body.brief ? { brief: body.brief } : {}) },
          controller.signal,
        );
        if (!response.ok || !response.body) throw new Error(FAILED);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseCopilotSse(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            if (event.type === "activity") {
              record([
                ...trail,
                { id: event.data.id, label: event.data.label, summary: null, ok: null },
              ]);
            } else if (event.type === "activity_done") {
              record(
                trail.map(item =>
                  item.id === event.data.id
                    ? { ...item, summary: event.data.summary, ok: event.data.ok }
                    : item,
                ),
              );
            } else if (event.type === "turn") {
              return { turn: event.data, activity: trail };
            } else if (event.type === "error") {
              throw new Error(event.data.message || FAILED);
            }
          }
        }
        // The stream closed without a turn — a dropped connection, not an answer.
        throw new Error(FAILED);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsThinking(false);
        }
      }
    },
    [fetchWithReauth],
  );

  return { runTurn, activity, isThinking };
};
