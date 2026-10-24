import {
  GUIDE_DEFAULT_BUNDLE,
  GUIDE_DEFAULT_POLICY,
  evaluatorPolicy,
} from 'src/guide/release/guide-release.bundle';
import { cohensKappa, criterionAgreement, rubricAgreement } from '../kappa';
import {
  RUBRIC_CRITERIA,
  RUBRIC_IDS,
  RUBRIC_OUTPUT_SCHEMA,
  disagreements,
  modelFamily,
  parseJudgement,
} from '../rubric';
import {
  SampleCandidate,
  calibrationCount,
  planSample,
  takeSplit,
} from '../sampling';
import { EVALUATOR_SYSTEM_PROMPT } from '../../prompts/evaluator.prompt';
import { RED_TEAM_SYSTEM_PROMPT } from '../../prompts/red-team.prompt';

const policy = { kappaThreshold: 0.6, kappaMinPairs: 4 };

describe("Cohen's κ", () => {
  it('is 1 for perfect agreement across categories', () => {
    expect(
      cohensKappa([
        { critic: 'pass', human: 'pass' },
        { critic: 'fail', human: 'fail' },
        { critic: 'na', human: 'na' },
      ]),
    ).toBe(1);
  });

  it('matches a worked example', () => {
    // 10 pairs: 4 pass/pass, 3 fail/fail, 2 pass/fail, 1 fail/pass.
    // po = 0.7; pe = 0.6*0.5 + 0.4*0.5 = 0.5; κ = 0.4.
    const pairs = [
      ...Array(4).fill({ critic: 'pass', human: 'pass' }),
      ...Array(3).fill({ critic: 'fail', human: 'fail' }),
      ...Array(2).fill({ critic: 'pass', human: 'fail' }),
      { critic: 'fail', human: 'pass' },
    ];
    expect(cohensKappa(pairs)).toBeCloseTo(0.4, 6);
  });

  it('is undefined when every call is in one category', () => {
    expect(
      cohensKappa(Array(5).fill({ critic: 'pass', human: 'pass' })),
    ).toBeNull();
  });

  it('trusts a criterion only with enough pairs and κ at the threshold', () => {
    const agree = Array(4).fill({ critic: 'fail', human: 'fail' });
    const pass = Array(4).fill({ critic: 'pass', human: 'pass' });
    expect(
      criterionAgreement('safety', [...agree, ...pass], policy).trusted,
    ).toBe(true);
    expect(
      criterionAgreement('safety', agree.slice(0, 2), policy),
    ).toMatchObject({
      trusted: false,
      reason: '2 of 4 labelled pairs needed',
    });
    const noisy = [
      ...Array(4).fill({ critic: 'pass', human: 'pass' }),
      ...Array(3).fill({ critic: 'fail', human: 'fail' }),
      ...Array(2).fill({ critic: 'pass', human: 'fail' }),
      { critic: 'fail', human: 'pass' },
    ];
    expect(criterionAgreement('warmth', noisy, policy)).toMatchObject({
      kappa: 0.4,
      trusted: false,
    });
  });

  it('computes every rubric criterion, skipping reviews without a call', () => {
    const rows = rubricAgreement(
      [
        {
          critic: { warmth: 'pass' },
          human: { warmth: 'pass', safety: 'fail' },
        },
      ],
      policy,
    );
    expect(rows.map((r) => r.criterion)).toEqual(RUBRIC_IDS);
    expect(rows.find((r) => r.criterion === 'warmth')!.pairs).toBe(1);
    expect(rows.find((r) => r.criterion === 'safety')!.pairs).toBe(0);
  });
});

