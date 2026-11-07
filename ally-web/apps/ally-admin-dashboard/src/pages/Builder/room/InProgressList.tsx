import React from "react";

import { CheckCircle, DoubleArrowRight, Refresh, Timer, User, WarningAlt } from "@icons";

import { en } from "@constants";
import { BuilderNowSession, BuilderUpNext, BuilderUpNextItem, BuilderWaitingOn } from "@types";

import {
  WAIT_EMPHASIS_MS,
  formatWait,
  groupSessions,
  needsLabel,
  sessionCode,
  waitedMs,
} from "./roomFormat";

const strings = en.builder.room;
const kindLabels = en.builder.decisions.kinds;

const GROUP_ICON: Record<BuilderWaitingOn, React.ReactNode> = {
  you: <User className="h-4 w-4" aria-hidden />,
  stuck: <WarningAlt className="h-4 w-4" aria-hidden />,
  builder: <Refresh className="h-4 w-4 motion-safe:animate-spin" aria-hidden />,
  review: <CheckCircle className="h-4 w-4" aria-hidden />,
};

interface InProgressListProps {
  sessions: BuilderNowSession[];
  now: number;
  /** The session whose card or panel is in front. */
  selectedId: string | null;
  /** Sessions with a decision that arrived since the page loaded. */
  freshSessions: Set<string>;
  upNext: BuilderUpNext | undefined;
  inProgress: number;
  limit: number;
  starting: boolean;
  onOpen: (sessionId: string) => void;
  onStart: (item: BuilderUpNextItem) => void;
  onPutBack: () => void;
  onSeeAll: () => void;
}

/**
 * Every session in progress, grouped by what it waits on — Needs you, Stuck,
 * Working, In review — and Up next at the foot. Quiet by default: only Stuck
 * is red, only a long wait is emphasised, and Working rows show progress, not
 * a clock. Status is always an icon and a word, never colour alone.
 */
export const InProgressList: React.FC<InProgressListProps> = ({
  sessions,
  now,
  selectedId,
  freshSessions,
  upNext,
  inProgress,
  limit,
  starting,
  onOpen,
  onStart,
  onPutBack,
  onSeeAll,
}) => {
  const groups = groupSessions(sessions, now);
  const top = upNext?.items[0];
  const full = inProgress >= limit;

  return (
    <nav aria-label={strings.groups.you} className="flex flex-col pb-4">
      {groups.map(({ group, sessions: members }) => (
        <section key={group} aria-label={strings.groups[group]}>
          <h3
            className={[
              "flex items-center gap-2 px-4 pb-1.5 pt-3.5 text-xs font-semibold tracking-wide",
              group === "stuck" ? "text-red-700" : "text-typography-600",
            ].join(" ")}
          >
            {GROUP_ICON[group]}
            <span>{strings.groups[group]}</span>
            <span className="font-normal text-typography-500">{members.length}</span>
          </h3>
          <ul>
            {members.map(session => {
              const waited = waitedMs(session.waitingSince, now);
              const hot = group === "you" && waited > WAIT_EMPHASIS_MS;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    data-row={session.id}
                    onClick={() => onOpen(session.id)}
                    aria-current={selectedId === session.id ? "true" : undefined}
                    className={[
                      "relative block w-full border-l-[3px] py-2 pl-10 pr-4 text-left hover:bg-neutral-100",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600",
                      selectedId === session.id
                        ? "border-typography-900 bg-neutral-100"
                        : "border-transparent",
                    ].join(" ")}
                  >
                    {freshSessions.has(session.id) && (
                      <span
                        className="absolute left-5 top-3.5 h-2 w-2 rounded-full bg-typography-900"
                        aria-label="New decision"
                      />
                    )}
                    <span className="block truncate text-sm">
                      <span className="mr-1.5 font-mono text-xs text-typography-600">
                        {sessionCode(session)}
                      </span>
                      {session.title}
                    </span>
                    <span
                      className={[
                        "mt-0.5 flex items-center gap-1.5 text-xs",
                        group === "stuck" ? "text-red-700" : "text-typography-500",
                      ].join(" ")}
                    >
                      <span className="min-w-0 truncate">
                        {group === "you"
                          ? needsLabel(session.pendingKinds, kindLabels)
                          : session.nowLine}
                      </span>
                      {group === "you" && (
                        <span
                          className={[
                            "ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums",
                            hot ? "font-semibold text-amber-700" : "",
                          ].join(" ")}
                        >
                          {hot && <Timer className="h-3 w-3" aria-hidden />}
                          {formatWait(waited)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section
        className="mx-4 mt-4 border-t border-border-light pt-3.5"
        aria-label={strings.groups.upNext}
      >
        <h3 className="flex items-center gap-2 pb-2 text-xs font-semibold tracking-wide text-typography-600">
          <DoubleArrowRight className="h-4 w-4" aria-hidden />
          <span>{strings.groups.upNext}</span>
          {upNext && (
            <span className="font-normal text-typography-500">
              {strings.upNext.prioritised(upNext.items.length)}
            </span>
          )}
        </h3>
        {top ? (
          <>
            <p className="text-sm font-medium">
              <span className="mr-1.5 font-mono text-xs text-typography-500">{top.code}</span>
              {top.title}
            </p>
            <p className="mt-0.5 text-xs text-typography-500">
              {strings.upNext.meta(
                top.voterCount,
                top.effort,
                strings.upNext.goals(top.goalsHelped, top.goalsAssessed),
              )}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              {full ? (
                <button
                  type="button"
                  className="min-h-[36px] border border-typography-900 px-3 text-sm hover:bg-neutral-100"
                  onClick={onPutBack}
                >
                  {strings.upNext.putOneBack(top.code)}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={starting}
                  className="min-h-[36px] border border-typography-900 px-4 text-sm hover:bg-neutral-100 disabled:opacity-50"
                  onClick={() => onStart(top)}
                >
                  {strings.upNext.start}
                </button>
              )}
              <span className="text-xs tabular-nums text-typography-500">
                {strings.upNext.limit(inProgress, limit)}
              </span>
              <button
                type="button"
                className="text-xs text-typography-600 underline underline-offset-2"
                onClick={onSeeAll}
              >
                {strings.upNext.seeAll}
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-typography-500">{strings.upNext.empty}</p>
        )}
      </section>
    </nav>
  );
};
