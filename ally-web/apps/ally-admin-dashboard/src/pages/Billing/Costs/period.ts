import type { CostPeriod } from "@api";

export type PeriodPreset = "month" | "last7" | "last30" | "lastMonth";
export const PERIOD_PRESETS: PeriodPreset[] = ["month", "last7", "last30", "lastMonth"];

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A preset as the dates ally-be reads, in UTC as it counts days. `to` is exclusive and left out for
 * "up to now", so ally-be's own default applies.
 */
export const periodFor = (preset: PeriodPreset, now = new Date()): CostPeriod => {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  switch (preset) {
    case "last7":
      return { from: iso(new Date(day.getTime() - 6 * DAY_MS)) };
    case "last30":
      return { from: iso(new Date(day.getTime() - 29 * DAY_MS)) };
    case "lastMonth":
      return {
        from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
        to: iso(monthStart),
      };
    case "month":
    default:
      return { from: iso(monthStart) };
  }
};
