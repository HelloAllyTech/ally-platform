import {
  ROADMAP_MULTIPLIER_MAX_BONUS,
  ROADMAP_MULTIPLIER_TARGET_AUTHORS,
} from '../constants/product-roadmap.constants';

/**
 * How many distinct colleagues a voter needs to back for the full bonus: the configured cap,
 * but never more than the number of other authors who actually have something to vote on —
 * otherwise a quiet board makes the ceiling unreachable. At least 1 so the ratio is defined.
 */
export function breadthTarget(candidateAuthors: number): number {
  return Math.max(
    1,
    Math.min(ROADMAP_MULTIPLIER_TARGET_AUTHORS, Math.floor(candidateAuthors)),
  );
}

/** 1.00 to 1.00 + MAX_BONUS, two decimals. */
export function breadthMultiplier(qualifying: number, target: number): number {
  const ratio = Math.min(1, Math.max(0, qualifying) / Math.max(1, target));
  return Math.round((1 + ROADMAP_MULTIPLIER_MAX_BONUS * ratio) * 100) / 100;
}

/**
 * The first moment the multiplier will go DOWN purely from votes ageing out of the window.
 *
 * `dropTimes` is one entry per qualifying author: when that author leaves the window (their
 * newest qualifying vote + the window). Authors beyond the target don't matter until the count
 * falls below it, so the drop that counts is the (qualifying − target + 1)-th earliest.
 * Returns null when nothing will drop (no qualifying authors, or the multiplier is unaffected).
 */
export function nextDrop(
  dropTimes: { authorId: number; at: Date }[],
  target: number,
): { at: Date; authorId: number; multiplierAfter: number } | null {
  const sorted = [...dropTimes].sort((a, b) => a.at.getTime() - b.at.getTime());
  const qualifying = sorted.length;
  if (qualifying === 0) return null;
  const index = Math.max(0, qualifying - target);
  const hit = sorted[index];
  if (!hit) return null;
  // Everything that leaves at or before `hit` is gone by then.
  const gone = sorted.filter((d) => d.at.getTime() <= hit.at.getTime()).length;
  return {
    at: hit.at,
    authorId: hit.authorId,
    multiplierAfter: breadthMultiplier(qualifying - gone, target),
  };
}

/** Priority points are shown to one decimal; keep the API honest about that. */
export function roundPoints(n: number): number {
  return Math.round(n * 10) / 10;
}
