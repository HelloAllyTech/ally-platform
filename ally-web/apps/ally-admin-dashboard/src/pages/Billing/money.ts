/**
 * Money on Ally admin → Models and → Costs (CR1). The price list keeps **micros** (millionths of a
 * dollar, so a $0.0118 WhatsApp message is exact); the cost reports already answer in dollars.
 */

const MICROS_PER_USD = 1_000_000;

/** Micros to dollars. `null` stays `null`: "no price" is not "free". */
export const microsToUsd = (micros: number | string | null | undefined): number | null => {
  if (micros === null || micros === undefined || micros === "") return null;
  const n = Number(micros);
  return Number.isFinite(n) ? n / MICROS_PER_USD : null;
};

/**
 * `$` with a fixed number of decimals, or an em dash for no value. Small prices need the
 * decimals: per-million token prices to 3, a WhatsApp message to 4.
 */
export const formatUsd = (usd: number | null | undefined, decimals = 2): string => {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  const sign = usd < 0 ? "-" : "";
  const fixed = Math.abs(usd).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${grouped}${fraction ? `.${fraction}` : ""}`;
};

/** A per-million-tokens price from micros: `$0.400`. */
export const formatPerMillion = (micros: number | null | undefined): string =>
  formatUsd(microsToUsd(micros), 3);

/** One WhatsApp message from micros: `$0.0118`. */
export const formatPerMessage = (micros: number | null | undefined): string =>
  formatUsd(microsToUsd(micros), 4);

/** A unit price (per minute, page…) from micros, to 4 decimals: `$0.0060`. */
export const formatUnitPrice = (micros: number | null | undefined): string =>
  formatUsd(microsToUsd(micros), 4);

/**
 * A cost total. Below a dollar shows 4 decimals, so a month of a few cheap calls doesn't read
 * as $0.00.
 */
export const formatCost = (usd: number | null | undefined): string =>
  formatUsd(
    usd,
    usd !== null && usd !== undefined && Math.abs(usd) > 0 && Math.abs(usd) < 1 ? 4 : 2,
  );

/** A count with thousands separators. */
export const formatCount = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : Math.round(n).toLocaleString("en-US");

/** Today as YYYY-MM-DD in UTC, as ally-be counts days. */
export const todayIso = (now = new Date()): string => now.toISOString().slice(0, 10);

/** This month as YYYY-MM in UTC. */
export const thisMonth = (now = new Date()): string => now.toISOString().slice(0, 7);

/** A form's dollar field: blank is "no price" (`null`), anything else a number or NaN. */
export const parseUsdField = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed);
};
