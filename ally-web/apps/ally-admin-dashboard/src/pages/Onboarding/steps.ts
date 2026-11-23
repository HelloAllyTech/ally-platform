import type { BotDraftStep } from "./types";

/** Steps in order, to say which sections a draft has reached. */
const ORDER: BotDraftStep[] = [
  "start",
  "reading",
  "learned",
  "safety",
  "gaps",
  "design",
  "building",
  "checkup",
  "try_it",
  "share",
  "published",
];

export const reached = (step: BotDraftStep, at: BotDraftStep): boolean =>
  ORDER.indexOf(step) >= ORDER.indexOf(at);
