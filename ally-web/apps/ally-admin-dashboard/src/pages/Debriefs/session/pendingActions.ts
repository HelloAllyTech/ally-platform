import { en } from "@constants";
import { DebriefSessionPending, DebriefSessionView } from "@types";

import { sectionLabel } from "../consoleLabels";
import { score } from "../consoleTable";
import { waitedFor } from "../queue";

/**
 * The "waiting on you" items come from ally-be (`pendingActions`, already filtered to the viewer's
 * role, in order). This file only puts them into the console's words.
 */
export const isFlagKind = (p: DebriefSessionPending) => !!p.flagId;

export const pendingHeadline = (p: DebriefSessionPending): string => {
  const s = en.debriefs.session.bar;
  const w = waitedFor(p.waitingSince);
  switch (p.kind) {
    case "urgent_flag":
      return s.urgent(w);
    case "flag":
      return s.flag(w);
    case "held":
      return p.overdue ? s.heldOverdue(w) : s.held(w);
    case "learner_distress":
      return s.distress(w);
    case "below_bar":
      return s.belowBar(w);
    default:
      return s.escalated(w);
  }
};

export const pendingBody = (p: DebriefSessionPending, view: DebriefSessionView): string => {
  const s = en.debriefs.session.bar;
  const flag = p.flagId ? view.flags.find(f => f.id === p.flagId) : undefined;
  const judge = view.judge.hidden ? "—" : score(view.judge.overall);
  if (p.kind === "escalated_flag" || p.kind === "escalated_run") {
    const by = view.escalation?.by.name;
    const note = view.escalation?.note;
    return note ? s.escalatedNote(by ?? s.theTeam, note) : s.escalatedAsk;
  }
  if (p.kind === "learner_distress") return p.anchors.askAlly ? s.distressAskAlly : s.distressBody;
  if (flag) {
    return s.flagBody(
      sectionLabel(flag.section),
      en.debriefs.review.reasons[flag.reason] ?? flag.reason,
    );
  }
  if (p.kind === "held") return s.heldBody(judge);
  if (p.kind === "below_bar") return s.belowBarBody(judge);
  return p.title;
};

/** Red = act now; yellow (orange in the bar) = act soon. */
export const isRed = (p: DebriefSessionPending) => p.level === "red";
