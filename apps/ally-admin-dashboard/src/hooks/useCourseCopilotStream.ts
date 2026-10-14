import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import { ApiEndpoints, en, HttpMethod, LOCAL_STORAGE_KEYS } from "@constants";
import {
  CourseBrief,
  CourseBriefReadiness,
  CourseCopilotBlueprintResponse,
  CourseCopilotDoneEvent,
  CourseCopilotFeedMessage,
  CourseCopilotQuestionEvent,
  CourseCopilotServerMessage,
  CourseCopilotStreamEvent,
  CourseCopilotStructuredAnswer,
  CourseOutline,
  RefreshResponse,
} from "@types";
import { logger } from "@utils";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * The opening turn of a brand-new session. Sent hidden (no trainer bubble), so the copilot asks its
 * first question without the trainer having to type anything. The server stores it like any user
 * row, so a resumed feed has to drop it again — see `mapServerMessagesToFeed`.
 */
export const COURSE_COPILOT_KICKOFF_MESSAGE = "Let's begin.";

let messageIdCounter = 0;
/** Collision-proof client message id: Date.now() collides under fast sends. */
const nextMessageId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `cmsg_${uuid}`;
  return `cmsg_${Date.now().toString(36)}_${++messageIdCounter}`;
};

/**
 * Tools whose `tool_result.summary` is worth a small note in the feed: the library search, the
 * blueprint tools, design guidance, and every edit-mode tool that changes the course. Everything
 * else (`update_brief`, `ask_trainer`, catalogue lookups, `get_item`) is plumbing the trainer
 * should not have to read — the brief pane and the question card already show what those did.
 */
const TOOL_NOTE_NAMES = new Set([
  "search_library",
  "propose_blueprint",
  "update_blueprint",
  "design_guidance_search",
  // Edit tools.
  "update_course_meta",
  "update_section",
  "add_section",
  "remove_section",
  "move_section",
  "add_item",
  "regenerate_item",
  "update_item_content",
  "remove_item",
  "move_item",
  "set_completion_rule",
  "set_item_reference",
  "generate_cover_image",
  "assign_to_tenants",
  "request_translation",
  "publish_course",
  "duplicate_course",
]);

/**
 * Error codes a retry can plausibly fix, so the bubble offers a Retry chip. `provider_*` is a
 * prefix match by contract (it includes auth and quota failures — the chip is cheap and the
 * server's own message says what is wrong); the rest are listed. Everything else — misconfigured,
 * structure_locked, budget_exceeded, request_too_large, copilot_error — would fail the same way
 * again, so it only shows the server's message.
 */
const RETRYABLE_CODES = new Set([
  "invalid_tool_call",
  "empty_turn",
  "response_truncated",
  "stream_failed",
]);
const isRetryableCode = (code: unknown): boolean =>
  typeof code === "string" && (code.startsWith("provider_") || RETRYABLE_CODES.has(code));

/**
 * Parses SSE frames out of `buffer`. Returns the parsed events plus the unconsumed remainder (a
 * partial frame still streaming in) and how many frames failed to parse — surfaced rather than
 * only logged, because a dropped frame takes its content (a token, a blueprint) out of the feed
 * with nothing to tell the trainer anything went missing. Exported for unit tests.
 */
export const parseSseBuffer = (
  buffer: string,
): { events: CourseCopilotStreamEvent[]; rest: string; droppedCount: number } => {
  const events: CourseCopilotStreamEvent[] = [];
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  let droppedCount = 0;

  for (const frame of frames) {
    let eventName = "";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      // Comments (":") and other fields (id:, retry:) are ignored.
    }
    if (!eventName || dataLines.length === 0) continue;
    try {
      const data = JSON.parse(dataLines.join("\n"));
      events.push({ type: eventName, data } as CourseCopilotStreamEvent);
    } catch {
      logger.warn(`[Course Copilot] Dropping malformed SSE frame for event "${eventName}"`);
      droppedCount += 1;
    }
  }

  return { events, rest, droppedCount };
};

/** Strips the deterministic answer prefix the server adds to a user turn. */
const ANSWER_PREFIX_RE = /^\[answers question [^\]]+\]\s*/i;

