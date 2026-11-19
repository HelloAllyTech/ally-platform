import { describe, expect, it } from "vitest";

import { countLearnerTurns, formatTurnCounter } from "../learnerTurns";

const msgs = (roles: string) =>
  roles.split("").map(r => ({ role: r === "L" ? ("learner" as const) : ("client" as const) }));

describe("countLearnerTurns", () => {
  it("counts each learner message after the client spoke as a turn", () => {
    expect(countLearnerTurns(msgs("CLCLCL"))).toBe(3);
  });

  it("counts consecutive learner messages as one turn", () => {
    expect(countLearnerTurns(msgs("CLLLCLL"))).toBe(2);
  });

  it("counts a learner opening and ignores client-only talk", () => {
    expect(countLearnerTurns(msgs("LCC"))).toBe(1);
    expect(countLearnerTurns(msgs("CCC"))).toBe(0);
    expect(countLearnerTurns([])).toBe(0);
  });
});

describe("formatTurnCounter", () => {
  it("shows the turn the learner is on, never Turn 0", () => {
    expect(formatTurnCounter(0, 10)).toBe("Turn 1 of 10");
    expect(formatTurnCounter(4, 10)).toBe("Turn 5 of 10");
  });

  it("switches to the reached message at the minimum", () => {
    expect(formatTurnCounter(10, 10)).toBe("Minimum turns reached");
    expect(formatTurnCounter(12, 10)).toBe("Minimum turns reached");
  });

  it("uses supplied translations", () => {
    expect(formatTurnCounter(1, 3, { progress: "Tour {{turn}}/{{required}}", reached: "Ok" })).toBe(
      "Tour 2/3",
    );
  });
});
