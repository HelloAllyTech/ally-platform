import { describe, expect, it } from "vitest";

import { RoadmapOpportunity, RoadmapRankWeights } from "@types";

import { explainRank } from "../utils/rankExplain";

const weights: RoadmapRankWeights = {
  votesWeight: 40,
  votersWeight: 20,
  effortWeight: 20,
  goalImpactWeight: 20,
  starWeight: 0,
};

const opp = (over: Partial<RoadmapOpportunity> = {}) =>
  ({
    priorityScore: 50,
    voterCount: 4,
    effort: "m",
    goalsHelped: 1,
    goalsTotal: 2,
    directorStarred: false,
    compositeScore: 0,
    ...over,
  }) as RoadmapOpportunity;

describe("explainRank", () => {
  it("recomputes votes, effort and goals like the SQL and backs backers out of the score", () => {
    // votes 50/100 → 50 × 40% = 20 ; effort M = 75 × 20% = 15 ; goals 1/2 = 50 × 20% = 10.
    // Backers is whatever is left of the server's own score: 60 − 45 = 15.
    const e = explainRank(opp({ compositeScore: 60 }), weights, 100);
    const by = Object.fromEntries(e.rows.map(r => [r.key, r.contribution]));
    expect(by).toEqual({ votes: 20, voters: 15, effort: 15, goals: 10 });
    expect(e.rows.map(r => r.sharePct)).toEqual([40, 20, 20, 20]);
  });

  it("counts an unsized idea as 50 on effort and says so", () => {
    const e = explainRank(opp({ effort: null, compositeScore: 40 }), weights, 100);
    expect(e.unsized).toBe(true);
    expect(e.rows.find(r => r.key === "effort")?.value).toBe(50);
    expect(e.rows.find(r => r.key === "effort")?.input).toBe("Not sized");
  });

  it("flags an idea nobody voted on", () => {
    const e = explainRank(opp({ priorityScore: 0, voterCount: 0 }), weights, 100);
    expect(e.noVotes).toBe(true);
  });

  it("shows inputs but no computed value for votes and backers without a base", () => {
    const e = explainRank(opp({ compositeScore: 60 }), weights, undefined);
    expect(e.rows.find(r => r.key === "votes")?.contribution).toBeNull();
    expect(e.rows.find(r => r.key === "voters")?.contribution).toBeNull();
    expect(e.rows.find(r => r.key === "effort")?.contribution).toBe(15);
  });

  it("only lists the director star while it carries weight", () => {
    expect(explainRank(opp(), weights, 100).rows.some(r => r.key === "star")).toBe(false);
    const starred = explainRank(
      opp({ directorStarred: true }),
      { ...weights, starWeight: 20 },
      100,
    );
    expect(starred.rows.find(r => r.key === "star")?.contribution).toBe(
      Math.round((20 / 120) * 100 * 10) / 10,
    );
  });
});
