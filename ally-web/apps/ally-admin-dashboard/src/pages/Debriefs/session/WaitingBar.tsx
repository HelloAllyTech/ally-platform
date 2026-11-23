import React from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { DebriefDecision, DebriefSessionView } from "@types";

import { isRed, pendingBody, pendingHeadline } from "./pendingActions";

/** What a decision button does; the page asks for a reason or a confirm where one is needed. */
export interface Decision {
  decision: DebriefDecision;
  flagId?: string;
  /** The card a correction without a flag is about. */
  section?: string | null;
}

export interface JumpTarget {
  turns?: number[];
  section?: string | null;
  pane?: boolean;
  askAlly?: boolean;
}

const turnsLabel = (turns: number[]) => {
  const s = en.debriefs.session.bar;
  if (turns.length === 0) return null;
  const lo = Math.min(...turns);
  const hi = Math.max(...turns);
  return lo === hi ? s.turn(lo) : s.turns(lo, hi);
};

/** The button words for each decision ally-be offers. */
export const decisionLabel = (d: DebriefDecision): string => {
  const r = en.debriefs.review;
  const b = en.debriefs.session.bar;
  switch (d) {
    case "keep":
      return r.keep;
    case "remove":
      return r.remove;
    case "correct":
      return r.correct;
    case "escalate":
      return b.escalate;
    case "publish":
      return r.publish;
    case "todays_debrief":
      return r.fallback;
    case "looks_fine":
      return r.looksFine;
    case "checked":
      return r.checkedOn;
    default:
      return b.giveVerdict;
  }
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
 * Each bar says what happened, links what to read first, and carries the decision buttons. The
 * items are ally-be's `pendingActions`, already only the viewer's role's.
 */
export const WaitingBar: React.FC<{
  view: DebriefSessionView;
  onJump: (t: JumpTarget) => void;
  onDecide: (d: Decision) => void;
}> = ({ view, onJump, onDecide }) => {
  const s = en.debriefs.session.bar;
  const items = view.pendingActions;
  if (items.length === 0) return null;
  return (
    <section aria-label={s.label} className="flex flex-col gap-2" data-testid="waiting-bar">
      {items.map((item, i) => {
        const red = isRed(item);
        const a = item.anchors;
        const links: React.ReactNode[] = [];
        const turns = turnsLabel(a.turns);
        if (turns) {
          links.push(
            <Jump key="t" onClick={() => onJump({ turns: a.turns })}>
              {turns}
            </Jump>,
          );
        }
        if (a.cardSection) {
          links.push(
            <Jump key="c" onClick={() => onJump({ section: a.cardSection })}>
              {item.flagId ? s.flaggedCard : s.theCard}
            </Jump>,
          );
        }
        if (a.learnerNote) {
          links.push(
            <Jump key="n" onClick={() => onJump({ pane: true })}>
              {s.theirNote}
            </Jump>,
          );
        }
        if (a.judgeReasons) {
          links.push(
            <Jump key="r" onClick={() => onJump({ pane: true })}>
              {s.judgeReasonsLink}
            </Jump>,
          );
        }
        if (a.askAlly) {
          links.push(
            <Jump key="a" onClick={() => onJump({ askAlly: true })}>
              {s.askAlly}
            </Jump>,
          );
        }
        // Escalating sits in the Review panel and on "e"; the bar carries the decisions.
        const decisions = item.decisions.filter(d => d !== "escalate");
        return (
          <div
            key={`${item.kind}-${item.flagId ?? i}`}
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
                <b>{pendingHeadline(item)}</b> {pendingBody(item, view)}
              </div>
              {links.length > 0 && (
                <div className="flex flex-wrap gap-x-1 text-[13px] text-neutral-700">
                  {s.readFirst}{" "}
                  {links.map((l, j) => (
                    <React.Fragment key={j}>
                      {j > 0 && " · "}
                      {l}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {decisions.map(d => (
                <Button
                  key={d}
                  kind={d === "correct" && item.kind !== "escalated_flag" ? "primary" : "tertiary"}
                  size="md"
                  onClick={() =>
                    onDecide({ decision: d, flagId: item.flagId, section: a.cardSection })
                  }
                >
                  {decisionLabel(d)}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
};
