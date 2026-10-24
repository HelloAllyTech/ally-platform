import { formatMs, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { AllyGuideArm } from "@types";

/**
 * Fewer canary turns than this is too few to read anything into. Mirrors `ALERT_THRESHOLDS.minTurns`
 * in ally-be's alert rules, so the monitor and the alerts agree on when a number means something.
 */
export const MIN_TURNS_TO_COMPARE = 20;

/**
 * How a metric is drawn and judged.
 *  - `count`: a volume. Shown raw, never compared: the canary takes a share, so it is always smaller.
 *  - `per100`: a count per 100 turns, so a canary with a fifth of the traffic can be set beside GA.
 */
export type ComparisonKind = "count" | "rate" | "ms" | "usd" | "per100" | "items";

export type ComparisonKey =
  | "turns"
  | "threads"
  | "failureRate"
  | "ttftP50Ms"
  | "costPerThreadUsd"
  | "crisisReplies"
  | "careEntries"
  | "refusals"
  | "thumbsUp"
  | "thumbsDown"
  | "quizFirstAttempts"
  | "quizFirstAttemptPassRate"
  | "itemsCompletedPerThread";

export interface ComparisonMetric {
  key: ComparisonKey;
  kind: ComparisonKind;
  /**
   * True: higher is the good direction. False: lower is. Null: neither. A volume has no good
   * direction, and neither does a safety count: more crisis replies can mean a classifier that
   * over-triggers or one that catches more, so a difference there is "look into it", never "worse".
   */
  higherIsBetter: boolean | null;
}

/** In the order the monitor lists them: volume, then health, then safety, then feedback. */
export const COMPARISON_METRICS: ComparisonMetric[] = [
  { key: "turns", kind: "count", higherIsBetter: null },
  { key: "threads", kind: "count", higherIsBetter: null },
  { key: "failureRate", kind: "rate", higherIsBetter: false },
  { key: "ttftP50Ms", kind: "ms", higherIsBetter: false },
  { key: "costPerThreadUsd", kind: "usd", higherIsBetter: false },
  { key: "crisisReplies", kind: "per100", higherIsBetter: null },
  { key: "careEntries", kind: "per100", higherIsBetter: null },
  { key: "refusals", kind: "per100", higherIsBetter: null },
  { key: "thumbsUp", kind: "per100", higherIsBetter: true },
  { key: "thumbsDown", kind: "per100", higherIsBetter: false },
  { key: "quizFirstAttempts", kind: "count", higherIsBetter: null },
  { key: "quizFirstAttemptPassRate", kind: "rate", higherIsBetter: true },
  { key: "itemsCompletedPerThread", kind: "items", higherIsBetter: true },
];

/** The number a metric is compared on: the raw figure, or per 100 turns for a `per100` metric. */
export const armValue = (
  arm: AllyGuideArm | undefined,
  metric: ComparisonMetric,
): number | null => {
  if (!arm) return null;
  const raw = arm[metric.key];
  if (raw === null || raw === undefined) return null;
  if (metric.kind === "per100") return arm.turns > 0 ? (raw / arm.turns) * 100 : null;
  return raw;
};

/** Below this magnitude a difference displays as zero, so it is called "no difference". */
const NEGLIGIBLE: Record<Exclude<ComparisonKind, "count">, number> = {
  rate: 0.0005, // 0.05 points
  ms: 0.5,
  usd: 0.00005,
  per100: 0.05,
  items: 0.05,
};

/** `differs`: a real difference in a measure with no good direction (a safety count). */
export type DifferenceDirection = "better" | "worse" | "same" | "differs";

export interface Difference {
  /** Signed text ("+1.2 pts"), or "No difference". Null for a metric that is not compared. */
  text: string | null;
  direction: DifferenceDirection | null;
}

const signed = (delta: number) => (delta > 0 ? "+" : "−");

/** The canary minus GA, in the metric's own unit, and whether that is the good direction. */
export const compare = (
  metric: ComparisonMetric,
  ga: number | null,
  canary: number | null,
): Difference => {
  if (metric.kind === "count" || ga === null || canary === null) {
    return { text: null, direction: null };
  }
  const delta = canary - ga;
  const size = Math.abs(delta);
  if (size < NEGLIGIBLE[metric.kind]) return { text: "No difference", direction: "same" };
  let magnitude: string;
  switch (metric.kind) {
    case "rate":
      magnitude = `${(size * 100).toFixed(1)} pts`;
      break;
    case "ms":
      magnitude = formatMs(size);
      break;
    case "usd":
      magnitude = formatUsd(size);
      break;
    case "items":
      magnitude = `${size.toFixed(1)} items`;
      break;
    default:
      magnitude = `${size.toFixed(1)} per 100 turns`;
  }
  const direction: DifferenceDirection =
    metric.higherIsBetter === null
      ? "differs"
      : delta > 0 === metric.higherIsBetter
        ? "better"
        : "worse";
  return { text: `${signed(delta)}${magnitude}`, direction };
};

/** Whether the canary has served enough turns for its numbers to be read at all. */
export const hasEnoughTurns = (arm: AllyGuideArm | undefined): boolean =>
  (arm?.turns ?? 0) >= MIN_TURNS_TO_COMPARE;

/** The two arms, GA and canary, picked out of the API's list (either can be absent). */
export const pickArms = (
  arms: AllyGuideArm[] | undefined,
): { ga: AllyGuideArm | undefined; canary: AllyGuideArm | undefined } => ({
  ga: arms?.find(arm => arm.arm === "ga"),
  canary: arms?.find(arm => arm.arm === "canary"),
});

export interface CanaryLearningGuard {
  /** Engagement is up on the canary while quiz first-attempt pass is lower than live's. */
  triggered: boolean;
  engagementUp: ("itemsCompletedPerThread" | "turnsPerThread")[];
  gaPass: number | null;
  canaryPass: number | null;
  canaryQuizAttempts: number;
}

const turnsPerThread = (arm: AllyGuideArm): number | null =>
  arm.threads > 0 ? arm.turns / arm.threads : null;

/**
 * The plan's guard (§4.13) for a canary: engagement that rises while learning is flat or falling is a
 * reason to revert. Engagement here is items completed per conversation and turns per conversation;
 * learning is quiz first-attempt pass. Only the clear case is flagged (engagement higher on either
 * measure AND pass strictly lower): "flat" is left to the reader, as no tolerance would be anything
 * but invented. Null while the canary has too few turns, or either arm is missing.
 */
export const canaryLearningGuard = (
  ga: AllyGuideArm | undefined,
  canary: AllyGuideArm | undefined,
): CanaryLearningGuard | null => {
  if (!ga || !canary || !hasEnoughTurns(canary)) return null;
  const engagementUp: CanaryLearningGuard["engagementUp"] = [];
  const gaItems = ga.itemsCompletedPerThread;
  const canaryItems = canary.itemsCompletedPerThread;
  if (gaItems !== null && canaryItems !== null && canaryItems > gaItems) {
    engagementUp.push("itemsCompletedPerThread");
  }
  const gaDepth = turnsPerThread(ga);
  const canaryDepth = turnsPerThread(canary);
  if (gaDepth !== null && canaryDepth !== null && canaryDepth > gaDepth) {
    engagementUp.push("turnsPerThread");
  }
  const gaPass = ga.quizFirstAttemptPassRate;
  const canaryPass = canary.quizFirstAttemptPassRate;
  const learningLower = gaPass !== null && canaryPass !== null && canaryPass < gaPass;
  return {
    triggered: engagementUp.length > 0 && learningLower,
    engagementUp,
    gaPass,
    canaryPass,
    canaryQuizAttempts: canary.quizFirstAttempts,
  };
};
