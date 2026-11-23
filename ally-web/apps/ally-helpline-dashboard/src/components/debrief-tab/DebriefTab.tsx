import { FC, useEffect, useRef } from "react";

import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";

import { useGetChatHistoryQuery, useGetSupervisorDebriefQuery } from "@api";
import { Refresh } from "@assets";
import { useSendMessage } from "@hooks";
import { initSession } from "@reducer";
import { RootState } from "@store";
import { ChatMessagePayload, SimulationSummary as SimulationSummaryType } from "@types";

// The endpoint map alone: the `@constants` barrel loads icons at import time.
import { DebriefCards } from "./DebriefCards";
import { DebriefReplyInput } from "./DebriefReplyInput";
import { ReplyBubble } from "./ReplyBubble";
import { SupervisorNote } from "./SupervisorNote";
import { useLearnerDebrief } from "./useLearnerDebrief";
import { ApiEndpoints } from "../../constants/api";

interface DebriefTabProps {
  sessionId: string;
  summaryData?: SimulationSummaryType;
  onOpenMoment?: (messageId: string) => void;
  /** "See this moment" on a card's quote: open the transcript at that turn. */
  onSeeQuote?: (quote: string) => void;
  /**
   * Read-only: the Roleplay Logs surfaces, where the debrief is read back — by
   * the learner revisiting a past session, or by an admin reviewing someone
   * else's. An admin must not be able to type into the learner's own
   * conversation with Ally, and the thread is keyed by session id, so there is
   * no per-reader thread to put them in.
   *
   * The thread is not merely disabled: it is not rendered and not fetched, so
   * an org admin opening a learner's session never pulls the learner's
   * coaching conversation into their store.
   */
  readOnly?: boolean;
  /** Who the learner is, for labelling their own lines in a citation. */
  counsellorName?: string;
  /** The simulated client's name, for labelling its lines in a citation. */
  agentName?: string;
}

/**
 * The landing surface after a practice session: the learner's Debrief. Sessions
 * written before the Debrief agent may still hold an older supervisor note;
 * that is shown read-only, with no rating and no replies. A session with
 * neither shows one calm static line.
 */
/**
 * Ask Ally's composer and the supervisor line. Rendered inside DebriefCards, so its
 * useTranslation reads the debrief's own language (PRD §9), not the app's.
 */
const AskAllyComposer: FC<{ onSend: (text: string) => void; disabled: boolean }> = ({
  onSend,
  disabled,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <DebriefReplyInput
        onSend={onSend}
        disabled={disabled}
        placeholder={t("postSim.debriefCards.reply.placeholder")}
      />
      {/* v9 Q47: supervisors read this thread, and the learner is told. */}
      <p className="font-primary text-xs text-typography-700">
        {t("postSim.debriefCards.supervisor.canRead")}
      </p>
    </>
  );
};

