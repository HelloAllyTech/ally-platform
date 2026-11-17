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

/** Which way a released swipe goes: commit right (accept), left (decline), or spring back. */
export const swipeDecision = (offsetX: number, width: number): "accept" | "decline" | null => {
  if (width <= 0) return null;
  if (offsetX >= width * SWIPE_COMMIT_FRACTION) return "accept";
  if (offsetX <= -width * SWIPE_COMMIT_FRACTION) return "decline";
  return null;
};
