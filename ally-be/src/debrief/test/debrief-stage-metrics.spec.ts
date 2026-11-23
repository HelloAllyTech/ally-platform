import {
  agreement,
  blockingCodesInNote,
  stageMetrics,
  StageRun,
} from '../util/debrief-stage-metrics.util';

describe('agreement: kappa and recall against a reference grader', () => {
  it('matches the Evaluator-vs-judge numbers read from prod on 2026-11-11 (116 risk runs)', () => {
    const items = [
      ...Array.from({ length: 1 }, () => ({
        reference: true,
        candidate: true,
      })),
      ...Array.from({ length: 6 }, () => ({
        reference: true,
        candidate: false,
      })),
      ...Array.from({ length: 5 }, () => ({
        reference: false,
        candidate: true,
      })),
      ...Array.from({ length: 104 }, () => ({
        reference: false,
        candidate: false,
      })),
    ];
    const a = agreement(items);
    // 91% raw agreement, but barely better than chance.
    expect(a.kappa).toBeCloseTo(0.104, 2);
    expect(a.recall).toMatchObject({ n: 1, of: 7 });
    expect(a.falseFlagRate).toMatchObject({ n: 5, of: 109 });
  });

  it('a grader that always says no has high agreement and kappa 0', () => {
    const a = agreement([
      ...Array.from({ length: 9 }, () => ({
        reference: false,
        candidate: false,
      })),
      { reference: true, candidate: false },
    ]);
    expect(a.kappa).toBe(0);
    expect(a.recall).toMatchObject({ n: 0, of: 1 });
  });
});

describe('blockingCodesInNote', () => {
  it('reads the codes a checks step reported, without advisory ones', () => {
    expect(blockingCodesInNote('all passed')).toEqual([]);
    expect(
      blockingCodesInNote('quote_mismatch, quote_mismatch, total_too_long'),
    ).toEqual(['quote_mismatch']);
  });
});

describe('stageMetrics: each agent inside a run, from its step trail', () => {
  const judge = (hardFails: string[] = []) => ({
    judge: {
      model: 'gemini-2.5-pro',
      promptVersion: 'v3+g1',
      hardFails: hardFails.map((code) => ({ code })),
    },
  });
  const base = (over: Partial<StageRun> = {}): StageRun => ({
    status: 'published',
    cards: {},
    hasRiskCue: false,
    checkFailures: [],
    evaluatorHardFails: [],
    workspace: judge(),
    passages: [],
    learnerLevel: 'lay',
    steps: [
      { step: 'safety_reader', status: 'done', ms: 9000 },
      { step: 'analyst', status: 'done', ms: 40000 },
      { step: 'guidance_lookup', status: 'done' },
      { step: 'writer', status: 'done', ms: 15000 },
      { step: 'checks', status: 'done', round: 0, note: 'all passed' },
      { step: 'evaluator', status: 'done', round: 0, ms: 14000 },
    ],
    ...over,
  });

  it('measures the safety reader, guidance, writer, reviser and evaluator', () => {
    const m = stageMetrics([
      base(),
      // Safety reader failed twice: an outage, sent to a person.
      base({
        status: 'needs_person',
        cards: null,
        workspace: {},
        steps: [
          { step: 'safety_reader', status: 'failed', note: 'network: timeout' },
          { step: 'safety_reader', status: 'failed', note: 'network: timeout' },
        ],
      }),
      // First draft failed a quote; the reviser fixed it. Guidance gave a risk entry to a no-risk
      // session and a professional level guide to a lay learner.
      base({
        passages: [
          { kind: 'style_guide', clinical: true },
          { kind: 'level_guide', level: ['early_professional'] },
        ],
        steps: [
          { step: 'safety_reader', status: 'done', ms: 8000 },
          { step: 'guidance_lookup', status: 'done' },
          { step: 'writer', status: 'done', ms: 15000 },
          { step: 'checks', status: 'done', round: 0, note: 'quote_mismatch' },
          { step: 'reviser', status: 'done', round: 1, ms: 30000 },
          { step: 'checks', status: 'done', round: 1, note: 'all passed' },
        ],
      }),
      // Risk session: every cue covered, Evaluator held it alone, judge saw no miss.
      base({
        status: 'needs_person',
        skipReason: 'not_evaluated_or_risk',
        hasRiskCue: true,
        evaluatorHardFails: [{ code: 'missed_risk_cue' }],
      }),
      // Risk session: covered, Evaluator passed it, judge found a miss anyway.
      base({ hasRiskCue: true, workspace: judge(['missed_risk_cue']) }),
      base({ status: 'skipped', cards: null, workspace: {}, steps: [] }),
    ]);
    expect(m.runs).toBe(5);
    expect(m.safetyReader.failRate).toMatchObject({ n: 1, of: 5 });
    expect(m.safetyReader.retryRate).toMatchObject({ n: 1, of: 5 });
    expect(m.safetyReader.riskCueRate).toMatchObject({ n: 2, of: 4 });
    expect(m.safetyReader.judgeMissDespiteCoverage).toMatchObject({
      n: 1,
      of: 1,
    });
    expect(m.guidanceLookup.clinicalOnNoRiskRate).toMatchObject({
      n: 1,
      of: 2,
    });
    expect(m.guidanceLookup.wrongLevelRate).toMatchObject({ n: 1, of: 1 });
    expect(m.writer.firstDraftPassRate).toMatchObject({ n: 3, of: 4 });
    expect(m.writer.firstDraftFailures).toEqual([
      { code: 'quote_mismatch', runs: 1 },
    ]);
    expect(m.reviser.fixRate).toMatchObject({ n: 1, of: 1 });
    expect(m.reviser.regressionRate).toMatchObject({ n: 0, of: 1 });
    expect(m.evaluator.missedRiskCue).toMatchObject({
      referenceOnly: 1,
      candidateOnly: 0,
    });
    expect(m.evaluator.heldOnItsOwnRate).toMatchObject({ n: 1, of: 3 });
    expect(m.judge.versions).toEqual(['gemini-2.5-pro/v3+g1']);
  });
});
