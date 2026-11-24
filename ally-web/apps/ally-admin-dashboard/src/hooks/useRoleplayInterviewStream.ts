import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import { ApiEndpoints, en, HttpMethod, LOCAL_STORAGE_KEYS } from "@constants";
import {
  AgentChatMessage,
  AgentQuestionEvent,
  AgentStructuredAnswer,
  RefreshResponse,
  RoleplayInterviewBrief,
  RoleplayInterviewPlan,
  RoleplayInterviewServerMessage,
} from "@types";

import { normalizeAgentReceipt } from "../utils/agentReceipt";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

let counter = 0;
const nextId = () => globalThis.crypto?.randomUUID?.() ?? `rim_${Date.now()}_${++counter}`;

interface StreamEvent {
  type: string;
  data: Record<string, any>;
}

/** SSE frames out of `buffer`, and the partial frame still arriving. Exported for tests. */
export const parseSseBuffer = (buffer: string): { events: StreamEvent[]; rest: string } => {
  const events: StreamEvent[] = [];
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    let type = "";
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!type || !data.length) continue;
    try {
      events.push({ type, data: JSON.parse(data.join("\n")) });
    } catch {
      /* a malformed frame is dropped */
    }
  }
  return { events, rest };
};

/**
 * The feed from persisted rows (reopening a roleplay). A question card is shown answered when the
 * trainer spoke after it, so a reload never offers an old card as if it were still open.
 */
export const mapInterviewMessagesToFeed = (
  rows: RoleplayInterviewServerMessage[],
): AgentChatMessage[] => {
  const feed: AgentChatMessage[] = [];
  rows.forEach((row, index) => {
    const nextUser = rows.slice(index + 1).find(r => r.role === "user");
    if (row.role === "user") {
      // An answer is drawn on the card it answers, when that card is the one just before it.
      const previous = rows[index - 1];
      if (previous?.role === "assistant" && previous.questions?.length) return;
      feed.push({ id: `srv_${row.seq}`, role: "user", content: row.content ?? "" });
      return;
    }
    const receipt = normalizeAgentReceipt(row.receipt);
    if (row.content || row.error || receipt) {
      feed.push({
        id: `srv_${row.seq}`,
        role: "assistant",
        content: row.content ?? "",
        ...(row.error ? { error: row.error } : {}),
        ...(receipt ? { receipt } : {}),
      } as AgentChatMessage);
    }
    for (const question of row.questions ?? []) {
      feed.push({
        id: `srv_${row.seq}_q_${question.id}`,
        role: "assistant",
        content: question.prompt,
        question,
        ...(nextUser ? { answeredWith: nextUser.content } : {}),
      });
    }
  });
  return feed;
};

interface Options {
  sessionId: string | null;
  onBrief?: (brief: RoleplayInterviewBrief, stillNeeded: string[]) => void;
  onPlan?: (plan: RoleplayInterviewPlan, planVersion: number) => void;
  onDone?: (done: { messageSeq?: number; sessionStatus?: string }) => void;
}

/**
 * Drives one roleplay interview turn (POST …/messages/stream) with the same bearer and one-shot
 * refresh the rest of the admin uses. The reply arrives as one `token` frame once checked; a
 * `question` frame adds a card; `brief` and `plan` frames update the panel and the plan card.
 */