/**
 * …and the structured-answer suffix (" [selected ids: a | custom: \"…\"]"),
 * which is for the model, not the trainer: the card shows the labels.
 */
const ANSWER_SUFFIX_RE = /\s*\[(?:none of these|selected ids:|custom:)[^\]]*\]\s*$/i;

const answerText = (content: string | null | undefined): string =>
  (content ?? "").replace(ANSWER_PREFIX_RE, "").replace(ANSWER_SUFFIX_RE, "");

/** A persisted tool result's `summary`, when it has one — the resume path's version of a tool note. */
const summaryOf = (result: unknown): string | null => {
  if (!result || typeof result !== "object") return null;
  const summary = (result as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
};

/**
 * Rebuilds the chat feed from persisted rows — the resume path, and how a message the server
 * posted outside any turn (the reviewer's post-build notes) reaches the feed. Question cards come
 * from the assistant row's metadata and are marked answered from the *later* user row that
 * references them, which is why this looks ahead rather than rendering each row in isolation.
 * Pure; exported for unit tests.
 *
 * Agent-authored arrays (`questions`, `findings`, `suggestedActions`) are `Array.isArray`-checked:
 * a string where an array was expected once crashed Builder's PRD panel.
 */
export const mapServerMessagesToFeed = (
  rows: CourseCopilotServerMessage[],
): CourseCopilotFeedMessage[] => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const answersByQuestionId = new Map<
    string,
    { text: string; answer?: CourseCopilotStructuredAnswer }
  >();
  /** Questions that will be drawn as their own card further down the feed. */
  const renderedQuestionIds = new Set<string>();

  for (const row of safeRows) {
    const questionId = row.metadata?.questionId;
    if (row.role === "user" && questionId) {
      answersByQuestionId.set(String(questionId), {
        text: answerText(row.content),
        answer: row.metadata?.answer,
      });
    }
    const questions = row.metadata?.questions;
    if (Array.isArray(questions)) {
      for (const question of questions) renderedQuestionIds.add(question.id);
    }
  }

  const feed: CourseCopilotFeedMessage[] = [];
  safeRows.forEach((row, index) => {
    const baseId = `srv_${row.id ?? row.seq ?? index}`;
    const metadata = row.metadata ?? {};
    const content = answerText(row.content);

    if (row.role === "user") {
      // The hidden kickoff turn was never shown as a bubble when it was sent; showing it on resume
      // would read as the trainer having typed "Let's begin."
      if (index === 0 && content.trim() === COURSE_COPILOT_KICKOFF_MESSAGE) return;
      // An answer is drawn once, on the card it answers — twice reads as a double-fired click.
      // Only when that card is actually in this feed: otherwise the text has nowhere else to go
      // and dropping it would lose what the trainer said.
      const answersARenderedCard =
        Boolean(metadata.questionId) && renderedQuestionIds.has(String(metadata.questionId));
      if (content && !answersARenderedCard) feed.push({ id: baseId, role: "user", content });
      return;
    }

    const toolNotes = (Array.isArray(row.toolResults) ? row.toolResults : [])
      .filter(result => result && TOOL_NOTE_NAMES.has(result.name))
      .map(result => summaryOf(result.result))
      .filter((summary): summary is string => Boolean(summary));

    // A turn that died mid-flight leaves a row with no prose. It used to render as nothing, so
    // after a reload the trainer saw their own message answered by silence — indistinguishable from
    // the copilot still thinking. `errored` keeps the failure on screen.
    const errored = Boolean(metadata.errored);
    const errorText = errored
      ? (metadata.errorMessage ?? en.courseCopilot.chat.streamFailed)
      : undefined;
    const findings = metadata.reviewNotes?.findings;
    const suggestedActions = metadata.suggestedActions;
    const hasFindings = Array.isArray(findings) && findings.length > 0;
    const hasActions = Array.isArray(suggestedActions) && suggestedActions.length > 0;

    if (content || errored || toolNotes.length || hasFindings || hasActions) {
      feed.push({
        id: baseId,
        role: "assistant",
        content,
        ...(toolNotes.length ? { toolNotes } : {}),
        ...(errorText ? { error: errorText } : {}),
        // The server does not send a code today; honouring one if it ever does keeps a reloaded
        // provider failure retryable instead of silently dropping the chip.
        ...(errored && isRetryableCode(metadata.errorCode) ? { retryable: true } : {}),
        ...(metadata.interrupted ? { interrupted: true } : {}),
        ...(hasFindings ? { reviewFindings: findings } : {}),
        ...(hasActions ? { suggestedActions } : {}),
      });
    }

    for (const question of Array.isArray(metadata.questions) ? metadata.questions : []) {
      const answered = answersByQuestionId.get(question.id);
      feed.push({
        id: `${baseId}_q_${question.id}`,
        role: "assistant",
        content: question.prompt,
        question,
        ...(answered ? { answeredWith: answered.text, answeredAnswer: answered.answer } : {}),
      });
    }
  });
  return feed;
};

