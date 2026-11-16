import { describe, expect, it } from "vitest";


import { MIN_LEARNER_CREDITS, resolveLearnerCreditLimit } from "../learnerCredits";

describe("resolveLearnerCreditLimit", () => {
  it("raises anything below the floor and says so", () => {
    expect(resolveLearnerCreditLimit(5)).toEqual({ limit: MIN_LEARNER_CREDITS, raised: true });
    expect(resolveLearnerCreditLimit("")).toEqual({ limit: MIN_LEARNER_CREDITS, raised: true });
  });
  it("keeps a limit at or above the floor", () => {
    expect(resolveLearnerCreditLimit(50)).toEqual({ limit: 50, raised: false });
    expect(resolveLearnerCreditLimit(20)).toEqual({ limit: 20, raised: false });
  });
});
