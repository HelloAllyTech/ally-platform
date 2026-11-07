import {
  BuilderDecision,
  BuilderDecisionKind,
  BuilderDecisionOption,
  BuilderNowSession,
  BuilderWaitingOn,
} from "@types";

import { DECISION_KIND_PRIORITY } from "../decisionFeed";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A decision waiting longer than this is stale: it sinks to the end and leaves the wait total. */
export const STALE_AFTER_MS = 7 * DAY;
/** A wait longer than this is emphasised. The plan's starting value; Phase 0 tunes it. */
export const WAIT_EMPHASIS_MS = 30 * MIN;
/** How long a reversible answer can be taken back. Mirrors ally-be's BUILDER_UNDO_WINDOW_MS. */
export const UNDO_WINDOW_MS = 8_000;
/** Presses inside this long after arming a one-way option are ignored, so a double-tap can't fire it. */
export const ARMING_DELAY_MS = 600;
/** A same-session question raised this soon after you answered goes next, while the context is warm. */
export const FOLLOW_UP_WINDOW_MS = 60_000;

/** "12m", "1h 05m", "45d" — a wait, not a timestamp. */
export const formatWait = (ms: number): string => {
  if (ms < MIN) return "now";
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MIN);
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${Math.floor(ms / DAY)}d`;
};

export const waitedMs = (since: string | null | undefined, now: number): number =>
  since ? Math.max(0, now - new Date(since).getTime()) : 0;

export const isStale = (decision: Pick<BuilderDecision, "waitingSince">, now: number): boolean =>
  waitedMs(decision.waitingSince, now) > STALE_AFTER_MS;

export const isOneWay = (option: Pick<BuilderDecisionOption, "oneWay" | "confirm">): boolean =>
  Boolean(option.oneWay ?? option.confirm);

/** The session's short name: its roadmap code, or the start of its id. */
export const sessionCode = (session: { code?: string | null; id: string }): string =>
  session.code ?? `S-${session.id.slice(0, 4)}`;

/**
 * The server's order for a fresh feed: kind priority, then oldest first — with
 * stale waits sunk to the end, so a 45-day-old question doesn't lead a sitting.
 */
export const serverOrder = (decisions: BuilderDecision[], now: number): BuilderDecision[] =>
  [...decisions].sort((a, b) => {
    const staleA = isStale(a, now) ? 1 : 0;
    const staleB = isStale(b, now) ? 1 : 0;
    if (staleA !== staleB) return staleA - staleB;
    const byKind = DECISION_KIND_PRIORITY[a.kind] - DECISION_KIND_PRIORITY[b.kind];
    if (byKind) return byKind;
    return new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime();
  });

export interface QueueState {
  /** Decision ids in display order. */
  order: string[];
  /** Ids that arrived after the page first loaded and haven't been looked at. */
  fresh: string[];
}

/**
 * Fold a new server snapshot into the queue without moving anything the
 * person can see: ids still pending keep their place, gone ids drop out, and
 * new ids join at the end — except a follow-up from the session just answered,
 * which goes straight after the card in focus while the context is warm.
 */
export const reconcileQueue = (
  previous: QueueState | null,
  decisions: BuilderDecision[],
  options: {
    now: number;
    focusedId: string | null;
    /** Answered from this page: never added as arrivals (the server may list them a moment longer). */
    hidden?: Set<string>;
    /**
     * Keep these where they are even when the server has stopped listing them:
     * answers held in the undo window (the server hides those) and cards just
     * restored by an undo, until the next snapshot lists them again. Without
     * this an undone card would come back as a "new" arrival at the end.
     */
    keep?: Set<string>;
    lastAnswered?: { sessionId: string; at: number } | null;
  },
): QueueState => {
  const hidden = options.hidden ?? new Set<string>();
  const keep = options.keep ?? new Set<string>();
  const live = decisions.filter(decision => !hidden.has(decision.id));
  if (!previous) {
    return { order: serverOrder(live, options.now).map(decision => decision.id), fresh: [] };
  }
  const ids = new Set(decisions.map(decision => decision.id));
  const kept = previous.order.filter(id => ids.has(id) || keep.has(id));
  const known = new Set(previous.order);
  const arrivals = serverOrder(
    live.filter(decision => !known.has(decision.id)),
    options.now,
  );
  const followUps = arrivals.filter(
    decision =>
      options.lastAnswered &&
      decision.sessionId === options.lastAnswered.sessionId &&
      options.now - options.lastAnswered.at <= FOLLOW_UP_WINDOW_MS,
  );
  const rest = arrivals.filter(decision => !followUps.includes(decision));
  const order = [...kept];
  const at = options.focusedId ? order.indexOf(options.focusedId) : -1;
  order.splice(at >= 0 ? at + 1 : order.length, 0, ...followUps.map(decision => decision.id));
  order.push(...rest.map(decision => decision.id));
  return {
    order,
    fresh: [
      ...previous.fresh.filter(id => ids.has(id) && !hidden.has(id)),
      ...arrivals.map(decision => decision.id),
    ],
  };
};

export const GROUP_ORDER: BuilderWaitingOn[] = ["you", "stuck", "builder", "review"];

/** Sessions by group, in the page's fixed order; Needs you oldest wait first with stale ones last. */
export const groupSessions = (
  sessions: BuilderNowSession[],
  now: number,
): { group: BuilderWaitingOn; sessions: BuilderNowSession[] }[] =>
  GROUP_ORDER.map(group => {
    const members = sessions.filter(session => session.waitingOn === group);
    if (group === "you") {
      const key = (session: BuilderNowSession) => {
        const waited = waitedMs(session.waitingSince, now);
        return waited > STALE_AFTER_MS ? Number.MAX_SAFE_INTEGER : -waited;
      };
      members.sort((a, b) => key(a) - key(b));
    }
    return { group, sessions: members };
  }).filter(entry => entry.sessions.length > 0);

export interface WaitTotals {
  /** Decisions waiting on the person. */
  count: number;
  /** Summed oldest wait per session, stale waits left out. */
  waitingMs: number;
  stale: number;
  stuck: number;
  working: number;
  review: number;
}

/** The summary sentence's numbers. */
export const waitTotals = (
  sessions: BuilderNowSession[],
  decisions: BuilderDecision[],
  now: number,
): WaitTotals => {
  let waitingMs = 0;
  let stale = 0;
  for (const session of sessions) {
    if (session.waitingOn !== "you") continue;
    const waited = waitedMs(session.waitingSince, now);
    if (waited > STALE_AFTER_MS) stale += 1;
    else waitingMs += waited;
  }
  const count = (group: BuilderWaitingOn) =>
    sessions.filter(session => session.waitingOn === group).length;
  return {
    count: decisions.length,
    waitingMs,
    stale,
    stuck: count("stuck"),
    working: count("builder"),
    review: count("review"),
  };
};

/** What a Needs-you row says it needs: "Budget and 1 more". */
export const needsLabel = (
  kinds: BuilderDecisionKind[],
  kindLabels: Record<string, string>,
): string => {
  if (!kinds.length) return "";
  const first = kindLabels[kinds[0]] ?? kinds[0];
  return kinds.length > 1 ? `${first} and ${kinds.length - 1} more` : first;
};

/** "Today" / "Yesterday" / "Tuesday 27 Oct", for History's day headings. */
export const dayLabel = (
  iso: string,
  now: number,
  labels: { today: string; yesterday: string },
) => {
  const date = new Date(iso);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / DAY);
  if (diff <= 0) return labels.today;
  if (diff === 1) return labels.yesterday;
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
};

export const timeOfDay = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
