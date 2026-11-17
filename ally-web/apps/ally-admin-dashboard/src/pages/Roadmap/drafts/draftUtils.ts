import { en } from "@constants";

import type { RoadmapDraftCheck, RoadmapFlowError } from "../../../types/roadmapV2Flow";

/** "just now", "12s ago", "3 min ago", "2 h ago", "yesterday". */
export const agoText = (at: number | null | undefined, now: number = Date.now()): string => {
  const ago = en.roadmapV2.draft.ago;
  if (!at) return ago.now;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return ago.now;
  if (seconds < 60) return ago.seconds(seconds);
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ago.minutes(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ago.hours(hours);
  return ago.days(Math.round(hours / 24));
};

/** The checks that are met now and weren't before: these glow their quote (§4.18). */
export const newlyMet = (
  before: RoadmapDraftCheck[] | undefined,
  after: RoadmapDraftCheck[] | undefined,
): RoadmapDraftCheck[] => {
  const was = new Set((before ?? []).filter(c => c.met).map(c => c.id));
  return (after ?? []).filter(c => c.met && !was.has(c.id));
};

export const errorCode = (error: unknown): string | undefined =>
  (error as RoadmapFlowError)?.data?.code;

export const errorStatus = (error: unknown): number | undefined => {
  const status = (error as RoadmapFlowError)?.status;
  return typeof status === "number" ? status : undefined;
};

/** Seven days before a draft archives (or an archived one is deleted), it says so (§4.4). */
export const WARN_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

export const dueSoon = (iso: string | null | undefined, now: number = Date.now()): boolean => {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  return !Number.isNaN(at) && at - now <= WARN_BEFORE_MS;
};

/** First-submit note handoff: the draft page sets it, the idea page shows it once (§4.14). */
const FIRST_SUBMIT_KEY = (code: string) => `ally.roadmap.firstSubmit.${code.toUpperCase()}`;

export const markFirstSubmit = (code: string) => {
  try {
    window.sessionStorage.setItem(FIRST_SUBMIT_KEY(code), "1");
  } catch {
    // no note is the worst case
  }
};

export const takeFirstSubmit = (code: string): boolean => {
  try {
    const key = FIRST_SUBMIT_KEY(code);
    const on = window.sessionStorage.getItem(key) === "1";
    if (on) window.sessionStorage.removeItem(key);
    return on;
  } catch {
    return false;
  }
};
