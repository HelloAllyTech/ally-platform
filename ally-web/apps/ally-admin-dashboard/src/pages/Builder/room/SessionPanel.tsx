import React from "react";

import { BackArrowIcon, CheckCircle, Refresh, User, WarningAlt } from "@icons";
import { Link } from "react-router-dom";

import { useGetBuilderThreadQuery } from "@api";
import { ROUTES, en } from "@constants";
import { BuilderDecision, BuilderNowSession, BuilderWaitingOn } from "@types";

import { sessionCode, timeOfDay } from "./roomFormat";

const strings = en.builder.room.session;

const STATUS_ICON: Record<BuilderWaitingOn, React.ReactNode> = {
  you: <User className="h-4 w-4" aria-hidden />,
  stuck: <WarningAlt className="h-4 w-4" aria-hidden />,
  builder: <Refresh className="h-4 w-4 motion-safe:animate-spin" aria-hidden />,
  review: <CheckCircle className="h-4 w-4" aria-hidden />,
};

/** Where on Interview → PRD → Design → Build → Review → Released the session is. */
const stepIndex = (session: BuilderNowSession): number => {
  switch (session.status) {
    case "INTERVIEWING":
      return 0;
    case "PRD_READY":
      return 1;
    case "BUILDING":
    case "WAITING_FOR_INPUT":
    case "FAILED":
      return 3;
    case "COMPLETED":
      return session.pullRequests.some(pr => !pr.merged && pr.state !== "closed") ? 4 : 5;
    default:
      return 0;
  }
};

/** An Ask sent and not yet answered: shown in the thread until the server's row lands. */
export interface PendingAsk {
  sessionId: string;
  question: string;
  at: string;
}

interface SessionPanelProps {
  session: BuilderNowSession;
  decisions: BuilderDecision[];
  pendingAsk: PendingAsk | null;
  showKeys: boolean;
  onBack: () => void;
  onAnswer: (decisionId: string) => void;
  onTellThis: (text: string) => void;
  onMakeRule: (historyId: string) => void;
  onPutBack: () => void;
}

/**
 * One session, in the column the decision usually holds: what it is doing,
 * what is waiting on you, and its thread of asks and tells. Esc (or Back on a
 * phone) returns to the decision you left.
 */
