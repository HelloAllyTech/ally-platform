import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';

/**
 * Month arithmetic for an opportunity's planned and release months. Pure functions, no
 * repository: which month a card lives in is decided in one place.
 *
 * Month keys are 'YYYY-MM', the same shape and the same UTC basis as the vote period key
 * (see roadmap-period.util.ts).
 */

/** 'YYYY-MM' for a date, always UTC — see currentPeriodKey for why this is never local time. */
export function monthKeyOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // getUTCMonth is 0-based
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Whether a card's month is decided FOR it rather than by whoever drags it.
 *
 * Once something has shipped, the month it shipped in is a fact, so the board shows it there and
 * refuses to move it. A released row with a NULL releasedAt is NOT pinned — roughly 173 of the 280
 * rows migrated from the standalone app are exactly that (the source trigger only fired on
 * transition, and nothing may backfill it), and pinning those would strand them in a lane that
 * cannot exist while also making them undraggable.
 */
export function isMonthPinned(
  stage: RoadmapOpportunityStage,
  releasedAt: Date | null | undefined,
): boolean {
  return stage === RoadmapOpportunityStage.RELEASED && !!releasedAt;
}

/**
 * The lane a card actually appears in: its release month once it has shipped, otherwise the
 * month somebody planned it into. Null means the Unscheduled lane.
 *
 * The SQL mirror (EFFECTIVE_MONTH_SQL) went with the old month board's read; this is now the
 * only copy of the rule.
 */
export function effectiveMonthOf(
  stage: RoadmapOpportunityStage,
  releasedAt: Date | null | undefined,
  plannedMonth: string | null | undefined,
): string | null {
  if (isMonthPinned(stage, releasedAt))
    return monthKeyOf(new Date(releasedAt!));
  return plannedMonth ?? null;
}
