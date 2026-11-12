import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { ExpertComment, ExpertReviewDetail } from "@types";

import { checkLabel, hardFailLabel, sectionLabel } from "../consoleLabels";
import { score } from "../consoleTable";
import { canDecideFlag, DebriefAccess } from "../debriefAccess";
import { waitedFor } from "../queue";
import { ScoreByHand } from "../ScoreByHand";
import { FlagsPanel, Thread, VerdictPanel } from "./commentParts";
import { PendingItem } from "./pendingActions";
import { Decision } from "./WaitingBar";

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

/** The judge's reasons for holding or marking down a debrief, in words. */
const JudgeReasons: React.FC<{ item: PendingItem }> = ({ item }) => {
  const r = item.review;
  if (!r) return null;
  const lines = [
    ...r.checkFailures.map(f => `${checkLabel(f.code)} · ${sectionLabel(f.section)}: ${f.detail}`),
    ...r.evaluatorHardFails.map(h => `${hardFailLabel(h.code)}: ${h.evidence}`),
    ...(r.judgeHardFails ?? []).map(h => `${hardFailLabel(h.code)}: ${h.evidence}`),
  ];
  if (!lines.length) return null;
  return (
    <>
      <div className="text-xs text-neutral-600">{en.debriefs.session.panel.whyHeld}</div>
      <ul
        className="flex list-disc flex-col gap-1 pl-[18px] text-[13px] leading-normal text-typography-900"
        data-testid="judge-reasons"
      >
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
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
  access: DebriefAccess;
  canComment: boolean;
  items: PendingItem[];
  detail: ExpertReviewDetail | undefined;
  roots: ExpertComment[];
  repliesByRoot: Map<string, ExpertComment[]>;
  activeId: string | null;
  onFocusThread: (id: string) => void;
  onDecide: (d: Decision) => void;
  onClose: () => void;
  inSample: boolean;
  sessionId: string;
  onScored: () => void;
}> = props => {
  const { access, items, detail } = props;
  const s = en.debriefs.session.panel;
  const r = en.debriefs.review;
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
        {items.map(item => {
          const f = item.flag;
          const waited = waitedFor(item.since);
          if (f) {
            const escalated = item.kind === "escalated";
            return (
              <Card key={`f-${f.id}`} tone={escalated ? "plain" : item.level}>
                <div
                  className={`text-xs font-semibold ${item.level === "error" ? "text-destructive-600" : "text-[#8A3800]"}`}
                >
                  {escalated
                    ? s.escalatedTo(waited)
                    : f.urgent
                      ? s.urgentFlag(waited)
                      : s.flag(waited)}
                </div>
                <div className="text-[15px] font-semibold">
                  {s.flagTitle(sectionLabel(f.section), r.reasons[f.reason] ?? f.reason)}
                </div>
                {f.note && (
                  <div className="text-[13px] text-neutral-700">{s.theyAdded(f.note)}</div>
                )}
                {canDecideFlag(access, f.status === "escalated") && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {f.card && (
                        <Button
                          kind="primary"
                          size="md"
                          onClick={() => props.onDecide({ type: "correct", flagId: f.id })}
                        >
                          {r.correct}
                        </Button>
                      )}
                      <Button
                        kind="tertiary"
                        size="md"
                        onClick={() => props.onDecide({ type: "keep", flagId: f.id })}
                      >
                        {r.keep}
                      </Button>
                      <Button
                        kind="tertiary"
                        size="md"
                        onClick={() => props.onDecide({ type: "remove", flagId: f.id })}
                      >
                        {r.remove}
                      </Button>
                    </div>
                    <div className="text-xs text-neutral-600">{s.keepRemoveHelp}</div>
                  </>
                )}
                {access.escalate && f.status !== "escalated" && (
                  <button
                    type="button"
                    className="self-start text-sm text-primary-500 underline"
                    onClick={() => props.onDecide({ type: "escalate", kind: "flags", id: f.id })}
                  >
                    {s.escalate}
                  </button>
                )}
              </Card>
            );
          }
          return (
            <Card
              key={`r-${item.kind}-${item.id}`}
              tone={item.kind === "escalated" ? "plain" : item.level}
            >
              <div
                className={`text-xs font-semibold ${item.level === "error" ? "text-destructive-600" : "text-[#8A3800]"}`}
              >
                {item.kind === "held"
                  ? s.held(score(item.review?.judgeOverall), waited)
                  : item.kind === "distress"
                    ? s.distress(waited)
                    : item.kind === "below_bar"
                      ? s.belowBar(score(item.review?.judgeOverall), waited)
                      : s.escalatedTo(waited)}
              </div>
              {item.kind === "held" && (
                <div className="text-[13px] text-neutral-700">{s.heldHelp}</div>
              )}
              {item.kind === "distress" && (
                <div className="text-[13px] text-neutral-700">{r.distressHelp}</div>
              )}
              {item.kind === "escalated" && item.review?.escalation?.note && (
                <div className="text-[13px] text-neutral-700">{item.review.escalation.note}</div>
              )}
              <JudgeReasons item={item} />
              {item.kind === "held" && access.decideHeld && (
                <>
                  <Button
                    kind="tertiary"
                    size="md"
                    onClick={() => props.onDecide({ type: "publish", runId: item.id })}
                  >
                    {r.publish}
                  </Button>
                  <Button
                    kind="tertiary"
                    size="md"
                    onClick={() => props.onDecide({ type: "todays-debrief", runId: item.id })}
                  >
                    {r.fallback}
                  </Button>
                </>
              )}
              <div className="flex flex-wrap gap-4 text-sm">
                {(item.kind === "below_bar" || item.kind === "distress") && access.decideHeld && (
                  <button
                    type="button"
                    className="text-primary-500 underline"
                    onClick={() => props.onDecide({ type: "reviewed", runId: item.id })}
                  >
                    {item.kind === "distress" ? r.checkedOn : r.looksFine}
                  </button>
                )}
                {access.escalate && !item.review?.escalation && item.kind !== "escalated" && (
                  <button
                    type="button"
                    className="text-primary-500 underline"
                    onClick={() => props.onDecide({ type: "escalate", kind: "runs", id: item.id })}
                  >
                    {s.escalate}
                  </button>
                )}
              </div>
            </Card>
          );
        })}

        {access.verdict && detail && (
          <VerdictPanel key={detail.myReview?.updatedAt ?? "new"} detail={detail} />
        )}

        <Card tone="plain">
          <div className="text-[15px] font-semibold">
            {s.comments}{" "}
            <span className="text-[13px] font-normal text-neutral-600">· {props.roots.length}</span>
          </div>
          {props.roots.length > 0 ? (
            <ul className="flex flex-col gap-3" data-testid="session-threads">
              {props.roots.map(root => (
                <Thread
                  key={root.id}
                  root={root}
                  replies={props.repliesByRoot.get(root.id) ?? []}
                  runId={detail?.run.id ?? ""}
                  active={props.activeId === root.id}
                  onFocus={() => props.onFocusThread(root.id)}
                  canAct={props.canComment}
                />
              ))}
            </ul>
          ) : null}
          <div className="text-xs text-neutral-600">
            {props.canComment ? s.commentHint : s.commentsReadOnly}
          </div>
        </Card>

        {detail && detail.flags.length > 0 && <FlagsPanel detail={detail} />}

        {access.score && props.inSample && (
          <details
            className="rounded-sm bg-neutral-50 px-4 py-3.5 text-sm"
            data-testid="score-by-hand"
          >
            <summary className="cursor-pointer text-[15px] font-semibold">
              {s.scoreByHand}{" "}
              <span className="text-xs font-normal text-neutral-600">· {s.inSample}</span>
            </summary>
            <div className="mt-2.5">
              <ScoreByHand sessionId={props.sessionId} onSaved={props.onScored} />
            </div>
          </details>
        )}
      </div>
    </aside>
  );
};
