/** Working days (Mon–Fri) from `iso` to `now`, whole days only. 0 for a missing or future date. */
export const workingDaysSince = (
  iso: string | null | undefined,
  now: number = Date.now(),
): number => {
  if (!iso) return 0;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime()) || start.getTime() >= now) return 0;
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end = new Date(now);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let count = 0;
  while (day < last) {
    day.setDate(day.getDate() + 1);
    const dow = day.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
};

/** A swipe past this share of the card's width commits (§4.17). */
export const SWIPE_COMMIT_FRACTION = 0.4;

/** Which way a released swipe goes: commit right (pick a lead), left (decline), or spring back. */
export const swipeDecision = (offsetX: number, width: number): "pickLead" | "decline" | null => {
  if (width <= 0) return null;
  if (offsetX >= width * SWIPE_COMMIT_FRACTION) return "pickLead";
  if (offsetX <= -width * SWIPE_COMMIT_FRACTION) return "decline";
  return null;
};

/**
 * What a To do idea needs next from an Owner (lifecycle 2026-11-18): planning (Start planning
 * accepts it too), closing the plan (done on the idea page, where the plan is), or a builder once
 * the plan is closed.
 */
export type TodoStep = "plan" | "closePlan" | "pickBuilder";

export const todoNextStep = (row: { shownStage: string; statusParts?: unknown }): TodoStep => {
  if (row.shownStage !== "planning") return "plan";
  const parts = (row.statusParts ?? {}) as { planClosed?: unknown };
  return parts.planClosed ? "pickBuilder" : "closePlan";
};
