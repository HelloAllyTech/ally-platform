/**
 * Priority points are votes weighted by each voter's breadth multiplier, so the number can be
 * fractional. Whole numbers stay whole ("41"), fractions show one decimal ("41.3") — never
 * "41.30000001" and never a trailing ".0".
 */
export const formatPoints = (n: number | null | undefined): string => {
  const value = Number.isFinite(n) ? (n as number) : 0;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/** "×1.2" — the breadth multiplier as shown on the badge and in the panel. */
export const formatMultiplier = (m: number): string => {
  const fixed = (Math.round(m * 100) / 100).toFixed(2);
  return `×${fixed.endsWith("0") ? fixed.slice(0, -1) : fixed}`;
};
