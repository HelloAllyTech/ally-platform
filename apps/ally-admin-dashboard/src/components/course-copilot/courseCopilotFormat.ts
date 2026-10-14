import { en } from "@constants";

/**
 * Pure formatting for the Course Copilot work pane, kept out of the components so
 * it is unit-testable without a DOM and shared by the blueprint, build and course
 * views (all three say "how long" and "how much").
 */

/**
 * Every list in this pane is written by the agent, so none of it can be assumed
 * well-shaped — Builder's PRD panel crashed on a string where an array belonged
 * (`?.length` is true of a string, then `.map` throws). Read agent-authored
 * arrays through here.
 */
export const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** A finite number, or null — for fields the agent may have left unset or mistyped. */
export const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * "$1.23". A real but sub-cent amount reads "<$0.01" rather than "$0.00", which
 * would claim the work is free.
 */
export const formatUsd = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "$0.00";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
};

/** "45 min", "1 h", "1 h 15 min". */
export const formatMinutes = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

/** "45s", "3m 12s", "1h 4m" — wall-clock time a job or a build has taken. */
export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

/** Short seconds-based duration for completion rules: "45 s", "3 min". */
export const formatSeconds = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return formatMinutes(Math.round(seconds / 60));
};

/**
 * The URL if it is a plain http(s) link, else null. A link the agent or a trainer stored
 * is rendered as an anchor; a `javascript:` or `data:` URL in an anchor runs script in this
 * page when clicked, so anything that is not http(s) is shown as text, never linked.
 */
export const asHttpUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? text : null;
  } catch {
    return null;
  }
};

/** "mcq_single" -> "Mcq single", "TREX_RUNNER" -> "Trex runner". Last resort for ids with no copy. */
export const humanizeToken = (token: string): string => {
  const spaced = token.replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "";
};

/**
 * A completion rule as short phrases ("Pass mark 70", "Watch 90%"). Accepts the
 * loose shape the outline carries (`Record<string, unknown>`) as well as the
 * blueprint's typed criteria; anything that is not a finite number is ignored.
 */
export const summarizeCompletion = (criteria: unknown): string[] => {
  if (!criteria || typeof criteria !== "object") return [];
  const rule = criteria as Record<string, unknown>;
  const strings = en.courseCopilotPane.completion;
  const phrases: string[] = [];

  const minScore = asNumber(rule.minScore);
  if (minScore !== null) phrases.push(strings.minScore(minScore));
  const passScore = asNumber(rule.passScore);
  if (passScore !== null) phrases.push(strings.passScore(passScore));
  const watchPct = asNumber(rule.watchPct);
  if (watchPct !== null) phrases.push(strings.watchPct(watchPct));
  const minReadSeconds = asNumber(rule.minReadSeconds);
  if (minReadSeconds !== null && minReadSeconds > 0)
    phrases.push(strings.minRead(formatSeconds(minReadSeconds)));
  const minDurationSeconds = asNumber(rule.minDurationSeconds);
  if (minDurationSeconds !== null && minDurationSeconds > 0)
    phrases.push(strings.minDuration(formatSeconds(minDurationSeconds)));

  return phrases;
};
