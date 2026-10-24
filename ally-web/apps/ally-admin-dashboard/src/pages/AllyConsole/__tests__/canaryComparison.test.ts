import { describe, expect, it } from "vitest";

import { AllyGuideArm } from "@types";

import {
  armValue,
  canaryLearningGuard,
  COMPARISON_METRICS,
  compare,
  ComparisonMetric,
  hasEnoughTurns,
  MIN_TURNS_TO_COMPARE,
  pickArms,
} from "../canaryComparison";

const arm = (overrides: Partial<AllyGuideArm> = {}): AllyGuideArm => ({
  arm: "ga",
  turns: 1000,
  threads: 250,
  failureRate: 0.03,
  ttftP50Ms: 1100,
  costPerThreadUsd: 0.12,
  crisisReplies: 4,
  careEntries: 10,
  refusals: 5,
  thumbsUp: 40,
  thumbsDown: 10,
  quizFirstAttempts: 40,
  quizFirstAttemptPassRate: 0.7,
  itemsCompletedPerThread: 2,
  ...overrides,
});

const metric = (key: ComparisonMetric["key"]) =>
  COMPARISON_METRICS.find(candidate => candidate.key === key) as ComparisonMetric;

describe("armValue", () => {
  it("returns a raw figure as it is", () => {
    expect(armValue(arm(), metric("failureRate"))).toBe(0.03);
    expect(armValue(arm(), metric("turns"))).toBe(1000);
    expect(armValue(arm(), metric("ttftP50Ms"))).toBe(1100);
  });

  it("puts a count per 100 turns, so a canary with a fifth of the traffic can sit beside GA", () => {
    expect(armValue(arm({ turns: 1000, crisisReplies: 4 }), metric("crisisReplies"))).toBeCloseTo(
      0.4,
    );
    expect(armValue(arm({ turns: 200, crisisReplies: 1 }), metric("crisisReplies"))).toBeCloseTo(
      0.5,
    );
  });

  it("is null for an arm that has served nothing, rather than a divide by zero", () => {
    expect(armValue(arm({ turns: 0, crisisReplies: 0 }), metric("crisisReplies"))).toBeNull();
    expect(armValue(undefined, metric("turns"))).toBeNull();
  });

  it("is null when the API had no figure", () => {
    expect(armValue(arm({ ttftP50Ms: null }), metric("ttftP50Ms"))).toBeNull();
    expect(armValue(arm({ failureRate: null }), metric("failureRate"))).toBeNull();
  });
});

describe("compare", () => {
  it("compares nothing for a volume", () => {
    expect(compare(metric("turns"), 1000, 200)).toEqual({ text: null, direction: null });
  });

  it("compares nothing when either side has no figure", () => {
    expect(compare(metric("failureRate"), null, 0.1)).toEqual({ text: null, direction: null });
    expect(compare(metric("failureRate"), 0.1, null)).toEqual({ text: null, direction: null });
  });

  it("says a higher failure rate is the wrong direction, in points", () => {
    expect(compare(metric("failureRate"), 0.03, 0.045)).toEqual({
      text: "+1.5 pts",
      direction: "worse",
    });
    expect(compare(metric("failureRate"), 0.03, 0.01)).toEqual({
      text: "−2.0 pts",
      direction: "better",
    });
  });

  it("says a slower first token is the wrong direction, in ms then seconds", () => {
    expect(compare(metric("ttftP50Ms"), 1100, 1220)).toEqual({
      text: "+120 ms",
      direction: "worse",
    });
    expect(compare(metric("ttftP50Ms"), 1100, 2600)).toEqual({
      text: "+1.50 s",
      direction: "worse",
    });
    expect(compare(metric("ttftP50Ms"), 1100, 900)).toEqual({
      text: "−200 ms",
      direction: "better",
    });
  });

  it("says a dearer conversation is the wrong direction, in dollars", () => {
    expect(compare(metric("costPerThreadUsd"), 0.12, 0.15)).toEqual({
      text: "+$0.03",
      direction: "worse",
    });
  });

  it("treats more thumbs up as better and more thumbs down as worse", () => {
    expect(compare(metric("thumbsUp"), 4, 6)).toEqual({
      text: "+2.0 per 100 turns",
      direction: "better",
    });
    expect(compare(metric("thumbsDown"), 1, 3)).toEqual({
      text: "+2.0 per 100 turns",
      direction: "worse",
    });
  });

  it("calls a difference in a safety count 'differs', never 'worse': more can mean a sharper classifier", () => {
    expect(compare(metric("crisisReplies"), 0.4, 1.4)).toEqual({
      text: "+1.0 per 100 turns",
      direction: "differs",
    });
    expect(compare(metric("refusals"), 2, 1)).toEqual({
      text: "−1.0 per 100 turns",
      direction: "differs",
    });
    expect(compare(metric("careEntries"), 1, 3).direction).toBe("differs");
  });

  it("calls a difference that rounds to nothing 'no difference', not a signed zero", () => {
    expect(compare(metric("failureRate"), 0.03, 0.03004)).toEqual({
      text: "No difference",
      direction: "same",
    });
    expect(compare(metric("ttftP50Ms"), 1100, 1100.2)).toEqual({
      text: "No difference",
      direction: "same",
    });
    expect(compare(metric("crisisReplies"), 0.4, 0.42)).toEqual({
      text: "No difference",
      direction: "same",
    });
  });

  it("keeps the sign in the text, so direction never rests on colour alone", () => {
    expect(compare(metric("failureRate"), 0.1, 0.2).text?.startsWith("+")).toBe(true);
    expect(compare(metric("failureRate"), 0.2, 0.1).text?.startsWith("−")).toBe(true);
  });
});

