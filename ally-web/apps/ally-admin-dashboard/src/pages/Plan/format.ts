/**
 * Numbers and dates on the owner's Plan and usage (CR1 Part C), Share → People and publishing.
 * Counts only: nothing here formats money, and the owner side must never show a dollar.
 */

/** 1.2M, 2M, 950K, 312: token amounts at a glance. */
export const compactCount = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const unit = (value: number, suffix: string) => {
    const rounded = Math.round(value * 10) / 10;
    return `${sign}${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}${suffix}`;
  };
  if (abs >= 1_000_000_000) return unit(abs / 1_000_000_000, "B");
  if (abs >= 1_000_000) return unit(abs / 1_000_000, "M");
  if (abs >= 10_000) return unit(abs / 1_000, "K");
  return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
};

/** 1,000: counts people read exactly (conversations, messages, runs). */
export const fullCount = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : Math.round(n).toLocaleString("en-US");

/** $6.20: the monthly usage allowance, the one amount of money the owner is shown. */
export const usd = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "1 Dec" from YYYY-MM-DD or an ISO time, read in UTC as ally-be counts days. */
export const shortDay = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** "1 Dec 2026". */
export const longDay = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

/** How full a limit is, 0–100 (more than 100 when it dipped past). Unlimited is 0. */
export const percentUsed = (used: number, limit: number | null): number =>
  limit && limit > 0 ? Math.floor((used / limit) * 100) : 0;

/** A bar's level: at 80% it warns, at 100% it is used up. */
export const levelOf = (used: number, limit: number | null): "ok" | "high" | "full" => {
  const pct = percentUsed(used, limit);
  if (limit !== null && limit > 0 && used >= limit) return "full";
  return pct >= 80 ? "high" : "ok";
};
