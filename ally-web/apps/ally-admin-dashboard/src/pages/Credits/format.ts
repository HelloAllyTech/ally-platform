import { usd as usd2 } from "../Plan/format";

/** `$20.00`; small amounts keep four decimals so $0.0043 doesn't read as $0.00. */
export const money = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return usd2(n);
};

/** A dollar input: null for empty, NaN for text that isn't an amount. */
export const parseDollars = (raw: string): number | null => {
  const text = raw.trim().replace(/^\$/, "");
  if (text === "") return null;
  return /^-?\d+(\.\d{1,6})?$/.test(text) ? Number(text) : Number.NaN;
};
