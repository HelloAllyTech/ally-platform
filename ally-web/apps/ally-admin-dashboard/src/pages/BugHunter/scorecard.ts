/**
 * Two formatters the Bug Agent analytics still use. The rest of this module —
 * the run scorecard's rates and its spend windows — went with the scorecard
 * (unmounted since OPP-0749, deleted 2026-10-12).
 */

/** A rate as whole-percent, or "—" when there is no denominator to divide by. */
export const formatRate = (rate: number | null): string =>
  rate == null ? "—" : `${Math.round(rate * 100)}%`;

/** Token counts, abbreviated — 1.2M reads faster than 1,238,004 and no decision turns on the digits. */
export const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
};