export const useRoleplayInterviewStream = ({ sessionId, onBrief, onPlan, onDone }: Options) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  // Latest callbacks, read inside the stream loop.
  const handlers = useRef({ onBrief, onPlan, onDone });
  handlers.current = { onBrief, onPlan, onDone };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const patch = useCallback((id: string, update: Partial<AgentChatMessage>) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...update } : m)));
  }, []);

  const request = useCallback(async (url: string, body: unknown, signal: AbortSignal) => {
    const send = (token: string | null) =>
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
    let response = await send(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN));
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
    response = await send(tokens.accessToken);
    return response;
  }, []);

  const handle = useCallback(
    (event: StreamEvent) => {
      const id = assistantIdRef.current;
      switch (event.type) {
        case "token":
          if (id) {
            const delta = String(event.data.delta ?? "");
            setMessages(prev =>
              prev.map(m => (m.id === id ? { ...m, content: m.content + delta } : m)),
            );
          }
          break;
        case "question": {
          const question = event.data as AgentQuestionEvent;
          setMessages(prev => [
            ...prev,
            { id: nextId(), role: "assistant", content: question.prompt, question },
          ]);
          break;
        }
        case "brief":
          handlers.current.onBrief?.(event.data.brief ?? {}, event.data.stillNeeded ?? []);
          break;
        case "plan":
          handlers.current.onPlan?.(event.data.plan, Number(event.data.planVersion) || 0);
          break;
        case "receipt": {
          const receipt = normalizeAgentReceipt(event.data);
          if (receipt && id) patch(id, { receipt } as Partial<AgentChatMessage>);
          break;
        }
        case "error":
          if (event.data.code === "turn_in_progress") {
            toast.error(en.roleplayInterview.busy);
            break;
          }
          if (id) patch(id, { error: event.data.message || en.roleplayInterview.failed });
          break;
        case "done":
          handlers.current.onDone?.(event.data);
          break;
        default:
          break;
      }
    },
    [patch],
  );

  /**
   * One turn. An answer to a card marks the card answered instead of adding a bubble that says
   * the same thing. Resolves false when nothing reached the server.
   */
  const send = useCallback(
    async (
      text: string,
      opts?: { questionId?: string; answer?: AgentStructuredAnswer },
      hideUserBubble = false,
    ): Promise<boolean> => {
      const trimmed = text.trim();
      if (!sessionId || abortRef.current || (!trimmed && !opts?.answer)) return false;
      const assistantId = nextId();
      const userId = nextId();
      assistantIdRef.current = assistantId;
      setMessages(prev => {
        const assistant: AgentChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
        };
        if (opts?.questionId) {
          return [
            ...prev.map(m =>
              m.question?.id === opts.questionId
                ? { ...m, answeredWith: trimmed, answeredAnswer: opts.answer }
                : m,
            ),
            assistant,
          ];
        }
        return hideUserBubble
          ? [...prev, assistant]
          : [...prev, { id: userId, role: "user", content: trimmed }, assistant];
      });
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      const answer = opts?.answer
        ? {
            ...(opts.answer.selectedOptionIds?.length
              ? { optionIds: opts.answer.selectedOptionIds }
              : {}),
            ...(opts.answer.customValues?.length
              ? { text: opts.answer.customValues.join("; ") }
              : {}),
          }
        : undefined;
      try {
        const response = await request(
          `${API_BASE_URL}/api${ApiEndpoints.SIMULATION_STUDIO.ROLEPLAY_INTERVIEW_STREAM(sessionId)}`,
          {
            ...(trimmed && !opts?.questionId ? { text: trimmed } : {}),
            ...(opts?.questionId ? { questionId: opts.questionId } : {}),
            ...(answer ? { answer } : {}),
            ...(opts?.questionId && trimmed && !answer?.optionIds && !answer?.text
              ? { answer: { text: trimmed } }
              : {}),
          },
          controller.signal,
        );
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseBuffer(buffer);
          buffer = rest;
          events.forEach(handle);
        }
        patch(assistantId, { isStreaming: false });
        return true;
      } catch {
        if (controller.signal.aborted) {
          patch(assistantId, { isStreaming: false, interrupted: true });
        } else {
          patch(assistantId, { isStreaming: false, error: en.roleplayInterview.failed });
          toast.error(en.roleplayInterview.failed);
        }
        return !controller.signal.aborted;
      } finally {
        abortRef.current = null;
        assistantIdRef.current = null;
        if (mountedRef.current) setIsStreaming(false);
      }
    },
    [handle, patch, request, sessionId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const hydrate = useCallback(
    (rows: RoleplayInterviewServerMessage[]) => setMessages(mapInterviewMessagesToFeed(rows)),
    [],
  );
  const reset = useCallback(() => setMessages([]), []);

  return { messages, isStreaming, send, stop, hydrate, reset };
};
