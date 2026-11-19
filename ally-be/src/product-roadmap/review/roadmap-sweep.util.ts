/**
 * The one-time To do sweep (Roadmap idea-to-plan audit, rec 9): ideas that
 * have waited a long time and drawn almost no support are pulled up for the
 * Owner's existing bulk review, where each is declined with a reason or kept.
 * The sweep only FINDS them. It never declines, edits or moves an idea; every
 * change is an Owner's click.
 */

/** Older than this many days (from filing). */
export const SWEEP_OLDER_THAN_DAYS = 60;
/** At most this many people have ever voted for it. */
export const SWEEP_MAX_VOTERS = 1;
/** One pass shows at most this many: the bulk review takes 50 at a time. */
export const SWEEP_PAGE = 50;

export interface SweepCandidate {
  id: string;
  createdAt: Date;
  voters: number;
  shownStage: string;
  hasLead: boolean;
  kept: boolean;
}

/**
 * Pure: is this idea one the sweep pulls up? Only To do ideas nobody has
 * started planning (awaiting review, or accepted and waiting), older than the
 * line, with at most one voter, and not already kept by an Owner.
 */
export function isSweepCandidate(c: SweepCandidate, now: Date): boolean {
  if (c.kept || c.hasLead) return false;
  if (c.shownStage !== 'submitted' && c.shownStage !== 'accepted') return false;
  if (c.voters > SWEEP_MAX_VOTERS) return false;
  const ageMs = now.getTime() - c.createdAt.getTime();
  return ageMs > SWEEP_OLDER_THAN_DAYS * 86_400_000;
}
