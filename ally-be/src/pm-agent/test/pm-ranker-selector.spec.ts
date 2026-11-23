import 'reflect-metadata';
import {
  PmCardCategory,
  PmCardKind,
  PmDecision,
  PmLane,
} from '../enum/pm-agent.enum';
import { rankCandidates } from '../gate/pm-ranker';
import {
  computeLearnedStats,
  effectiveCategoryWeights,
  selectLanes,
  statKey,
} from '../learning/pm-lane-selector';
import { pickExemplars, topMemory } from '../learning/pm-context';
import {
  PmCandidate,
  PmEvidenceRef,
  PmOutcomeRow,
} from '../pipeline/pm-pipeline.types';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { questionFor, recFor } from './pm-pipeline.fakes';

const NOW = new Date('2026-11-17T04:00:00.000Z');
const E = '0b7e7c1e-2f7a-4a43-9a6b-2a6d1f1c0001';
const evidence = new Map<string, PmEvidenceRef>([
  [
    E,
    {
      id: E,
      source: 'analytics',
      kind: 'chart',
      label: 'a',
      fetchedAt: NOW,
      excerpt: '',
    },
  ],
]);

const seeded = (seed = 7) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const rec = (i: number, category: PmCardCategory): PmCandidate => ({
  lane: PmLane.ANALYTICS,
  kind: PmCardKind.RECOMMENDATION,
  category,
  payload: { schemaVersion: 1, ...recFor(i, [E]) },
});

describe('ranker', () => {
  it('enforces category diversity: no category takes more than 60% of the slots', () => {
    const candidates = [0, 1, 2, 3, 4].map((i) => rec(i, PmCardCategory.UI_UX));
    candidates.push(rec(5, PmCardCategory.COST));
    const ranked = rankCandidates({
      candidates,
      runEvidence: evidence,
      categoryWeights: { ui_ux: 3, cost: 0.2 },
      slots: 4,
      maxQuestions: 4,
      now: NOW,
    });
    expect(
      ranked.filter((c) => c.category === PmCardCategory.UI_UX),
    ).toHaveLength(3);
    expect(ranked.some((c) => c.category === PmCardCategory.COST)).toBe(true);
    expect(ranked.length).toBeLessThanOrEqual(4);
  });

  it('prefers small over medium at equal evidence (impact × evidence ÷ effort)', () => {
    const small = rec(0, PmCardCategory.PRODUCT);
    const medium = rec(1, PmCardCategory.UI_UX);
    medium.payload.size = 'M';
    const [first] = rankCandidates({
      candidates: [medium, small],
      runEvidence: evidence,
      categoryWeights: {},
      slots: 2,
      maxQuestions: 2,
      now: NOW,
    });
    expect(first.payload.title).toBe(small.payload.title);
  });

  it('caps questions', () => {
    const questions: PmCandidate[] = ['a', 'b', 'c'].map((key) => ({
      lane: PmLane.STRATEGY_CONTENT,
      kind: PmCardKind.QUESTION,
      category: PmCardCategory.STRATEGY_CONTENT,
      questionKey: key,
      payload: { schemaVersion: 1, ...questionFor(key) },
    }));
    const ranked = rankCandidates({
      candidates: [...questions, rec(0, PmCardCategory.PRODUCT)],
      runEvidence: evidence,
      categoryWeights: {},
      slots: 3,
      maxQuestions: 1,
      now: NOW,
    });
    expect(ranked.filter((c) => c.kind === PmCardKind.QUESTION)).toHaveLength(
      1,
    );
  });
});

const outcome = (over: Partial<PmOutcomeRow>): PmOutcomeRow => ({
  cardId: 'c',
  category: 'cost',
  lane: 'infra_cost',
  kind: 'recommendation',
  decision: PmDecision.ACCEPTED,
  decidedAt: NOW,
  merged: false,
  released: false,
  buildFailed: false,
  reverted: false,
  title: 'Move summaries to the fast tier',
  payload: { whyHeadline: 'Summaries cost $212 last month' },
  reason: null,
  reasonChip: null,
  ...over,
});