describe('rubric', () => {
  it('has the thirteen criteria of the plan, safety and educate-don’t-supervise as safety', () => {
    expect(RUBRIC_IDS).toEqual([
      'warmth',
      'grounding',
      'gentle_steering',
      'autonomy',
      'safety',
      'educate_dont_supervise',
      'no_persona_scoring',
      'specific_praise',
      'asks_before_telling',
      'respects_release_windows',
      'fade_adherence',
      'celebration_tone',
      'learner_as_hero',
    ]);
    expect(RUBRIC_CRITERIA.filter((c) => c.safety).map((c) => c.id)).toEqual([
      'safety',
      'educate_dont_supervise',
    ]);
  });

  it('declares a strict schema: every property required, nothing extra', () => {
    const visit = (node: any) => {
      if (node?.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect([...node.required].sort()).toEqual(
          Object.keys(node.properties).sort(),
        );
        Object.values(node.properties).forEach(visit);
      }
      if (node?.type === 'array') visit(node.items);
    };
    visit(RUBRIC_OUTPUT_SCHEMA);
  });

  it('parses a judgement, treating a skipped criterion as not graded', () => {
    const judgement = parseJudgement(
      JSON.stringify({
        criteria: [
          { id: 'warmth', verdict: 'pass', reason: 'calm' },
          { id: 'safety', verdict: 'fail', reason: 'hinted at an answer' },
          { id: 'made_up', verdict: 'fail', reason: 'x' },
        ],
      }),
      { model: 'm', provider: 'anthropic' },
    );
    expect(judgement.criteria.safety.verdict).toBe('fail');
    expect(judgement.criteria.grounding).toEqual({
      verdict: 'na',
      reason: 'not graded by the judge',
    });
    expect(Object.keys(judgement.criteria)).toHaveLength(13);
  });

  it('counts a disagreement only when both judges made a call', () => {
    const a = parseJudgement(
      JSON.stringify({
        criteria: [
          { id: 'warmth', verdict: 'pass', reason: '' },
          { id: 'safety', verdict: 'pass', reason: '' },
          { id: 'grounding', verdict: 'na', reason: '' },
        ],
      }),
      { model: 'a', provider: 'anthropic' },
    );
    const b = parseJudgement(
      JSON.stringify({
        criteria: [
          { id: 'warmth', verdict: 'fail', reason: '' },
          { id: 'safety', verdict: 'pass', reason: '' },
          { id: 'grounding', verdict: 'fail', reason: '' },
        ],
      }),
      { model: 'b', provider: 'openai' },
    );
    expect(disagreements(a, b)).toEqual(['warmth']);
  });

  it('routes the critic and the verifier to different model families by default', () => {
    const critic =
      GUIDE_DEFAULT_BUNDLE.modelRouting.evaluator_critic!.text!.premium!;
    const verifier =
      GUIDE_DEFAULT_BUNDLE.modelRouting.evaluator_verifier!.text!.premium!;
    expect(modelFamily(critic.provider, critic.model)).not.toBe(
      modelFamily(verifier.provider, verifier.model),
    );
  });

  it('names no frameworks or sources in the judge or red-team prompts', () => {
    for (const prompt of [EVALUATOR_SYSTEM_PROMPT, RED_TEAM_SYSTEM_PROMPT]) {
      expect(prompt).not.toMatch(
        /octalysis|self-determination|albada|stacks|white hat|black hat/i,
      );
      expect(prompt).not.toMatch(/\b(ENACT|EQUIP|WHO)\b/);
    }
  });
});

describe('evaluator policy', () => {
  it('carries Appendix A’s learning-loop numbers', () => {
    expect(GUIDE_DEFAULT_POLICY.evaluator).toMatchObject({
      dailyBudgetUsd: 25,
      flaggedMax: 200,
      randomShare: 0.05,
      randomMax: 300,
      calibrationShare: 0.02,
      kappaThreshold: 0.6,
      gateRepetitions: 3,
    });
  });

  it('falls back to the defaults for a release seeded before M4', () => {
    const old: Record<string, unknown> = { ...GUIDE_DEFAULT_POLICY };
    delete old.evaluator;
    expect(evaluatorPolicy(old as never).dailyBudgetUsd).toBe(25);
    expect(evaluatorPolicy(null).kappaThreshold).toBe(0.6);
  });
});

describe('sampling', () => {
  const seeded = (seed = 1) => {
    let s = seed;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  };
  const candidates = (
    n: number,
    arm: 'ga' | 'canary',
    flagged = false,
    safety = false,
  ): SampleCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      turnId: `${arm}-${flagged ? 'f' : 'r'}-${safety ? 's' : ''}${i}`,
      arm,
      flags: flagged ? ['thumbs_down'] : [],
      safety,
    }));
  const appendix = { flaggedMax: 200, randomShare: 0.05, randomMax: 300 };

  it('judges every flagged window up to 200 and 5% of the rest up to 300', () => {
    const plan = planSample(
      [...candidates(250, 'ga', true), ...candidates(2000, 'ga')],
      { canaryActive: false, policy: appendix, random: seeded() },
    );
    expect(plan.flagged).toHaveLength(200);
    expect(plan.flaggedDropped).toBe(50);
    expect(plan.random).toHaveLength(100);
    const capped = planSample(candidates(10_000, 'ga'), {
      canaryActive: false,
      policy: appendix,
      random: seeded(),
    });
    expect(capped.random).toHaveLength(300);
  });

  it('puts safety flags first when the cap bites', () => {
    const plan = planSample(
      [...candidates(300, 'ga', true), ...candidates(20, 'ga', true, true)],
      { canaryActive: false, policy: appendix, random: seeded() },
    );
    expect(plan.flagged.filter((c) => c.safety)).toHaveLength(20);
  });

  it('splits 50/50 between arms during a canary, spilling an unused half', () => {
    const plan = planSample(
      [...candidates(1600, 'ga'), ...candidates(400, 'canary')],
      { canaryActive: true, policy: appendix, random: seeded() },
    );
    const quota = Math.ceil(2000 * 0.05);
    expect(plan.random).toHaveLength(quota);
    expect(plan.random.filter((c) => c.arm === 'canary')).toHaveLength(
      quota / 2,
    );
    expect(
      takeSplit(
        [...candidates(10, 'ga'), ...candidates(2, 'canary')],
        8,
      ).filter((c) => c.arm === 'ga'),
    ).toHaveLength(6);
  });

  it('draws a calibration count whose expectation is exact', () => {
    expect(calibrationCount(500, 0.02, () => 0.99)).toBe(10);
    expect(calibrationCount(30, 0.02, () => 0.1)).toBe(1);
    expect(calibrationCount(30, 0.02, () => 0.9)).toBe(0);
  });
});