const scheduleFrame: (cb: () => void) => number | ReturnType<typeof setTimeout> =
  typeof requestAnimationFrame === "function"
    ? cb => requestAnimationFrame(cb)
    : cb => setTimeout(cb, 16);

const cancelFrame = (handle: number | ReturnType<typeof setTimeout>) => {
  if (typeof cancelAnimationFrame === "function" && typeof handle === "number") {
    cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

/** Per-message options accepted by `sendMessage` (forwarded in the POST body). */
export interface CourseCopilotSendOptions {
  questionId?: string;
  answer?: CourseCopilotStructuredAnswer;
}

interface UseCourseCopilotStreamOptions {
  sessionId: string | null;
  /** The Brief pane re-renders from this mid-turn, not after it. */
  onBrief?: (brief: CourseBrief, readiness: CourseBriefReadiness) => void;
  /** The pane switches to the Blueprint tab and re-renders the tree. */
  onBlueprint?: (response: CourseCopilotBlueprintResponse) => void;
  /** An edit tool changed the live course: flash the node, log it, refetch. */
  onCoursePatch?: (patch: { summary: string; outline: CourseOutline | null }) => void;
  /** An edit tool queued background jobs (a regenerated item, a new roleplay). */
  onBuildStarted?: (data: { jobCount: number; estimateUsd?: number }) => void;
  onDone?: (done: CourseCopilotDoneEvent) => void;
  /**
   * The turn has settled — completed, failed, stopped or refused. Distinct from `onDone`, which
   * only fires for a turn the server finished: the page refetches the session here too, so what a
   * stopped or failed turn managed to write server-side still reaches the pane.
   */
  onTurnEnd?: () => void;
  /**
   * Called when a turn fails because the server session no longer exists (SSE `error` with code
   * `session_not_found`). Should create a replacement and resolve its id; the turn is then
   * replayed against it once. Resolve `null` if none can be created.
   */
  onSessionInvalid?: () => Promise<string | null>;
}

/**
 * Drives the Course Copilot SSE stream (POST .../messages/stream) with the same bearer +
 * one-shot-401-refresh flow as baseApi. Forked from `useCharacterInterviewStream` (and borrows
 * Builder's answer-on-the-card handling) rather than shared with either, so neither feature moves.
 *
 * Token deltas are batched per animation frame: setState-per-delta re-renders the whole feed dozens
 * of times a second and the typing visibly stutters, which reads as the copilot struggling.
 *
 * Failure handling follows Stacks "Preserve State During Agent Failure in Multistep Tasks": a
 * failed or stopped turn keeps everything already on screen, says why on the bubble, and offers
 * Retry — it never wipes the feed or restarts the interview. The one exception is a turn the
 * server REFUSED (`turn_in_progress`): nothing of it exists server-side, so its bubbles come back
 * out as though it had never been sent.
 */
export const useCourseCopilotStream = ({
  sessionId,
  onBrief,
  onBlueprint,
  onCoursePatch,
  onBuildStarted,
  onDone,
  onTurnEnd,
  onSessionInvalid,
}: UseCourseCopilotStreamOptions) => {
  const [messages, setMessages] = useState<CourseCopilotFeedMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const pendingTokensRef = useRef("");
  const frameRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  /** What the last `sendMessage` sent, so the Retry chip can send it again. */
  const lastTurnRef = useRef<{ text: string; opts?: CourseCopilotSendOptions } | null>(null);
  /** Highest server message seq already represented in the feed — see `syncServerMessages`. */
  const serverSeqRef = useRef(0);
  /**
   * A turn ended with no `done` frame (stopped, dropped, errored), so what the server wrote for it
   * is already on screen but its seq is unknown. The next sync adopts the server's high-water mark
   * instead of appending, otherwise the stopped turn would be drawn a second time.
   */
  const adoptServerSeqRef = useRef(false);
  const sawDoneRef = useRef(false);
  const sawErrorRef = useRef(false);

  // Callbacks live in a ref so a new function identity each render does not change `sendMessage`'s
  // — the page's kickoff effect depends on it and must not re-fire.
  const callbacksRef = useRef({
    onBrief,
    onBlueprint,
    onCoursePatch,
    onBuildStarted,
    onDone,
    onTurnEnd,
    onSessionInvalid,
  });
  callbacksRef.current = {
    onBrief,
    onBlueprint,
    onCoursePatch,
    onBuildStarted,
    onDone,
    onTurnEnd,
    onSessionInvalid,
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
      if (frameRef.current !== null) cancelFrame(frameRef.current);
    };
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<CourseCopilotFeedMessage>) => {
    setMessages(prev =>
      prev.map(message => (message.id === id ? { ...message, ...patch } : message)),
    );
  }, []);

  /** Flushes any buffered token deltas into the current assistant message. */
  const flushTokens = useCallback(() => {
    if (frameRef.current !== null) {
      cancelFrame(frameRef.current);
      frameRef.current = null;
    }
    const delta = pendingTokensRef.current;
    if (!delta) return;
    pendingTokensRef.current = "";
    const id = currentAssistantIdRef.current;
    if (!id) return;
    setMessages(prev =>
      prev.map(message =>
        message.id === id ? { ...message, content: message.content + delta } : message,
      ),
    );
  }, []);

  const queueToken = useCallback(
    (delta: string) => {
      pendingTokensRef.current += delta;
      if (frameRef.current !== null) return;
      frameRef.current = scheduleFrame(() => {
        frameRef.current = null;
        flushTokens();
      });
    },
    [flushTokens],
  );

  const appendToolNote = useCallback((note: string) => {
    const id = currentAssistantIdRef.current;
    if (!id) return;
    setMessages(prev =>
      prev.map(message =>
        message.id === id
          ? { ...message, toolNotes: [...(message.toolNotes ?? []), note] }
          : message,
      ),
    );
  }, []);

  const handleEvent = useCallback(
    (event: CourseCopilotStreamEvent) => {
      switch (event.type) {
        case "token":
          queueToken(event.data.delta ?? "");
          break;
        case "tool_call":
          // The note is added when the tool RESULT arrives: its summary ("Found 4 matching
          // roleplays") says what actually happened, where the call only says what was attempted.
          flushTokens();
          break;
        case "tool_result": {
          flushTokens();
          const summary = typeof event.data.summary === "string" ? event.data.summary.trim() : "";
          if (TOOL_NOTE_NAMES.has(event.data.name) && summary) appendToolNote(summary);
          break;
        }
        case "question": {
          flushTokens();
          const question = event.data as CourseCopilotQuestionEvent;
          setMessages(prev => [
            ...prev,
            { id: nextMessageId(), role: "assistant", content: question.prompt, question },
          ]);
          break;
        }
        case "brief":
          callbacksRef.current.onBrief?.(event.data.brief, event.data.readiness);
          break;
        case "blueprint":
          flushTokens();
          callbacksRef.current.onBlueprint?.(event.data);
          break;
        case "course_patch":
          callbacksRef.current.onCoursePatch?.(event.data);
          break;
        case "build_started":
          callbacksRef.current.onBuildStarted?.(event.data);
          break;
        case "error": {
          flushTokens();
          sawErrorRef.current = true;
          const id = currentAssistantIdRef.current;
          // The server's message is written for the trainer ("The model was unavailable. Try
          // again."), so it goes on the bubble as is. No toast on top: the bubble is where the
          // Retry chip lives, and a transient toast would say the same thing less durably.
          if (id) {
            patchMessage(id, {
              error: event.data.message || en.courseCopilot.chat.streamFailed,
              isStreaming: false,
              retryable: isRetryableCode(event.data.code),
            });
          }
          break;
        }
        case "ping":
          // Server heartbeat during long generations — keep-alive only.
          break;
        case "done":
          flushTokens();
          sawDoneRef.current = true;
          serverSeqRef.current = Math.max(serverSeqRef.current, event.data.messageSeq ?? 0);
          callbacksRef.current.onDone?.(event.data);
          break;
        default:
          break;
      }
    },
    [appendToolNote, flushTokens, patchMessage, queueToken],
  );

  /** One 401 -> refresh -> retry, mirroring baseApi's reauth flow. */
  const fetchStreamWithReauth = useCallback(
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

      let response = await request(localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN));
      if (response.status !== 401) return response;

      const refreshToken = localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN);
      if (!refreshToken) return response;

      const refreshResponse = await fetch(`${API_BASE_URL}/api${ApiEndpoints.AUTH.REFRESH}`, {
        method: HttpMethod.POST,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        signal,
      });
      if (!refreshResponse.ok) return response;

      const tokens = (await refreshResponse.json()) as RefreshResponse;
      localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN, tokens.accessToken);
      localStorage.setItem(LOCAL_STORAGE_KEYS.ADMIN_REFRESH_TOKEN, tokens.refreshToken);

      response = await request(tokens.accessToken);
      return response;
    },
    [],
  );

  /**
   * Streams one turn against `activeSessionId`, appending the bubbles for it. `session_not_found`
   * and `turn_in_progress` are NOT surfaced here — they are reported back so the caller can
   * recover (replay once) or roll the bubbles back.
   */
  const runStream = useCallback(
    async (
      text: string,
      activeSessionId: string,
      opts: CourseCopilotSendOptions | undefined,
      /** Bootstrap and retry turns: the message is not shown as a trainer bubble. */
      hideUserBubble: boolean,
    ): Promise<{
      userMsgId: string | null;
      assistantId: string;
      /** The question card this turn answered (marked answered instead of adding a bubble). */
      cardId: string | null;
      sessionLost: boolean;
      /** The server refused the turn outright — nothing of it was recorded. */
      refused: boolean;
      aborted: boolean;
    }> => {
      const assistantId = nextMessageId();
      currentAssistantIdRef.current = assistantId;
      pendingTokensRef.current = "";
      sawDoneRef.current = false;
      sawErrorRef.current = false;

      // An answer belongs on the card it answers, and the card is already in the feed — so mark it
      // rather than appending a bubble that says the same thing. Two things were wrong when it did
      // both: the card kept live buttons after being answered (a second click sent it again), and
      // a reload drew the answer in two places.
      // Ids are minted outside the updater, which React may run twice.
      const userMsgId = hideUserBubble ? null : nextMessageId();
      const marked: { cardId: string | null } = { cardId: null };
      setMessages(prev => {
        const card = opts?.questionId
          ? prev.find(message => message.question?.id === opts.questionId)
          : undefined;
        const assistant: CourseCopilotFeedMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
        };
        if (card) {
          marked.cardId = card.id;
          return [
            ...prev.map(message =>
              message.id === card.id
                ? { ...message, answeredWith: text, answeredAnswer: opts?.answer }
                : message,
            ),
            assistant,
          ];
        }
        marked.cardId = null;
        if (!userMsgId) return [...prev, assistant];
        return [...prev, { id: userMsgId, role: "user" as const, content: text }, assistant];
      });

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      let sessionLost = false;
      let refused = false;
      let droppedFrames = 0;

      try {
        const response = await fetchStreamWithReauth(
          `${API_BASE_URL}/api${ApiEndpoints.COURSE_COPILOT.SESSION_MESSAGES_STREAM(activeSessionId)}`,
          {
            message: text,
            ...(opts?.questionId ? { questionId: opts.questionId } : {}),
            ...(opts?.answer ? { answer: opts.answer } : {}),
          },
          controller.signal,
        );

        if (!response.ok || !response.body) {
          throw new Error(`Stream request failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseBuffer(buffer);
          buffer = parsed.rest;
          droppedFrames += parsed.droppedCount;
          for (const event of parsed.events) {
            if (event.type === "error" && event.data.code === "session_not_found") {
              sessionLost = true; // handled by sendMessage; don't surface the raw error
              continue;
            }
            // The session's turn mutex was still held, so the server never read this message: no
            // transcript row, no reply coming. A refusal, not a failed turn — sendMessage rolls
            // the bubbles back so the message can simply be sent again.
            if (event.type === "error" && event.data.code === "turn_in_progress") {
              refused = true;
              continue;
            }
            handleEvent(event);
          }
        }
        flushTokens();
        patchMessage(assistantId, { isStreaming: false });
        // The contract ends every turn with `done`. A stream that closed without one (and without
        // an error frame to explain itself) was cut off — a proxy timeout, a dropped connection —
        // and a bubble left half-written with no marker reads as the copilot having finished.
        if (!sawDoneRef.current && !sawErrorRef.current && !sessionLost && !refused) {
          patchMessage(assistantId, { error: en.courseCopilot.chat.streamFailed, retryable: true });
        }
      } catch (error) {
        flushTokens();
        if (controller.signal.aborted) {
          // Keep the partial text, marked interrupted.
          patchMessage(assistantId, { isStreaming: false, interrupted: true });
        } else if (!sessionLost && !refused) {
          logger.error(`[Course Copilot] ${error}`);
          patchMessage(assistantId, {
            isStreaming: false,
            error: en.courseCopilot.chat.streamFailed,
            retryable: true,
          });
        }
      } finally {
        abortRef.current = null;
        currentAssistantIdRef.current = null;
        if (!sawDoneRef.current && !refused) adoptServerSeqRef.current = true;
        if (isMountedRef.current) {
          setIsStreaming(false);
          if (droppedFrames > 0) toast.warning(en.courseCopilot.chat.droppedFrames(droppedFrames));
        }
      }

      return {
        userMsgId,
        assistantId,
        cardId: marked.cardId,
        sessionLost,
        refused,
        aborted: controller.signal.aborted,
      };
    },
    [fetchStreamWithReauth, flushTokens, handleEvent, patchMessage],
  );

  /** Takes a turn's bubbles back out, and unmarks the card it answered. */
  const rollBackTurn = useCallback(
    (turn: { userMsgId: string | null; assistantId: string; cardId: string | null }) => {
      setMessages(prev =>
        prev
          .filter(message => message.id !== turn.userMsgId && message.id !== turn.assistantId)
          .map(message =>
            message.id === turn.cardId
              ? { ...message, answeredWith: undefined, answeredAnswer: undefined }
              : message,
          ),
      );
    },
    [],
  );

  /**
   * Sends one turn. Resolves `false` when the turn was refused and nothing was recorded — the
   * caller can offer the same answer again as if it had never been given (a question card unlocks
   * itself on that).
   */
  const sendMessage = useCallback(
    async (
      text: string,
      opts?: CourseCopilotSendOptions,
      hideUserBubble = false,
    ): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || !sessionId || abortRef.current) return false;

      lastTurnRef.current = { text: trimmed, opts };
      const settle = () => {
        if (isMountedRef.current) callbacksRef.current.onTurnEnd?.();
      };

      const first = await runStream(trimmed, sessionId, opts, hideUserBubble);
      if (first.refused) {
        // Nothing of this turn exists server-side, so leaving the bubbles up would show a message
        // the copilot never received. Take them back out and say what to do.
        rollBackTurn(first);
        toast.error(en.courseCopilot.chat.turnInProgress);
        settle();
        return false;
      }
      // Anything else reached the server and is in the transcript — including a turn the trainer
      // stopped half-way, which is why Stop doesn't unlock the card either.
      if (!first.sessionLost || first.aborted) {
        settle();
        return true;
      }

      // The server session is gone (e.g. a local DB reset dropped it). Take this attempt's bubbles
      // out, get a replacement and replay the turn once so the trainer never sees the raw error.
      // One recovery attempt is the ceiling: a loop here would hammer the API if creation also fails.
      rollBackTurn(first);
      const freshId = callbacksRef.current.onSessionInvalid
        ? await callbacksRef.current.onSessionInvalid()
        : null;
      if (!freshId) {
        toast.error(en.courseCopilot.chat.streamFailed);
        settle();
        return false;
      }
      // The replacement's messages are numbered from 1; the old session's high-water mark means
      // nothing to it.
      serverSeqRef.current = 0;
      const retry = await runStream(trimmed, freshId, opts, hideUserBubble);
      settle();
      if (retry.refused) {
        rollBackTurn(retry);
        toast.error(en.courseCopilot.chat.turnInProgress);
        return false;
      }
      if (retry.sessionLost && !retry.aborted) {
        patchMessage(retry.assistantId, {
          isStreaming: false,
          error: en.courseCopilot.chat.streamFailed,
          retryable: true,
        });
        return false;
      }
      return true;
    },
    [patchMessage, rollBackTurn, runStream, sessionId],
  );

  /**
   * Re-sends the last turn (the error bubble's Retry chip). The original user bubble is already on
   * screen, so the replay is hidden; the failed bubble stays as the record of what went wrong but
   * loses its chip so a second click cannot send the turn twice.
   */
  const retryLast = useCallback(async (): Promise<boolean> => {
    const last = lastTurnRef.current;
    if (!last || abortRef.current) return false;
    setMessages(prev =>
      prev.map(message => (message.retryable ? { ...message, retryable: false } : message)),
    );
    return sendMessage(last.text, last.opts, true);
  }, [sendMessage]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Seeds the feed from a resumed session (GET .../sessions/:id → messages). */
  const hydrateMessages = useCallback((serverMessages: CourseCopilotServerMessage[]) => {
    const rows = Array.isArray(serverMessages) ? serverMessages : [];
    setMessages(mapServerMessagesToFeed(rows));
    serverSeqRef.current = rows.reduce((max, row) => Math.max(max, row.seq ?? 0), 0);
    adoptServerSeqRef.current = false;
  }, []);

  /**
   * Folds a fresher server snapshot into the feed WITHOUT rebuilding it: appends only the rows the
   * feed has not seen. That is how a message the server posts outside any turn — the reviewer's
   * post-build notes and Retry chips — reaches a trainer who has been watching the build, while a
   * turn they are in the middle of (or just finished) is left exactly as streamed. Rebuilding the
   * feed from rows would swap every client id for a server one and remount the whole list.
   *
   * No-op while a turn streams: its own frames are the authority until it settles.
   */
  const syncServerMessages = useCallback((serverMessages: CourseCopilotServerMessage[]) => {
    if (abortRef.current) return;
    const rows = Array.isArray(serverMessages) ? serverMessages : [];
    const maxSeq = rows.reduce((max, row) => Math.max(max, row.seq ?? 0), 0);

    if (adoptServerSeqRef.current) {
      adoptServerSeqRef.current = false;
      serverSeqRef.current = Math.max(serverSeqRef.current, maxSeq);
      return;
    }
    const fresh = rows.filter(row => (row.seq ?? 0) > serverSeqRef.current);
    if (!fresh.length) return;
    serverSeqRef.current = maxSeq;
    const mapped = mapServerMessagesToFeed(fresh);
    if (!mapped.length) return;
    setMessages(prev => {
      const known = new Set(prev.map(message => message.id));
      return [...prev, ...mapped.filter(message => !known.has(message.id))];
    });
  }, []);

  /** Clears the feed. */
  const resetMessages = useCallback(() => {
    setMessages([]);
    serverSeqRef.current = 0;
    adoptServerSeqRef.current = false;
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    retryLast,
    stop,
    hydrateMessages,
    syncServerMessages,
    resetMessages,
  };
};
