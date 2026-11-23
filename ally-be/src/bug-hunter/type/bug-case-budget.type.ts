/**
 * The budget on one bug's case file — OPP-0775.
 *
 * Every move Bug Hunter makes on a bug spends something: a fix session is a
 * CI run, an attempt is a test-and-fix loop, an escalation is a person's
 * attention, and all of it is dollars and minutes. Until now those caps lived
 * in the workflow file (a wall-clock timeout), in the prompt text ("two
 * attempts") and in the admin's patience. The 6 October incident, where two
 * runs idled for two hours after finishing, is what a budget nobody owns
 * looks like.
 *
 * So the caps live on the finding, and every move decrements them. The
 * orchestrator (OPP-0783) will read these before choosing a move; today the
 * one hard gate is session start, and the counters are shown in the drawer.
 *
 * Stored as one `budget` jsonb column rather than ten numeric columns: the
 * set of things we meter will grow (a Verifier run is a new kind), caps and
 * used always travel together, and nothing queries them in SQL.
 */
export const BUG_CASE_BUDGET_KINDS = [
  'sessions',
  'attempts',
  'escalations',
  'usd',
  'minutes',
] as const;
export type BugCaseBudgetKind = (typeof BUG_CASE_BUDGET_KINDS)[number];

export type BugCaseBudgetAmounts = Record<BugCaseBudgetKind, number>;

export interface BugCaseBudget {
  caps: BugCaseBudgetAmounts;
  used: BugCaseBudgetAmounts;
  /** Set the first time a cap is reached; cleared when a person overrides. */
  exhausted: { kind: BugCaseBudgetKind; at: string } | null;
  /** The admin who last started a session past the cap, and when. */
  overriddenBy: number | null;
  overriddenAt: string | null;
}

/**
 * Defaults per bug. Deliberately modest: the point of a budget is to make
 * "try again" a decision rather than a reflex. Sessions and attempts match
 * what the fix protocol already allows (two attempts per session, two
 * sessions before a person is asked); dollars and minutes are a ceiling well
 * above what a healthy fix costs today ($2–5, 15–40 minutes) and well below
 * what the idle loop burned.
 */
export const BUG_CASE_BUDGET_DEFAULTS: BugCaseBudgetAmounts = {
  sessions: 2,
  attempts: 4,
  escalations: 1,
  usd: 15,
  minutes: 120,
};

const ZERO: BugCaseBudgetAmounts = {
  sessions: 0,
  attempts: 0,
  escalations: 0,
  usd: 0,
  minutes: 0,
};

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

/** A full budget from whatever is stored — null, partial, or hand-edited. */
export function withBudgetDefaults(
  stored: Partial<BugCaseBudget> | null | undefined,
  defaults: BugCaseBudgetAmounts = BUG_CASE_BUDGET_DEFAULTS,
): BugCaseBudget {
  const caps = { ...defaults };
  const used = { ...ZERO };
  for (const kind of BUG_CASE_BUDGET_KINDS) {
    caps[kind] = num(stored?.caps?.[kind], defaults[kind]);
    used[kind] = num(stored?.used?.[kind], 0);
  }
  const exhausted =
    stored?.exhausted &&
    BUG_CASE_BUDGET_KINDS.includes(stored.exhausted.kind) &&
    typeof stored.exhausted.at === 'string'
      ? { kind: stored.exhausted.kind, at: stored.exhausted.at }
      : null;
  return {
    caps,
    used,
    exhausted,
    overriddenBy:
      typeof stored?.overriddenBy === 'number' ? stored.overriddenBy : null,
    overriddenAt:
      typeof stored?.overriddenAt === 'string' ? stored.overriddenAt : null,
  };
}
