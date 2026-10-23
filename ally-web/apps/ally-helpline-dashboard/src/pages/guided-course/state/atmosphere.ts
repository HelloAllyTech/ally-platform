/**
 * How loud the interface is allowed to be (plan §5.9, §4.7; tokens.md §2.4).
 * The server sends an atmosphere with every mode change; the client may only
 * make it quieter, never louder: a chapter with trigger warnings is hushed
 * even when the thread is NORMAL.
 */
import type { GuideAtmosphere, GuideMode, GuideTone } from "@types/generated/guide-contract";

import type { GuidanceLevel } from "../contract/bootstrap";

const LOUDNESS: Record<GuideAtmosphere, number> = { bright: 0, hushed: 1, still: 2 };

const quieter = (a: GuideAtmosphere, b: GuideAtmosphere): GuideAtmosphere =>
  LOUDNESS[a] >= LOUDNESS[b] ? a : b;

export interface AtmosphereInput {
  mode: GuideMode;
  serverAtmosphere: GuideAtmosphere;
  /** The current scene's chapter has items with trigger warnings. */
  sceneHasWarnings: boolean;
}

export const resolveAtmosphere = ({
  mode,
  serverAtmosphere,
  sceneHasWarnings,
}: AtmosphereInput): GuideAtmosphere => {
  let atmosphere = serverAtmosphere;
  if (mode === "CRISIS") atmosphere = quieter(atmosphere, "still");
  if (mode === "CARE" || mode === "CRISIS_FOLLOWUP") atmosphere = quieter(atmosphere, "hushed");
  if (sceneHasWarnings) atmosphere = quieter(atmosphere, "hushed");
  return atmosphere;
};

export type CelebrationTier = GuideTone | "none";

/**
 * The celebration a completion may have: hushed caps at quiet; CRISIS and
 * CRISIS_FOLLOWUP (and the still atmosphere) suppress it (card grammar §2).
 */
export const capTone = (
  tone: GuideTone | null | undefined,
  atmosphere: GuideAtmosphere,
  mode: GuideMode,
): CelebrationTier => {
  if (mode === "CRISIS" || mode === "CRISIS_FOLLOWUP" || atmosphere === "still") return "none";
  if (atmosphere === "hushed") return "quiet";
  return tone ?? "quiet";
};

/** Ally's prose ceiling per turn under each dial setting (plan §5.1). */
export const PROSE_BUDGET_WORDS: Record<GuidanceLevel, number> = {
  lead: 90,
  walk: 60,
  drive: 25,
};

export const proseBudget = (level: GuidanceLevel): number => PROSE_BUDGET_WORDS[level];

/**
 * The blue next-step dock shows only when the room is bright, the thread is
 * NORMAL and the server has a visible next step (it hides it at steer level 0).
 */
export const dockVisible = (input: {
  atmosphere: GuideAtmosphere;
  mode: GuideMode;
  nextStep: { hidden: boolean; itemId: string | null } | null;
}): boolean =>
  input.atmosphere === "bright" &&
  input.mode === "NORMAL" &&
  Boolean(input.nextStep && !input.nextStep.hidden && input.nextStep.itemId);

export type ReplyVerb =
  | "tellMore"
  | "example"
  | "notSure"
  | "notNow"
  | "tryIt"
  | "notWhatIMeant"
  | "breathe"
  | "talk"
  | "supportOptions"
  | "backToCourse";

/**
 * The quiet chips above the composer (plan §5.7). CARE swaps them for its
 * fixed set (voice and tone §11.1); the still atmosphere shows none.
 */
export const replyVerbsFor = (input: {
  mode: GuideMode;
  atmosphere: GuideAtmosphere;
  allyJustAnswered: boolean;
}): ReplyVerb[] => {
  if (input.atmosphere === "still" || input.mode === "CRISIS") return [];
  if (input.mode === "CARE" || input.mode === "CRISIS_FOLLOWUP") {
    return ["breathe", "talk", "supportOptions", "backToCourse"];
  }
  const verbs: ReplyVerb[] = ["tellMore", "example", "notSure", "notNow", "tryIt"];
  return input.allyJustAnswered ? [...verbs, "notWhatIMeant"] : verbs;
};
