/**
 * What a person last saw on For you, so the summary can say what changed since.
 * Two snapshots are kept: `previous` (the last visit before this one) and
 * `current` (the numbers when this visit began). A visit within {@link SEEN_ROLL_MS}
 * of `current` keeps both, so reopening the page the same day shows the same
 * comparison instead of "nothing new".
 */
export interface SeenSnapshot {
  /** When the snapshot was taken (ISO). */
  at: string;
  /** The findings that needed a look, by finding key (no week). */
  findings: string[];
  /** Learners active and sessions completed over the last 30 days. */
  active: number;
  sessions: number;
}

export interface Seen {
  previous?: SeenSnapshot;
  current: SeenSnapshot;
}

/** A visit this long after the last snapshot starts a new comparison. */
export const SEEN_ROLL_MS = 12 * 60 * 60 * 1000;
/** The most findings kept (the backend accepts 40). */
const MAX_FINDINGS = 40;

/**
 * A finding's fingerprint ends in the ISO week (`learners.dormant:2026-W48`), so
 * the same problem next week has a different fingerprint. Without the week it is
 * still the same finding, and not "new".
 */
export const findingKey = (fingerprint: string): string =>
  fingerprint.replace(/:\d{4}-W\d{2}$/, "");

const isSnapshot = (value: unknown): value is SeenSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.at === "string" &&
    !Number.isNaN(Date.parse(v.at)) &&
    Array.isArray(v.findings) &&
    v.findings.every(key => typeof key === "string") &&
    Number.isInteger(v.active) &&
    Number.isInteger(v.sessions)
  );
};

/** What is saved, or nothing when it is absent or damaged. */
export const readSeen = (saved: unknown): Seen | null => {
  if (typeof saved !== "object" || saved === null) return null;
  const { previous, current } = saved as Record<string, unknown>;
  if (!isSnapshot(current)) return null;
  return isSnapshot(previous) ? { previous, current } : { current };
};

export interface LiveNumbers {
  /** The fingerprints of the findings that need a look right now. */
  fingerprints: readonly string[];
  active: number;
  sessions: number;
}

const snapshotOf = (live: LiveNumbers, now: Date): SeenSnapshot => ({
  at: now.toISOString(),
  findings: [...new Set(live.fingerprints.map(findingKey))].slice(0, MAX_FINDINGS),
  active: live.active,
  sessions: live.sessions,
});

/**
 * The snapshots to compare with on this visit, and whether they changed and so
 * need saving. A first visit has nothing to compare with.
 */
export const rollSeen = (
  saved: unknown,
  live: LiveNumbers,
  now: Date,
): { seen: Seen; changed: boolean } => {
  const read = readSeen(saved);
  if (!read) return { seen: { current: snapshotOf(live, now) }, changed: true };
  if (now.getTime() - Date.parse(read.current.at) >= SEEN_ROLL_MS) {
    return { seen: { previous: read.current, current: snapshotOf(live, now) }, changed: true };
  }
  return { seen: read, changed: false };
};

export interface SinceVisit {
  /** When the visit being compared with was (ISO). */
  at: string;
  /** Findings that need a look now and did not then. */
  added: number;
  /** Findings that needed a look then and no longer do. */
  resolved: number;
  /** Findings that need a look now. */
  total: number;
}

/** What changed since the last visit; null on a first visit. */
export const sinceVisit = (seen: Seen, live: LiveNumbers): SinceVisit | null => {
  if (!seen.previous) return null;
  const before = new Set(seen.previous.findings);
  const now = new Set(live.fingerprints.map(findingKey));
  return {
    at: seen.previous.at,
    added: [...now].filter(key => !before.has(key)).length,
    resolved: [...before].filter(key => !now.has(key)).length,
    total: now.size,
  };
};
