import {
  PmCardCategory,
  PmCardKind,
  PmDecision,
  PmLane,
} from '../enum/pm-agent.enum';
import {
  PM_BANDIT,
  PM_LANE_CATEGORIES,
  PM_SELECTABLE_LANES,
} from '../constants/pm-agent-pipeline.constants';
import { PmOutcomeRow } from '../pipeline/pm-pipeline.types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PmLearnedStat {
  /** Raw decisions counted (not decayed); weights move only from MIN_DECISIONS. */
  decisions: number;
  positive: number;
  negative: number;
  /** Posterior mean of the Beta(1 + positive, 1 + negative). */
  score: number;
}

export type PmLearnedStats = Map<string, PmLearnedStat>;

export const statKey = (dimension: 'category' | 'lane', key: string) =>
  `${dimension}:${key}`;

/**
 * Selection learning from outcomes (plan §9b loop 3). Outcome beats opinion: an accepted card
 * whose build failed or was reverted counts as a negative; a shipped one counts extra; a
 * measured +14 d impact adds +1 (improved) or −1 (worse). Each
 * decision is weighted by age (half-life), so old taste fades. Questions are not judged here.
 */
export function computeLearnedStats(
  rows: PmOutcomeRow[],
  now: Date,
): PmLearnedStats {
  const stats: PmLearnedStats = new Map();
  const add = (key: string, positive: number, negative: number) => {
    const stat = stats.get(key) ?? {
      decisions: 0,
      positive: 0,
      negative: 0,
      score: 0.5,
    };
    stat.decisions += 1;
    stat.positive += positive;
    stat.negative += negative;
    stat.score = (1 + stat.positive) / (2 + stat.positive + stat.negative);
    stats.set(key, stat);
  };
  for (const row of rows) {
    if (row.kind === PmCardKind.QUESTION) continue;
    const ageDays = Math.max(
      0,
      (now.getTime() - new Date(row.decidedAt).getTime()) / DAY_MS,
    );
    if (ageDays > PM_BANDIT.LOOKBACK_DAYS) continue;
    const w = Math.pow(0.5, ageDays / PM_BANDIT.HALF_LIFE_DAYS);
    let positive = 0;
    let negative = 0;
    switch (row.decision) {
      case PmDecision.ACCEPTED:
      case PmDecision.HANDED_OFF:
        if (row.buildFailed || row.reverted) negative = w;
        else positive = w * (row.merged || row.released ? 1.5 : 1);
        // Measured impact at +14 d (impact checks): improved +1, worse −1; flat and
        // insufficient data are 0. Outcome beats opinion: a shipped card that made its
        // metric worse nets negative.
        if (row.impactVerdict === 'improved') positive += w;
        else if (row.impactVerdict === 'worse') negative += w;
        break;
      case PmDecision.REJECTED:
        negative = w;
        break;
      case PmDecision.FEEDBACK:
        positive = 0.25 * w;
        negative = 0.75 * w;
        break;
      default:
        continue;
    }
    add(statKey('category', row.category), positive, negative);
    if (row.lane) add(statKey('lane', row.lane), positive, negative);
  }
  return stats;
}

/** Multiplier from learning: 1 until MIN_DECISIONS, then score ÷ 0.5 (neutral = 1). */
export function learnedMultiplier(stat: PmLearnedStat | undefined): number {
  if (!stat || stat.decisions < PM_BANDIT.MIN_DECISIONS) return 1;
  return stat.score / 0.5;
}

/** Mandate weight of a category; settings.categoryWeights null = all 1. */
export function mandateWeight(
  weights: Record<string, number> | null | undefined,
  category: string,
): number {
  const value = weights?.[category];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 1;
}

/** The ranker's per-category weights: mandate × learned (posterior mean, not sampled). */
export function effectiveCategoryWeights(
  weights: Record<string, number> | null | undefined,
  stats: PmLearnedStats,
): Record<string, number> {
  return Object.fromEntries(
    Object.values(PmCardCategory).map((category) => [
      category,
      mandateWeight(weights, category) *
        learnedMultiplier(stats.get(statKey('category', category))),
    ]),
  );
}

/** Normal approximation of a Beta draw — cheap, seedable, good enough for ordering lanes. */
function sampleBeta(a: number, b: number, rng: () => number): number {
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.min(0.999, Math.max(0.001, mean + sd * z));
}

