/**
 * Pure formatting and shaping helpers for the Ally Console and the organisation's Ally tab.
 * Kept free of React and of the `@constants` / `@utils` barrels so they test without a store.
 */

import { AllyGuideLanguage } from "@types";

const DASH = "—";

/** The languages Ally has fixed crisis copy and support lines for, in the order the console lists them. */
export const ALLY_GUIDE_LANGUAGES: AllyGuideLanguage[] = ["en", "hi", "mr", "ta", "kn"];

/** "840 ms" under a second, "1.24 s" above it; a dash when there is no figure. */
export const formatMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
};

/**
 * Dollars. Sub-cent amounts keep four places (a single turn costs fractions of a cent, and "$0.00"
 * hides the difference between nothing and almost nothing). Accepts the string a numeric column
 * arrives as.
 */
export const formatUsd = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return DASH;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return "$0.00";
  return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
};

/** A 0–1 ratio as "98.4%"; a dash when the window had nothing to measure. */
export const formatPercent = (ratio: number | null | undefined): string => {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return DASH;
  return `${(ratio * 100).toFixed(1)}%`;
};

/** Compact token and turn counts: 950, 12.3k, 1.2M. */
export const formatCount = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
};

export const releaseVersionLabel = (version: number): string => `v${version}`;

export const shortId = (id: string): string => id.slice(0, 8);

/** The HTTP status carried by an RTK Query error, if it has one. */
export const errorStatus = (error: unknown): number | undefined => {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
};

export const isForbiddenError = (error: unknown): boolean => errorStatus(error) === 403;
export const isNotFoundError = (error: unknown): boolean => errorStatus(error) === 404;

export interface KeyValueRow {
  key: string;
  value: string;
}

const formatLeaf = (value: unknown): string => {
  if (value === null || value === undefined) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
};

/**
 * Flattens a nested object into one `dotted.path → value` row per leaf, in the object's own order.
 *
 * The release bundle's policy is five levels of nested numbers; a table is the only form an admin
 * can scan and compare between releases. Arrays of scalars become one comma-joined value; arrays of
 * objects are indexed (`routes.0.model`). An empty object or array is dropped rather than shown as
 * a row with nothing in it.
 */
export const flattenToRows = (value: unknown, prefix = ""): KeyValueRow[] => {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.every(item => item === null || typeof item !== "object")) {
      return [{ key: prefix, value: value.map(formatLeaf).join(", ") }];
    }
    return value.flatMap((item, index) =>
      flattenToRows(item, prefix ? `${prefix}.${index}` : `${index}`),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenToRows(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [{ key: prefix, value: formatLeaf(value) }];
};

/** Pretty JSON for a payload section whose shape the server does not fix. */
export const toPrettyJson = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
};

/** Who approved a crisis message: "you", "user 12", or an honest "someone unrecorded". */
export const approverLabel = (
  approvedBy: number | null | undefined,
  currentUserId: number | string | null | undefined,
  strings: { you: string; user: (id: number) => string; unknown: string },
): string => {
  if (approvedBy === null || approvedBy === undefined) return strings.unknown;
  if (
    currentUserId !== null &&
    currentUserId !== undefined &&
    Number(currentUserId) === approvedBy
  ) {
    return strings.you;
  }
  return strings.user(approvedBy);
};