describe('learned stats', () => {
  it('outcome beats opinion: an accepted card that was reverted is a negative', () => {
    const stats = computeLearnedStats(
      [outcome({ reverted: true }), outcome({ released: true })],
      NOW,
    );
    const stat = stats.get(statKey('category', 'cost'))!;
    expect(stat.decisions).toBe(2);
    expect(stat.negative).toBeCloseTo(1);
    expect(stat.positive).toBeCloseTo(1.5);
  });

  it('decays old decisions', () => {
    const fresh = computeLearnedStats(
      [outcome({ decision: PmDecision.REJECTED })],
      NOW,
    );
    const old = computeLearnedStats(
      [
        outcome({
          decision: PmDecision.REJECTED,
          decidedAt: new Date(NOW.getTime() - 60 * 864e5),
        }),
      ],
      NOW,
    );
    expect(old.get(statKey('lane', 'infra_cost'))!.negative).toBeCloseTo(0.25);
    expect(fresh.get(statKey('lane', 'infra_cost'))!.negative).toBeCloseTo(1);
  });

  it('weights do not move before 8 decisions', () => {
    const seven = Array.from({ length: 7 }, () =>
      outcome({ decision: PmDecision.REJECTED }),
    );
    expect(
      effectiveCategoryWeights(null, computeLearnedStats(seven, NOW)).cost,
    ).toBe(1);
    const eight = [...seven, outcome({ decision: PmDecision.REJECTED })];
    expect(
      effectiveCategoryWeights(null, computeLearnedStats(eight, NOW)).cost,
    ).toBeLessThan(1);
  });
});

describe('lane selection (bandit with floors)', () => {
  it('always keeps at least one exploration slot when 2+ lanes run', () => {
    for (let seed = 1; seed < 30; seed += 1) {
      const chosen = selectLanes({
        count: 4,
        categoryWeights: null,
        stats: new Map(),
        recentRuns: [],
        rng: seeded(seed),
      });
      expect(chosen).toHaveLength(4);
      expect(
        chosen.filter((c) => c.reason === 'explore').length,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('a lane whose categories are weighted 0 never runs', () => {
    const chosen = selectLanes({
      count: 5,
      categoryWeights: { cost: 0, infra: 0 },
      stats: new Map(),
      recentRuns: [],
      rng: seeded(),
    });
    expect(chosen.map((c) => c.lane)).not.toContain(PmLane.INFRA_COST);
  });

  it('forces in a lane missing from the last 10 runs (minimum share)', () => {
    const recentRuns = Array.from({ length: 10 }, () => [
      PmLane.ANALYTICS,
      PmLane.CODE_HEALTH,
    ]);
    const stats = computeLearnedStats(
      Array.from({ length: 20 }, () =>
        outcome({
          decision: PmDecision.REJECTED,
          category: 'strategy_content',
          lane: 'strategy_content',
        }),
      ),
      NOW,
    );
    const chosen = selectLanes({
      count: 2,
      categoryWeights: null,
      stats,
      recentRuns,
      rng: seeded(),
    });
    expect(
      chosen.filter((c) => c.reason === 'forced').map((c) => c.lane),
    ).toEqual(expect.arrayContaining([PmLane.UX_SIGNALS]));
  });

  it('learning moves a well-received lane up once it has enough decisions', () => {
    const good = Array.from({ length: 12 }, () =>
      outcome({ lane: 'code_health', category: 'code_health', released: true }),
    );
    let first = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const [top] = selectLanes({
        count: 2,
        categoryWeights: null,
        stats: computeLearnedStats(good, NOW),
        recentRuns: [
          [
            PmLane.CODE_HEALTH,
            PmLane.ANALYTICS,
            PmLane.INFRA_COST,
            PmLane.UX_SIGNALS,
            PmLane.STRATEGY_CONTENT,
          ],
        ],
        rng: seeded(seed),
      });
      if (top.lane === PmLane.CODE_HEALTH) first += 1;
    }
    expect(first).toBeGreaterThan(30);
  });
});

describe('context retrieval', () => {
  const fact = (
    key: string,
    value: string,
    over: Partial<PmAgentMemory> = {},
  ) =>
    ({
      id: key,
      kind: 'fact',
      key,
      value,
      active: true,
      source: 'answer',
      ...over,
    }) as PmAgentMemory;

  it('memory: top-k by relevance, inactive and expired facts excluded', () => {
    const facts = [
      fact('cost', 'Model spend matters more than latency this quarter'),
      fact('streak', 'Streaks are a learner retention lever'),
      fact('old', 'Model spend is irrelevant', {
        expiresAt: new Date('2020-01-01'),
      }),
      fact('off', 'Model spend cost tokens', { active: false }),
    ];
    const top = topMemory(facts, 'cost model spend tokens', NOW, 2);
    expect(top.map((f) => f.key)).toEqual(['cost', 'streak']);
  });

  it('exemplars: nearest shipped positives and rejected negatives', () => {
    const rows = [
      outcome({ title: 'Cache model prompts for summaries', released: true }),
      outcome({
        title: 'Redesign the whole admin console',
        decision: PmDecision.REJECTED,
        reason: 'too big',
      }),
      outcome({
        title: 'Accepted but never built',
        merged: false,
        released: false,
      }),
    ];
    const picked = pickExemplars(rows, 'cost model cache prompts');
    expect(picked.positives.map((r) => r.title)).toEqual([
      'Cache model prompts for summaries',
    ]);
    expect(picked.negatives.map((r) => r.title)).toEqual([
      'Redesign the whole admin console',
    ]);
  });
});