export const DebriefTab: FC<DebriefTabProps> = ({
  sessionId,
  summaryData,
  onOpenMoment,
  onSeeQuote,
  readOnly = false,
  counsellorName,
  agentName,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const threadEndRef = useRef<HTMLDivElement>(null);

  const sessionExists = useSelector((state: RootState) => state.chatHistory.sessions[sessionId]);
  // The learner's Debrief. `null` — not available, refused, or gave up
  // polling — falls through to the read-only old note (or the static line); a
  // request that failed outright shows "didn't load" with Try again.
  const {
    view: learnerDebrief,
    retry: retryDebrief,
    retrying: retryingDebrief,
  } = useLearnerDebrief(sessionId);
  // Roleplay Logs (read-only): a supervisor reads the learner's new debrief,
  // their flags and their Ask Ally thread (v9 FR-26). Anything else — an older
  // session, a refusal — shows the old note read-only, if there is one.
  const { data: supervisorView } = useGetSupervisorDebriefQuery(sessionId, { skip: !readOnly });
  const askAlly = learnerDebrief?.state === "ready" && !readOnly;
  const {
    messages,
    streamingMessage,
    isStreaming,
    error,
    replyLimit,
    sendMessage,
    retryLastMessage,
  } = useSendMessage(
    sessionId,
    askAlly ? ApiEndpoints.DEBRIEFS.REPLY_STREAM(sessionId) : undefined,
  );
  // Ask Ally's limit (this reply's `done.limit`, or the server's `askAlly`
  // after a reload): the limit message stays in the thread, the box goes.
  const askAllyClosed = Boolean(replyLimit) || learnerDebrief?.askAlly?.open === false;
  const { data: history } = useGetChatHistoryQuery(
    { sessionId },
    // Only Ask Ally has a thread on screen. Otherwise there is no reason to
    // fetch one — and an admin reading a log must not pull the learner's
    // conversation into their store.
    { skip: !askAlly },
  );

  useEffect(() => {
    if (sessionExists) return;
    if (history?.length) {
      const initial: ChatMessagePayload[] = history.map(message => ({
        role: message.role,
        content: message.content,
        citations: message.citations,
      }));
      dispatch(initSession({ sessionId, messages: initial }));
    }
  }, [history, sessionId, sessionExists, dispatch]);

  useEffect(() => {
    // Only chase the bottom once there is a conversation to follow. Scrolling
    // on first paint would skip past the note, which is the thing they came to
    // read — and in note-only mode the note is all there is.
    if (!readOnly && (messages.length || streamingMessage)) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingMessage, readOnly]);

  // Ask Ally: the same thread, answered by the Debrief agent, under the
  // reflective question. Never on a read-only (Logs) view.
  const thread = (
    <>
      {messages.map((message, index) => (
        <ReplyBubble
          key={`${message.role}-${index}`}
          role={message.role}
          content={message.content}
          citations={message.citations}
          onOpenMoment={onOpenMoment}
          counsellorName={counsellorName}
          agentName={agentName}
        />
      ))}
      {streamingMessage && (
        <ReplyBubble
          role={streamingMessage.role}
          content={streamingMessage.content}
          citations={streamingMessage.citations}
          onOpenMoment={onOpenMoment}
          counsellorName={counsellorName}
          agentName={agentName}
        />
      )}
      {/* No red anywhere in learner feedback (PRD §6.3): the same calm
          outline as "Check again". */}
      {error && (
        <div className="flex w-full justify-start">
          <button
            onClick={retryLastMessage}
            className="flex min-h-[44px] items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-2.5 font-primary text-sm text-primary-600 transition-colors hover:bg-primary-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
          >
            <Refresh className="h-4 w-4" />
            {t("common.somethingWentWrong")} {t("common.retry")}
          </button>
        </div>
      )}
      <div ref={threadEndRef} />
    </>
  );

  // The learner's own session in Roleplay Logs reads as their debrief (with
  // its "Practise this next" button), even when they can also read others'
  // as a supervisor: the learner view answers only the session's own learner.
  const ownReady = learnerDebrief?.state === "ready";
  if (readOnly && !ownReady && supervisorView?.state === "ready" && supervisorView.cards) {
    const supervisorThread = supervisorView.thread ?? [];
    return (
      <DebriefCards
        view={{
          state: "ready",
          cards: supervisorView.cards,
          language: supervisorView.language,
          corrections: supervisorView.corrections,
        }}
        sessionId={sessionId}
        supervisor={supervisorView}
        replyThread={
          <div data-testid="supervisor-thread" className="flex flex-col gap-3">
            <p className="font-primary text-sm font-semibold text-typography-900">
              {t("postSim.debriefCards.supervisor.thread")}
            </p>
            {supervisorThread.length === 0 ? (
              <p className="font-primary text-sm text-typography-700">
                {t("postSim.debriefCards.supervisor.noThread")}
              </p>
            ) : (
              supervisorThread.map((m, index) => (
                <ReplyBubble
                  key={`${m.role}-${index}`}
                  role={m.role === "learner" ? "user" : "assistant"}
                  content={m.content}
                  counsellorName={counsellorName}
                  agentName={agentName}
                />
              ))
            )}
          </div>
        }
      />
    );
  }

  if (learnerDebrief) {
    return (
      <DebriefCards
        view={learnerDebrief}
        sessionId={sessionId}
        onSeeQuote={onSeeQuote}
        onRetry={retryDebrief}
        retrying={retryingDebrief}
        replyThread={
          askAlly ? (
            <div data-testid="ask-ally" className="flex flex-col gap-3">
              {thread}
              {!askAllyClosed && <AskAllyComposer onSend={sendMessage} disabled={isStreaming} />}
            </div>
          ) : undefined
        }
      />
    );
  }

  // The new debrief is not available (not switched on for this session, gave
  // up, or failed to load). Sessions written before it may hold an older
  // supervisor note: show it as it was written, read-only — no rating, no
  // replies. Nothing is generated or polled for it any more.
  const note = summaryData?.details?.summary?.feedback?.supervisorNote;

  return (
    <div className="flex w-full flex-col rounded-lg bg-gradient-to-br from-primary-500 to-primary-100 p-1">
      <div className="flex w-full flex-col rounded-lg">
        <div className="w-full shrink-0 px-4 py-3 font-primary text-lg font-semibold text-white">
          {t("postSim.debrief.header")}
        </div>
        <div className="flex flex-col gap-5 rounded-t-lg rounded-b-md bg-white p-4 sm:p-6">
          {note ? (
            <SupervisorNote note={note} onOpenMoment={onOpenMoment} hideClosing />
          ) : (
            <p
              data-testid="debrief-none-for-session"
              className="font-primary text-base text-typography-800"
            >
              {t("postSim.debrief.noneForSession")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
