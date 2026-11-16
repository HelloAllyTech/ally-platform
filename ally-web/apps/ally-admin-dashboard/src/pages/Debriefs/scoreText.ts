import { en } from "@constants";

/** A score to one decimal. */
export const one = (n: number) => n.toFixed(1);

/** "steady", "up 0.3", "down 0.4": this week against last week, to one decimal. */
export const scoreTrend = (score: number | null, last: number | null): string | null => {
  const t = en.debriefs.v2.home;
  if (score === null || last === null) return null;
  const d = Math.round((score - last) * 10) / 10;
  if (d === 0) return t.steady;
  return d > 0 ? t.up(one(d)) : t.down(one(-d));
};