export const SessionPanel: React.FC<SessionPanelProps> = ({
  session,
  decisions,
  pendingAsk,
  showKeys,
  onBack,
  onAnswer,
  onTellThis,
  onMakeRule,
  onPutBack,
}) => {
  const { data: thread = [] } = useGetBuilderThreadQuery(session.id, { pollingInterval: 15_000 });
  const step = stepIndex(session);
  const code = sessionCode(session);
  const open = session.pullRequests.filter(pr => !pr.merged && pr.state !== "closed");

  return (
    <section aria-labelledby="session-panel-title" className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 py-1 text-sm text-typography-600 hover:text-typography-900"
      >
        <BackArrowIcon className="h-4 w-4" aria-hidden />
        {strings.back}
        {showKeys && <kbd className="ml-1 font-mono text-[11px]">Esc</kbd>}
      </button>

      <div>
        <p className="font-mono text-xs text-typography-500">{code}</p>
        <h2
          id="session-panel-title"
          className="mt-1 text-balance text-2xl font-normal leading-8 text-typography-900"
        >
          {session.title}
        </h2>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm">
          <span
            className={[
              "inline-flex items-center gap-1.5 font-medium",
              session.waitingOn === "stuck" ? "text-red-700" : "",
            ].join(" ")}
          >
            {STATUS_ICON[session.waitingOn]}
            {strings.waitingOn[session.waitingOn]}
          </span>
          <span className="text-typography-500">· {session.nowLine}</span>
        </p>
        <ol
          className="mt-3 flex gap-1 overflow-x-auto whitespace-nowrap text-xs"
          aria-label="Stage"
        >
          {strings.steps.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className={[
                "after:px-2 after:text-neutral-400 after:content-['›'] last:after:content-none",
                index < step
                  ? "text-typography-600"
                  : index === step
                    ? "font-semibold text-typography-900"
                    : "text-typography-400",
              ].join(" ")}
            >
              {index < step ? "✓ " : ""}
              {label}
            </li>
          ))}
        </ol>
      </div>

      {session.waitingOn === "stuck" && (
        <p className="border-l-[3px] border-red-600 bg-red-50 px-3 py-2 text-sm">
          {strings.stuckHelp}
        </p>
      )}

      {decisions.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-typography-600">
            {strings.pending}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {decisions.map(decision => (
              <li
                key={decision.id}
                className="flex items-center justify-between gap-3 border border-border-light bg-white px-3 py-2.5"
              >
                <span className="min-w-0 text-sm">{decision.prompt}</span>
                <button
                  type="button"
                  className="min-h-[36px] shrink-0 border border-typography-900 px-3 text-sm"
                  onClick={() => onAnswer(decision.id)}
                >
                  {strings.answer}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-typography-600">
          {strings.thread}
        </h3>
        {thread.length === 0 && !pendingAsk ? (
          <p className="text-sm text-typography-500">{strings.threadEmpty}</p>
        ) : (
          <ol className="flex flex-col gap-3" aria-live="polite">
            {thread.map(entry => (
              <li
                key={entry.id}
                className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[52px_1fr] sm:gap-3"
              >
                <span className="text-xs tabular-nums text-typography-500">
                  {timeOfDay(entry.decidedAt)}
                </span>
                <div className="min-w-0">
                  <p>
                    <span className="font-semibold">
                      {entry.entryType === "ask" ? strings.youAsked : strings.youTold}
                    </span>{" "}
                    {entry.prompt}
                    {entry.entryType === "tell" && entry.tellStatus && (
                      <span
                        className={[
                          "ml-2 whitespace-nowrap rounded-full border px-2 py-px text-[11px]",
                          entry.tellStatus === "applied"
                            ? "border-green-700 text-green-700"
                            : "border-neutral-500 text-typography-600",
                        ].join(" ")}
                      >
                        {strings.tellStatus[entry.tellStatus]}
                      </span>
                    )}
                  </p>
                  {entry.entryType === "ask" && entry.answerText && (
                    <p className="mt-1.5 whitespace-pre-wrap border border-border-light bg-white px-3 py-2">
                      {entry.answerText}
                    </p>
                  )}
                  {entry.entryType === "ask" && entry.chosenLabel && (
                    <p className="mt-2 flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="min-h-[32px] border border-typography-900 px-3 text-sm"
                        onClick={() => onTellThis(entry.chosenLabel ?? "")}
                      >
                        {strings.tellThis(code)}
                      </button>
                      <button
                        type="button"
                        className="text-sm underline underline-offset-2"
                        onClick={() => onMakeRule(entry.id)}
                      >
                        {strings.makeRule}
                      </button>
                    </p>
                  )}
                </div>
              </li>
            ))}
            {pendingAsk && pendingAsk.sessionId === session.id && (
              <li className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[52px_1fr] sm:gap-3">
                <span className="text-xs tabular-nums text-typography-500">
                  {timeOfDay(pendingAsk.at)}
                </span>
                <div>
                  <p>
                    <span className="font-semibold">{strings.youAsked}</span> {pendingAsk.question}
                  </p>
                  <p className="mt-1.5 border border-border-light bg-white px-3 py-2 text-typography-500">
                    {strings.answering}
                  </p>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-typography-600">
          {strings.open}
        </h3>
        <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link to={ROUTES.BUILDER_SESSION(session.id)} className="underline underline-offset-2">
            {strings.prd}
          </Link>
          {open.map(pr => (
            <a
              key={pr.id}
              href={pr.prUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {strings.pullRequest(pr.prNumber)}
            </a>
          ))}
          {session.putBackEligible && (
            <button type="button" className="underline underline-offset-2" onClick={onPutBack}>
              {strings.putBack}
            </button>
          )}
        </p>
      </div>
    </section>
  );
};
