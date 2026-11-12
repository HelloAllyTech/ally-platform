import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { DebriefSessionView, ExpertComment, ExpertReviewDetail } from "@types";

import { sectionLabel } from "../consoleLabels";
import { DebriefAccess } from "../debriefAccess";
import { HARD_FAILS, ScoreByHand } from "../ScoreByHand";
import { EarlierComments, Thread, VerdictPanel } from "./commentParts";
import { isRed, pendingBody, pendingHeadline } from "./pendingActions";
import { Decision, decisionLabel } from "./WaitingBar";

/** The verdict panel reads expert review's shape; the session view carries the same facts. */
export const verdictDetail = (view: DebriefSessionView): ExpertReviewDetail =>
  ({
    run: { id: view.run.id },
    myReview: view.verdict
      ? {
          verdict: view.verdict.verdict,
          hardFails: view.verdict.hardFails,
          updatedAt: view.verdict.updatedAt ?? "",
        }
      : null,
    otherReviews: { count: 0, verdicts: null },
    judge: view.judge.hidden
      ? null
      : {
          overall: view.judge.overall ?? null,
          hardFails: (view.judge.hardFails ?? []).map(h => h.code),
        },
    evaluator: view.judge.hidden
      ? null
      : {
          overall: view.judge.evaluatorOverall ?? null,
          hardFails: (view.judge.evaluatorHardFails ?? []).map(h => h.code),
        },
    hardFailCodes: HARD_FAILS,
  }) as unknown as ExpertReviewDetail;

const Card: React.FC<{ tone: "error" | "warning" | "plain"; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <div
    data-testid="review-card"
    className={[
      "flex flex-col gap-2.5 rounded-sm px-4 py-3.5",
      tone === "error"
        ? "border-l-[3px] border-destructive-500 bg-destructive-50"
        : tone === "warning"
          ? "border-l-[3px] border-[#FF832B] bg-[#FFF2E8]"
          : "bg-neutral-50",
    ].join(" ")}
  >
    {children}
  </div>
);

/** "Why the judge held it": the judge's, the Evaluator's and the checks' reasons, in words. */
const JudgeReasons: React.FC<{ view: DebriefSessionView }> = ({ view }) => {
  const reasons = view.judge.hidden ? [] : (view.judge.reasons ?? []);
  if (reasons.length === 0) return null;
  return (
    <>
      <div className="text-xs text-neutral-600">{en.debriefs.session.panel.whyHeld}</div>
      <ul
        className="flex list-disc flex-col gap-1 pl-[18px] text-[13px] leading-normal text-typography-900"
        data-testid="judge-reasons"
      >
        {reasons.map((r, i) => (
          <li key={i}>{r.text}</li>
        ))}
      </ul>
    </>
  );
};

/**
 * The Review button's drop-down panel (closed by default): the decisions waiting on the viewer's
 * role, then the comments, then the advisor's verdict and scoring. Folds in what the Review tab,
 * Expert review and the calibration drawer did before the redesign.
 */
