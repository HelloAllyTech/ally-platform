import { RoadmapOpportunity, RoadmapRankWeights } from "@types";

/** Effort → 0-100, cheaper scores higher. Mirrors EFFORT_SCORE_SQL in ally-be; unsized is 50. */
const EFFORT_VALUE: Record<string, number> = { s: 100, m: 75, l: 50, xl: 25, xxl: 0 };
export const UNSIZED_EFFORT_VALUE = 50;

export type RankFactorKey = "votes" | "voters" | "effort" | "goals" | "star";

export interface RankFactorRow {
  key: RankFactorKey;
  label: string;
  /** What was measured, in words: "12 votes", "L", "1 of 2 goals". */
  input: string;
  weight: number;
  /** This factor's weight as a share of the total, 0-100. */
  sharePct: number;
  /** The factor normalised to 0-100, or null when it cannot be worked out on the client. */
  value: number | null;
  /** Points of the 0-100 score this factor adds (weight share × value), or null with `value`. */
  contribution: number | null;
}

export interface RankExplanation {
  rows: RankFactorRow[];
  /** The score as the server computed it — the rows add up to this, within rounding. */
  score: number;
  /** Effort was never set, so the effort factor sits at the neutral 50. */
  unsized: boolean;
  /** Nobody has voted: the score is carried by effort and goal coverage alone. */
  noVotes: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Why an opportunity ranks where it does: each factor's input, weight and share of the score.
 *
 * The server never sends the per-factor values, and the backers factor is normalised against the
 * board's largest backer count, which the client is not given. So four factors are recomputed here
 * from what the row carries — the same arithmetic as COMPOSITE_SCORE_SQL — and backers is the
 * REMAINDER: whatever the server's own score has left once the others are taken out. That keeps
 * the rows honest against the number on screen without a second endpoint. It needs `maxScore`
 * (the vote total's base); without it votes and backers show their inputs and weights but no
 * computed value rather than guessing.
 */
export const explainRank = (
  opportunity: RoadmapOpportunity,
  weights: RoadmapRankWeights,
  maxScore: number | undefined,
): RankExplanation => {
  const w = {
    votes: weights.votesWeight,
    voters: weights.votersWeight,
    effort: weights.effortWeight,
    goals: weights.goalImpactWeight,
    star: weights.starWeight ?? 0,
  };
  const total = w.votes + w.voters + w.effort + w.goals + w.star || 1;
  const share = (x: number) => round1((x / total) * 100);

  const effortValue = opportunity.effort
    ? (EFFORT_VALUE[opportunity.effort] ?? UNSIZED_EFFORT_VALUE)
    : UNSIZED_EFFORT_VALUE;
  const goalsValue =
    opportunity.goalsTotal > 0 ? (opportunity.goalsHelped / opportunity.goalsTotal) * 100 : 0;
  const starValue = opportunity.directorStarred ? 100 : 0;
  const votesValue =
    maxScore && maxScore > 0 ? Math.min((opportunity.priorityScore / maxScore) * 100, 100) : null;

  const contrib = (weight: number, value: number) => round1((weight * value) / total);
  const known =
    (votesValue === null ? 0 : (w.votes * votesValue) / total) +
    (w.effort * effortValue) / total +
    (w.goals * goalsValue) / total +
    (w.star * starValue) / total;
  // Backers = remainder. Clamped, because the server rounds the score to one decimal.
  const votersContribution =
    votesValue === null || w.voters === 0
      ? null
      : Math.max(0, round1(opportunity.compositeScore - known));
  const votersValue =
    votersContribution === null
      ? null
      : Math.min(100, round1((votersContribution * total) / w.voters));

  const rows: RankFactorRow[] = [
    {
      key: "votes",
      label: "Votes",
      input: `${opportunity.priorityScore}`,
      weight: w.votes,
      sharePct: share(w.votes),
      value: votesValue === null ? null : round1(votesValue),
      contribution: votesValue === null ? null : contrib(w.votes, votesValue),
    },
    {
      key: "voters",
      label: "Backers",
      input: `${opportunity.voterCount}`,
      weight: w.voters,
      sharePct: share(w.voters),
      value: votersValue,
      contribution: votersContribution,
    },
    {
      key: "effort",
      label: "Effort",
      input: opportunity.effort ? opportunity.effort.toUpperCase() : "Not sized",
      weight: w.effort,
      sharePct: share(w.effort),
      value: effortValue,
      contribution: contrib(w.effort, effortValue),
    },
    {
      key: "goals",
      label: "Strategy goals",
      input:
        opportunity.goalsTotal > 0
          ? `${opportunity.goalsHelped} of ${opportunity.goalsTotal}`
          : "No strategy set",
      weight: w.goals,
      sharePct: share(w.goals),
      value: round1(goalsValue),
      contribution: contrib(w.goals, goalsValue),
    },
  ];
  // The Prod Director's star is a factor only while it has weight; a zero-weight row is noise.
  if (w.star > 0) {
    rows.push({
      key: "star",
      label: "Director star",
      input: opportunity.directorStarred ? "Starred" : "Not starred",
      weight: w.star,
      sharePct: share(w.star),
      value: starValue,
      contribution: contrib(w.star, starValue),
    });
  }
  return {
    rows,
    score: opportunity.compositeScore,
    unsized: !opportunity.effort,
    noVotes: opportunity.priorityScore === 0 && opportunity.voterCount === 0,
  };
};
