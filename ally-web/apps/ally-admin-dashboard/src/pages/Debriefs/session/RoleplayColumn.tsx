import React from "react";

import { EmptyPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { ExpertComment, ExpertCommentDraftAnchor, ExpertReviewDetail } from "@types";

import { codeWords } from "../consoleLabels";
import { turnAnchor } from "../expertReviewSelection";
import { SessionLogLink } from "../SessionLogLink";
import { Line } from "./commentParts";
import { CommentPopup } from "./CommentPopup";

export const turnDomId = (n: number) => `session-turn-${n}`;

/**
 * The roleplay, turn by turn: risk cues tagged, comments highlighted and named under their turn,
 * and, for people with review rights, the select-to-comment pop-up under the selected words.
 */
export const RoleplayColumn: React.FC<{
  runId: string;
  sessionId: string;
  detail: ExpertReviewDetail | undefined;
  failed: boolean;
  loading: boolean;
  roots: ExpertComment[];
  activeId: string | null;
  onFocusThread: (id: string) => void;
  highlightTurns: number[];
  pending: ExpertCommentDraftAnchor | null;
  onPendingDone: () => void;
  onSelect?: () => void;
  canComment: boolean;
}> = ({
  runId,
  sessionId,
  detail,
  failed,
  loading,
  roots,
  activeId,
  onFocusThread,
  highlightTurns,
  pending,
  onPendingDone,
  onSelect,
  canComment,
}) => {
  const s = en.debriefs.session;
  const turns = detail?.transcript ?? [];
  return (
    <section
      aria-label={s.roleplay}
      className="flex min-w-0 flex-[1_1_380px] flex-col rounded-sm bg-neutral-50 lg:h-[78vh]"
      data-testid="session-roleplay"
    >
      <div className="flex items-center gap-2.5 border-b border-neutral-100 px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{s.roleplay}</h2>
        {turns.length > 0 && (
          <span className="text-[13px] text-neutral-600">{s.turns(turns.length)}</span>
        )}
        <span className="ml-auto text-xs text-neutral-600">
          {canComment ? s.selectHint : <SessionLogLink sessionId={sessionId} />}
        </span>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4"
        onMouseUp={canComment ? onSelect : undefined}
      >
        {loading ? (
          <LoadingBlock lines={8} />
        ) : failed || !detail ? (
          <EmptyPanel title={s.noTranscript} message={s.noTranscriptHelp} />
        ) : (
          turns.map(turn => {
            const learner = turn.speaker === "learner";
            const mine = roots.filter(
              c => c.anchorKind === "transcript" && c.turnIndex === turn.turnIndex,
            );
            const lit = highlightTurns.includes(turn.turnIndex);
            return (
              <div
                key={turn.turnIndex}
                id={turnDomId(turn.turnIndex)}
                data-testid="session-turn"
                data-highlight={lit ? "true" : undefined}
                className={`flex flex-col gap-1 ${learner ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  <span className="font-semibold text-neutral-700">
                    {learner ? s.learner : s.client}
                  </span>
                  <span>{s.turn(turn.turnIndex)}</span>
                  {turn.riskCue && (
                    <span className="rounded-full bg-destructive-100 px-2 py-0.5 font-semibold text-destructive-600">
                      {s.riskCue(codeWords(turn.riskCue.category))}
                    </span>
                  )}
                </div>
                <div
                  className={[
                    "max-w-[88%] rounded-sm px-3.5 py-2.5 text-sm leading-normal",
                    learner ? "bg-primary-50" : "bg-white",
                    lit ? "outline outline-2 outline-warning-200" : "",
                  ].join(" ")}
                >
                  <Line
                    anchorKey={turnAnchor(turn.turnIndex)}
                    text={turn.text}
                    comments={mine}
                    activeId={activeId}
                    onFocusThread={onFocusThread}
                    className="whitespace-pre-wrap"
                  />
                </div>
                {mine.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onFocusThread(c.id)}
                    data-testid="comment-marker"
                    className="flex max-w-[88%] items-center gap-1.5 text-xs text-primary-700"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      aria-hidden="true"
                    >
                      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
                    </svg>
                    {c.reviewer.name ?? en.debriefs.expertReview.threads.someone}
                    {c.tag ? ` · ${en.debriefs.expertReview.tags[c.tag]}` : ""}
                  </button>
                ))}
                {canComment &&
                  pending?.anchorKind === "transcript" &&
                  pending.turnIndex === turn.turnIndex && (
                    <CommentPopup runId={runId} anchor={pending} onDone={onPendingDone} />
                  )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
