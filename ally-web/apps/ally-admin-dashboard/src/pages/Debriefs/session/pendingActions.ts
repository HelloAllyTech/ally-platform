import {
  DebriefCardsData,
  DebriefPendingAction,
  DebriefReviewFlag,
  DebriefReviewRun,
  DebriefRunDetail,
} from "@types";

import { DebriefAccess } from "../debriefAccess";

/** What the "waiting on you" bar and the Review panel show for one decision. */
export interface PendingItem {
  kind: DebriefPendingAction["kind"];
  /** Red = act now, yellow (orange in the bar) = act soon. */
  level: "error" | "warning";
  id: string;
  since: string;
  flag: DebriefReviewFlag | null;
  review: DebriefReviewRun | null;
  /** Turns to read first. */
  turns: number[];
  /** The card to read first. */
  section: string | null;
}

/** ally-be's default flag-review deadline; Settings' `flagReviewSlaHours` overrides it. */
export const DEFAULT_REVIEW_HOURS = 24;

/** The turn a card section quotes, e.g. `work_on_this[0]` → its quote's turn. */
export const sectionTurn = (
  cards: DebriefCardsData | null | undefined,
  section: string | null | undefined,
): number | null => {
  if (!cards || !section) return null;
  if (section.startsWith("important_moment")) return cards.important_moment?.turn_index ?? null;
  const m = /^(what_worked|work_on_this)\[(\d+)\]/.exec(section);
  if (!m) return null;
  const list = cards[m[1] as "what_worked" | "work_on_this"] ?? [];
  return list[Number(m[2])]?.turn_index ?? null;
};

const turnsAround = (t: number | null): number[] =>
  t === null ? [] : [t - 1, t].filter(n => n >= 0);

/**
 * The decisions on this session that wait on the viewer's role (build notes item 21). ally-be's
 * own `pendingActions` win when it sends them; until then they are worked out from the review
 * queue. A role that can't act gets nothing: no bar, no count.
 */
export function pendingFor(
  access: DebriefAccess,
  run: DebriefRunDetail | undefined,
  flags: DebriefReviewFlag[],
  review: DebriefReviewRun | null,
  reviewHours: number = DEFAULT_REVIEW_HOURS,
  now: number = Date.now(),
): PendingItem[] {
  const cards = run?.cards;
  const momentTurn = cards?.important_moment?.turn_index ?? null;
  const out: PendingItem[] = [];
  const flagItem = (f: DebriefReviewFlag, kind: PendingItem["kind"]): PendingItem => {
    const t = sectionTurn(cards, f.section);
    return {
      kind,
      level: kind === "flag" ? "warning" : "error",
      id: f.id,
      since: f.createdAt,
      flag: f,
      review,
      turns: turnsAround(t),
      section: f.section,
    };
  };
  const runItem = (kind: PendingItem["kind"], level: PendingItem["level"]): PendingItem => ({
    kind,
    level,
    id: review?.id ?? run?.id ?? "",
    since: review?.escalation?.at ?? review?.createdAt ?? run?.createdAt ?? "",
    flag: null,
    review,
    turns: turnsAround(momentTurn),
    section: cards?.important_moment ? "important_moment" : null,
  });

  if (access.decideFlags) {
    for (const f of flags) out.push(flagItem(f, f.urgent ? "urgent_flag" : "flag"));
  } else if (access.advisor) {
    for (const f of flags.filter(x => x.status === "escalated")) out.push(flagItem(f, "escalated"));
  }
  if (review) {
    if (access.decideHeld) {
      if (review.status === "needs_person" || review.status === "below_bar") {
        const late = now - new Date(review.createdAt).getTime() > reviewHours * 3_600_000;
        out.push(runItem("held", late ? "error" : "warning"));
      } else if (review.learnerDistress) {
        out.push(runItem("distress", "error"));
      } else if (review.judgeBelowBar) {
        out.push(runItem("below_bar", "warning"));
      }
    } else if (access.advisor && review.escalation) {
      out.push(runItem("escalated", "error"));
    }
  }

  // ally-be's list, when it sends one, says which of these are the viewer's and where to look.
  const fromServer = run?.pendingActions;
  if (fromServer) {
    return fromServer
      .map(a => {
        const mine = out.find(o => o.id === a.id);
        const flag = flags.find(f => f.id === a.id) ?? null;
        return {
          kind: a.kind,
          level:
            a.kind === "flag" || a.kind === "below_bar" ? ("warning" as const) : ("error" as const),
          id: a.id,
          since: a.since,
          flag: mine?.flag ?? flag,
          review,
          turns: a.turns ?? mine?.turns ?? [],
          section: a.section ?? mine?.section ?? null,
        };
      })
      .filter(a => (a.flag ? true : a.kind !== "flag" && a.kind !== "urgent_flag"));
  }
  // Most urgent first: red before yellow, then oldest.
  return out.sort(
    (a, b) =>
      (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1) ||
      a.since.localeCompare(b.since),
  );
}
