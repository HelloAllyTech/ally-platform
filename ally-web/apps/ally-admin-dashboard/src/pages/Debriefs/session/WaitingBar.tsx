import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { sectionLabel } from "../consoleLabels";
import { score } from "../consoleTable";
import { canDecideFlag, DebriefAccess } from "../debriefAccess";
import { waitedFor } from "../queue";
import { PendingItem } from "./pendingActions";

/** What a decision button does; the page asks for a reason or a confirm where one is needed. */
export type Decision =
  | { type: "correct"; flagId: string }
  | { type: "keep" | "remove"; flagId: string }
  | { type: "publish" | "todays-debrief" | "reviewed"; runId: string }
  | { type: "escalate"; kind: "flags" | "runs"; id: string }
  | { type: "verdict" };

export interface JumpTarget {
  turns?: number[];
  section?: string | null;
  pane?: boolean;
}

/** The judge's reasons for holding a debrief, counted for the "Read first" link. */
export const judgeReasonCount = (item: PendingItem) =>
  (item.review?.checkFailures.length ?? 0) +
  (item.review?.evaluatorHardFails.length ?? 0) +
  (item.review?.judgeHardFails?.length ?? 0);

const turnsLabel = (turns: number[]) => {
  const s = en.debriefs.session.bar;
  if (turns.length === 0) return null;
  const lo = Math.min(...turns);
  const hi = Math.max(...turns);
  return lo === hi ? s.turn(lo) : s.turns(lo, hi);
};

const Jump: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button type="button" className="text-primary-500 underline" onClick={onClick}>
    {children}
  </button>
);

/**
 * "Waiting on you" (build notes item 21): between the facts and the two columns, never over them.
 * Each bar says what happened, links what to read first, and carries the decision buttons.
 */
export const WaitingBar: React.FC<{
  items: PendingItem[];
  access: DebriefAccess;
  onJump: (t: JumpTarget) => void;
  onDecide: (d: Decision) => void;
}> = ({ items, access, onJump, onDecide }) => {
  const s = en.debriefs.session.bar;
  if (items.length === 0) return null;
  return (
    <section aria-label={s.label} className="flex flex-col gap-2" data-testid="waiting-bar">
      {items.map(item => {
        const f = item.flag;
        const red = item.level === "error";
        const waited = waitedFor(item.since);
        const reasons = judgeReasonCount(item);
        const links: React.ReactNode[] = [];
        const turns = turnsLabel(item.turns);
        if (turns)
          links.push(
            <Jump key="t" onClick={() => onJump({ turns: item.turns })}>
              {turns}
            </Jump>,
          );
        if (f && item.section) {
          links.push(
            <Jump key="c" onClick={() => onJump({ section: item.section })}>
              {s.flaggedCard}
            </Jump>,
          );
        }
        if (f?.note)
          links.push(
            <Jump key="n" onClick={() => onJump({ pane: true })}>
              {s.theirNote}
            </Jump>,
          );
        if (!f && reasons > 0) {
          links.push(
            <Jump key="r" onClick={() => onJump({ pane: true })}>
              {s.judgeReasons(reasons)}
            </Jump>,
          );
        }
        if (!f) {
          links.push(
            <Jump key="d" onClick={() => onJump({ section: item.section ?? "opening" })}>
              {s.theDebrief}
            </Jump>,
          );
        }
        const judge = score(item.review?.judgeOverall);
        const headline =
          item.kind === "urgent_flag"
            ? s.urgent(waited)
            : item.kind === "flag"
              ? s.flag(waited)
              : item.kind === "held"
                ? s.held(waited)
                : item.kind === "distress"
                  ? s.distress(waited)
                  : item.kind === "below_bar"
                    ? s.belowBar(waited)
                    : s.escalated(waited);
        const body = f
          ? item.kind === "escalated"
            ? (item.review?.escalation?.note ?? s.escalatedAsk)
            : s.flagBody(sectionLabel(f.section), en.debriefs.review.reasons[f.reason] ?? f.reason)
          : item.kind === "held"
            ? s.heldBody(judge)
            : item.kind === "distress"
              ? s.distressBody
              : item.kind === "below_bar"
                ? s.belowBarBody(judge)
                : (item.review?.escalation?.note ?? s.escalatedAsk);
        const flagButtons = f && canDecideFlag(access, f.status === "escalated");
        return (
          <div
            key={`${item.kind}-${item.id}`}
            role={red ? "alert" : "status"}
            data-testid="waiting-item"
            data-kind={item.kind}
            className={[
              "flex flex-wrap items-center gap-x-4 gap-y-2.5 border-l-[3px] px-4 py-3",
              red ? "border-destructive-500 bg-destructive-50" : "border-[#FF832B] bg-[#FFF2E8]",
            ].join(" ")}
          >
            <div className="flex min-w-[min(420px,100%)] flex-1 flex-col gap-1">
              <div className="text-sm">
                <b>{headline}</b> {body}
              </div>
              {links.length > 0 && (
                <div className="flex flex-wrap gap-x-1 text-[13px] text-neutral-700">
                  {s.readFirst}{" "}
                  {links.map((l, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && " · "}
                      {l}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {flagButtons && f && (
                <>
                  {f.card && (
                    <Button
                      kind={item.kind === "escalated" ? "tertiary" : "primary"}
                      size="md"
                      onClick={() => onDecide({ type: "correct", flagId: f.id })}
                    >
                      {en.debriefs.review.correct}
                    </Button>
                  )}
                  <Button
                    kind="tertiary"
                    size="md"
                    onClick={() => onDecide({ type: "keep", flagId: f.id })}
                  >
                    {en.debriefs.review.keep}
                  </Button>
                  <Button
                    kind="tertiary"
                    size="md"
                    onClick={() => onDecide({ type: "remove", flagId: f.id })}
                  >
                    {en.debriefs.review.remove}
                  </Button>
                </>
              )}
              {!f && item.kind === "held" && access.decideHeld && (
                <>
                  <Button
                    kind="tertiary"
                    size="md"
                    onClick={() => onDecide({ type: "publish", runId: item.id })}
                  >
                    {en.debriefs.review.publish}
                  </Button>
                  <Button
                    kind="tertiary"
                    size="md"
                    onClick={() => onDecide({ type: "todays-debrief", runId: item.id })}
                  >
                    {en.debriefs.review.fallback}
                  </Button>
                </>
              )}
              {!f &&
                (item.kind === "distress" || item.kind === "below_bar") &&
                access.decideHeld && (
                  <Button
                    kind="tertiary"
                    size="md"
                    onClick={() => onDecide({ type: "reviewed", runId: item.id })}
                  >
                    {item.kind === "distress"
                      ? en.debriefs.review.checkedOn
                      : en.debriefs.review.looksFine}
                  </Button>
                )}
              {!f && item.kind === "escalated" && access.verdict && (
                <Button kind="tertiary" size="md" onClick={() => onDecide({ type: "verdict" })}>
                  {s.giveVerdict}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
};