describe("hasEnoughTurns", () => {
  it("needs MIN_TURNS_TO_COMPARE turns before a canary's numbers mean anything", () => {
    expect(hasEnoughTurns(arm({ turns: MIN_TURNS_TO_COMPARE - 1 }))).toBe(false);
    expect(hasEnoughTurns(arm({ turns: MIN_TURNS_TO_COMPARE }))).toBe(true);
    expect(hasEnoughTurns(undefined)).toBe(false);
  });
});

describe("pickArms", () => {
  it("finds each arm wherever it sits in the list, and tolerates a missing canary", () => {
    const ga = arm({ arm: "ga" });
    const canary = arm({ arm: "canary", turns: 30 });

    expect(pickArms([canary, ga])).toEqual({ ga, canary });
    expect(pickArms([ga])).toEqual({ ga, canary: undefined });
    expect(pickArms(undefined)).toEqual({ ga: undefined, canary: undefined });
  });
});

describe("learning measures", () => {
  it("compares quiz pass in points and items per conversation as a number, higher being better", () => {
    expect(compare(metric("quizFirstAttemptPassRate"), 0.7, 0.6)).toEqual({
      text: "−10.0 pts",
      direction: "worse",
    });
    expect(compare(metric("itemsCompletedPerThread"), 2, 2.5)).toEqual({
      text: "+0.5 items",
      direction: "better",
    });
    expect(compare(metric("quizFirstAttempts"), 40, 5)).toEqual({ text: null, direction: null });
  });
});

describe("canaryLearningGuard", () => {
  const ga = arm({ arm: "ga" });

  it("fires when engagement is up and quiz pass is lower", () => {
    const guard = canaryLearningGuard(
      ga,
      arm({ arm: "canary", turns: 100, itemsCompletedPerThread: 3, quizFirstAttemptPassRate: 0.5 }),
    );

    expect(guard?.triggered).toBe(true);
    expect(guard?.engagementUp).toContain("itemsCompletedPerThread");
    expect(guard).toMatchObject({ gaPass: 0.7, canaryPass: 0.5, canaryQuizAttempts: 40 });
  });

  it("counts a deeper conversation as engagement too", () => {
    const guard = canaryLearningGuard(
      ga,
      arm({ arm: "canary", turns: 100, threads: 10, quizFirstAttemptPassRate: 0.6 }),
    );

    expect(guard?.engagementUp).toEqual(["turnsPerThread"]);
    expect(guard?.triggered).toBe(true);
  });

  it("stays quiet when learning is not lower, or engagement is not up, or a figure is missing", () => {
    const base = { arm: "canary" as const, turns: 100 };
    expect(
      canaryLearningGuard(
        ga,
        arm({ ...base, itemsCompletedPerThread: 3, quizFirstAttemptPassRate: 0.8 }),
      )?.triggered,
    ).toBe(false);
    expect(
      canaryLearningGuard(
        ga,
        arm({ ...base, itemsCompletedPerThread: 1, threads: 250, quizFirstAttemptPassRate: 0.4 }),
      )?.triggered,
    ).toBe(false);
    expect(
      canaryLearningGuard(
        ga,
        arm({ ...base, itemsCompletedPerThread: 3, quizFirstAttemptPassRate: null }),
      )?.triggered,
    ).toBe(false);
  });

  it("says nothing while the canary has too few turns, or when an arm is missing", () => {
    expect(canaryLearningGuard(ga, arm({ arm: "canary", turns: 3 }))).toBeNull();
    expect(canaryLearningGuard(undefined, arm({ arm: "canary" }))).toBeNull();
    expect(canaryLearningGuard(ga, undefined)).toBeNull();
  });
});
