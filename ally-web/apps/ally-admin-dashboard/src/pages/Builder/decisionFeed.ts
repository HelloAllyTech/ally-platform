import {
  BuilderDecision,
  BuilderDecisionCategory,
  BuilderDecisionKind,
  BuilderDecisionOption,
} from "@types";

/**
 * The decision feed's ordering, filtering and arithmetic — kept pure so the
 * page is layout and the rules are testable.
 *
 * The feed exists to raise the number of decisions a person can make per hour
 * of attention, so every rule here is about that: what comes first, what is
 * shown, and how the sitting is measured.
 */

/**
 * Which kinds come first. Two things decide it: how much the wait costs, and
 * how little the decision costs to make.
 *
 * A held budget is a runner slot wasting away and takes one key; a merge is
 * one key between finished work and production; a pull request Builder gave
 * up on is a person's bottleneck already. Interview questions are the bulk of
 * the feed and sit in the middle. Starting a build and approving a design
 * deserve a read of the PRD, so they come after the quick ones; a failed
 * build is the one kind where waiting costs nothing more.
 */
export const DECISION_KIND_PRIORITY: Record<BuilderDecisionKind, number> = {
  budget: 0,
  pr_merge: 1,
  pr_needs_human: 2,
  brief: 3,
  question: 4,
  design_review: 5,
  start_build: 6,
  build_failed: 7,
};

export type DecisionCategoryFilter = BuilderDecisionCategory | "all";

export const DECISION_CATEGORY_FILTERS: DecisionCategoryFilter[] = ["all", "what", "how", "issue"];

/**
 * Priority, then oldest wait first — and skipped cards go to the back in the
 * order they were skipped, so "skip" means "later", not "never".
 */
export const orderDecisions = (
  decisions: BuilderDecision[],
  skippedIds: string[] = [],
): BuilderDecision[] => {
  const skipRank = new Map(skippedIds.map((id, index) => [id, index]));
  const live = decisions
    .filter(decision => !skipRank.has(decision.id))
    .sort((a, b) => {
      const byKind = DECISION_KIND_PRIORITY[a.kind] - DECISION_KIND_PRIORITY[b.kind];
      if (byKind !== 0) return byKind;
      return new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime();
    });
  const skipped = decisions
    .filter(decision => skipRank.has(decision.id))
    .sort((a, b) => (skipRank.get(a.id) ?? 0) - (skipRank.get(b.id) ?? 0));
  return [...live, ...skipped];
};

export const filterDecisions = (
  decisions: BuilderDecision[],
  category: DecisionCategoryFilter,
): BuilderDecision[] =>
  category === "all" ? decisions : decisions.filter(decision => decision.category === category);

/** How many decisions sit in each category — for the filter chips' counts. */
export const countByCategory = (
  decisions: BuilderDecision[],
): Record<DecisionCategoryFilter, number> => {
  const counts: Record<DecisionCategoryFilter, number> = { all: 0, what: 0, how: 0, issue: 0 };
  for (const decision of decisions) {
    counts.all += 1;
    counts[decision.category] += 1;
  }
  return counts;
};

/**
 * Recommended first, otherwise as the agent ordered them — the eye lands on
 * the recommendation before the alternatives, which is the point of
 * recommending anything. Stable, so two unrecommended options keep their order.
 */
export const orderOptions = (options: BuilderDecisionOption[]): BuilderDecisionOption[] =>
  [...options].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));

export const recommendedOption = (
  options: BuilderDecisionOption[],
): BuilderDecisionOption | undefined => options.find(option => option.recommended);

/**
 * A gated question's rationale arrives as one string: the model's own line,
 * then `Based on: …` and `Yours to decide because: …`. Split so the card can
 * label each, which is what makes the rationale scannable at feed speed.
 */
export interface SplitRationale {
  why: string | null;
  basis: string | null;
  yours: string | null;
}

export const splitRationale = (rationale: string | null | undefined): SplitRationale => {
  const result: SplitRationale = { why: null, basis: null, yours: null };
  if (!rationale) return result;
  const why: string[] = [];
  for (const raw of rationale.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const basis = /^based on:\s*/i.exec(line);
    const yours = /^yours to decide because:\s*/i.exec(line);
    if (basis) result.basis = line.slice(basis[0].length).trim() || null;
    else if (yours) result.yours = line.slice(yours[0].length).trim() || null;
    else why.push(line);
  }
  result.why = why.length ? why.join(" ") : null;
  return result;
};

/** The digit keys 1–9 map to the first nine options; anything else is not a pick. */
export const optionIndexForKey = (key: string): number | null => {
  if (!/^[1-9]$/.test(key)) return null;
  return Number(key) - 1;
};

/**
 * This sitting, measured: how many decisions were made, how fast, and the
 * rate that implies. Measured from the page opening to the last answer, so
 * the rate does not sink while the person reads the next card and does not
 * flatter a single quick answer — it needs two before it says anything.
 */
export interface SittingStats {
  decided: number;
  /** Seconds per decision over the sitting; null until there are two. */
  averageSeconds: number | null;
  /** Decisions per hour at the sitting's pace; null until there are two. */
  perHour: number | null;
}

export const sittingStats = (openedAt: number, answeredAt: number[]): SittingStats => {
  const decided = answeredAt.length;
  if (decided < 2) return { decided, averageSeconds: null, perHour: null };
  const last = Math.max(...answeredAt);
  const spanSeconds = Math.max(1, (last - openedAt) / 1000);
  const averageSeconds = spanSeconds / decided;
  return {
    decided,
    averageSeconds,
    perHour: Math.max(1, Math.round((decided / spanSeconds) * 3600)),
  };
};

/** "45s", "2m 10s", "1h 4m" — the sitting's pace, in a size a header can hold. */
export const formatDuration = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
};

/**
 * Whether a key press came from somewhere that owns its keys. Shortcuts stay
 * out of text fields: typing "s" into the custom answer must not skip the card.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};