export interface PmLaneChoice {
  lane: Exclude<PmLane, PmLane.REVISIONS>;
  reason: 'forced' | 'exploit' | 'explore';
  score: number;
}

/**
 * Which lanes this run uses (plan §5 "coverage-weighted rotation", §9b loop 3).
 *
 *  - Mandate: a lane's weight is the mean of its categories' weights; a lane whose categories
 *    are all weighted 0 never runs.
 *  - Minimum share: a lane missing from the last COVERAGE_WINDOW_RUNS runs is forced in, so no
 *    category falls below ~1 run in 10 however the learning goes.
 *  - Exploit: Thompson-style — a draw from each lane's Beta posterior (only once it has
 *    MIN_DECISIONS decisions; neutral before) × mandate × a coverage boost for lanes that have
 *    not run lately.
 *  - Explore: at least EXPLORATION_SHARE of the slots (≥ 1 when 2+ lanes run) are picked
 *    uniformly from the rest, so learning can't collapse onto one comfortable niche.
 */
export function selectLanes(input: {
  count: number;
  categoryWeights: Record<string, number> | null | undefined;
  stats: PmLearnedStats;
  /** Lanes of recent runs, newest first. */
  recentRuns: string[][];
  rng: () => number;
  available?: Exclude<PmLane, PmLane.REVISIONS>[];
}): PmLaneChoice[] {
  const lanes = (input.available ?? PM_SELECTABLE_LANES).filter((lane) => {
    const cats = PM_LANE_CATEGORIES[lane];
    return (
      cats.reduce(
        (sum, c) => sum + mandateWeight(input.categoryWeights, c),
        0,
      ) > 0
    );
  });
  const count = Math.min(Math.max(0, input.count), lanes.length);
  if (!count) return [];

  const laneWeight = (lane: Exclude<PmLane, PmLane.REVISIONS>) => {
    const cats = PM_LANE_CATEGORIES[lane];
    return (
      cats.reduce(
        (sum, c) => sum + mandateWeight(input.categoryWeights, c),
        0,
      ) / cats.length
    );
  };
  const runsSince = (lane: string) => {
    const index = input.recentRuns.findIndex((run) => run.includes(lane));
    return index < 0 ? input.recentRuns.length : index;
  };

  const chosen: PmLaneChoice[] = [];
  const take = (
    lane: Exclude<PmLane, PmLane.REVISIONS>,
    reason: PmLaneChoice['reason'],
    score: number,
  ) => {
    if (chosen.length < count && !chosen.some((c) => c.lane === lane)) {
      chosen.push({ lane, reason, score: Number(score.toFixed(4)) });
    }
  };

  if (input.recentRuns.length >= PM_BANDIT.COVERAGE_WINDOW_RUNS) {
    lanes
      .filter((lane) => runsSince(lane) >= PM_BANDIT.COVERAGE_WINDOW_RUNS)
      .forEach((lane) => take(lane, 'forced', laneWeight(lane)));
  }

  const exploreSlots =
    count >= 2
      ? Math.max(1, Math.ceil(count * PM_BANDIT.EXPLORATION_SHARE))
      : 0;
  const exploitSlots = Math.max(0, count - exploreSlots - chosen.length);

  const scored = lanes
    .filter((lane) => !chosen.some((c) => c.lane === lane))
    .map((lane) => {
      const stat = input.stats.get(statKey('lane', lane));
      const draw =
        stat && stat.decisions >= PM_BANDIT.MIN_DECISIONS
          ? sampleBeta(1 + stat.positive, 1 + stat.negative, input.rng) / 0.5
          : 1;
      const boost =
        1 +
        Math.min(
          PM_BANDIT.COVERAGE_BOOST_MAX,
          runsSince(lane) * PM_BANDIT.COVERAGE_BOOST_PER_RUN,
        );
      return { lane, score: laneWeight(lane) * draw * boost };
    })
    .sort((a, b) => b.score - a.score);
  scored
    .slice(0, exploitSlots)
    .forEach((s) => take(s.lane, 'exploit', s.score));

  const rest = lanes.filter((lane) => !chosen.some((c) => c.lane === lane));
  while (chosen.length < count && rest.length) {
    const index = Math.min(
      rest.length - 1,
      Math.floor(input.rng() * rest.length),
    );
    const [lane] = rest.splice(index, 1);
    take(lane, 'explore', laneWeight(lane));
  }
  return chosen;
}