export const ReviewPanel: React.FC<{
  view: DebriefSessionView;
  access: DebriefAccess;
  roots: ExpertComment[];
  repliesByRoot: Map<string, ExpertComment[]>;
  activeId: string | null;
  onFocusThread: (id: string) => void;
  onDecide: (d: Decision) => void;
  onClose: () => void;
  onScored: () => void;
}> = props => {
  const { view, access } = props;
  const s = en.debriefs.session.panel;
  const items = view.pendingActions;
  const decidedFlags = view.flags.filter(f => f.status !== "open" && f.status !== "escalated");
  return (
    <aside
      aria-label={s.label}
      data-testid="review-panel"
      className="absolute right-0 top-full z-10 mt-2 flex max-h-[760px] w-[min(400px,calc(100vw-32px))] flex-col overflow-y-auto rounded-lg border border-neutral-100 bg-white shadow-[0_10px_15px_-3px_rgba(0,0,0,.1),0_4px_6px_-4px_rgba(0,0,0,.1)]"
    >
      <div className="flex items-center border-b border-neutral-100 px-4 py-3">
        <h2 className="text-[15px] font-semibold">{s.label}</h2>
        <button
          type="button"
          aria-label={s.close}
          onClick={props.onClose}
          className="ml-auto flex h-8 w-8 items-center justify-center"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="#393939"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {items.length === 0 && <p className="text-sm text-neutral-600">{s.nothing}</p>}
        {items.map((item, i) => {
          const flag = item.flagId ? view.flags.find(f => f.id === item.flagId) : undefined;
          const escalated = item.kind === "escalated_flag" || item.kind === "escalated_run";
          const main = item.decisions.filter(d => d !== "escalate");
          return (
            <Card
              key={`${item.kind}-${item.flagId ?? i}`}
              tone={escalated ? "plain" : isRed(item) ? "error" : "warning"}
            >
              <div
                className={`text-xs font-semibold ${isRed(item) ? "text-destructive-600" : "text-[#8A3800]"}`}
              >
                {pendingHeadline(item)}
              </div>
              <div className="text-[15px] font-semibold">{pendingBody(item, view)}</div>
              {flag?.note && (
                <div className="text-[13px] text-neutral-700">{s.theyAdded(flag.note)}</div>
              )}
              {(item.kind === "held" || item.kind === "below_bar") && (
                <>
                  {item.kind === "held" && (
                    <div className="text-[13px] text-neutral-700">{s.heldHelp}</div>
                  )}
                  <JudgeReasons view={view} />
                </>
              )}
              {main.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {main.map(d => (
                    <Button
                      key={d}
                      kind={d === "correct" ? "primary" : "tertiary"}
                      size="md"
                      onClick={() =>
                        props.onDecide({
                          decision: d,
                          flagId: item.flagId,
                          section: item.anchors.cardSection,
                        })
                      }
                    >
                      {decisionLabel(d)}
                    </Button>
                  ))}
                </div>
              )}
              {item.flagId && main.includes("keep") && (
                <div className="text-xs text-neutral-600">{s.keepRemoveHelp}</div>
              )}
              {item.decisions.includes("escalate") && (
                <button
                  type="button"
                  className="self-start text-sm text-primary-500 underline"
                  onClick={() => props.onDecide({ decision: "escalate", flagId: item.flagId })}
                >
                  {s.escalate}
                </button>
              )}
            </Card>
          );
        })}

        {access.verdict && (
          <VerdictPanel key={view.verdict?.updatedAt ?? "new"} detail={verdictDetail(view)} />
        )}

        <Card tone="plain">
          <div className="text-[15px] font-semibold">
            {s.comments}{" "}
            <span className="text-[13px] font-normal text-neutral-600">· {props.roots.length}</span>
          </div>
          {props.roots.length > 0 && (
            <ul className="flex flex-col gap-3" data-testid="session-threads">
              {props.roots.map(root => (
                <Thread
                  key={root.id}
                  root={root}
                  replies={props.repliesByRoot.get(root.id) ?? []}
                  runId={view.run.id}
                  active={props.activeId === root.id}
                  onFocus={() => props.onFocusThread(root.id)}
                  canAct={view.can.comment}
                />
              ))}
            </ul>
          )}
          <div className="text-xs text-neutral-600">
            {view.can.comment ? s.commentHint : s.commentsReadOnly}
          </div>
          <EarlierComments
            comments={view.earlierComments ?? []}
            runId={view.run.id}
            canAct={view.can.comment}
          />
        </Card>

        {decidedFlags.length > 0 && (
          <Card tone="plain">
            <div className="text-[15px] font-semibold">{s.decidedFlags}</div>
            <ul className="flex flex-col gap-2 text-sm" data-testid="decided-flags">
              {decidedFlags.map(f => (
                <li key={f.id}>
                  <span className="font-medium">
                    {en.debriefs.review.reasons[f.reason] ?? f.reason}
                  </span>{" "}
                  · {sectionLabel(f.section)}
                  {f.resolutionNote ? ` — ${f.resolutionNote}` : ""}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {view.can.score && view.scoring.inMyScoringSample && (
          <details
            className="rounded-sm bg-neutral-50 px-4 py-3.5 text-sm"
            data-testid="score-by-hand"
          >
            <summary className="cursor-pointer text-[15px] font-semibold">
              {s.scoreByHand}{" "}
              <span className="text-xs font-normal text-neutral-600">· {s.inSample}</span>
            </summary>
            <div className="mt-2.5">
              <ScoreByHand sessionId={view.run.sessionId} onSaved={props.onScored} />
            </div>
          </details>
        )}
      </div>
    </aside>
  );
};
