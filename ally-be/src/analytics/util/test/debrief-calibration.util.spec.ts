import {
  DEBRIEF_AUTONOMY_KAPPA,
  autonomyGate,
  hardFailAgreement,
  scoreAgreement,
  validateDebriefRating,
} from '../debrief-calibration.util';

const pairsOf = (list: Array<[number, number]>) =>
  list.map(([a, b], i) => ({ cutId: `d${i}`, a, b }));

const fullScores = (v: number) => ({
  evidence_specificity: v,
  accuracy: v,
  actionability: v,
  prioritisation: v,
  personalisation_progress: v,
  practice_alignment: v,
  tone: v,
  clarity: v,
});

describe('scoreAgreement', () => {
  it('withholds κ below 20 rated debriefs', () => {
    const a = scoreAgreement(
      pairsOf([
        [8, 8],
        [7, 6],
      ]),
    );
    expect(a).toMatchObject({ pairs: 2, debriefs: 2, weightedKappa: null });
  });

  it('weights near misses lightly', () => {
    const spread = Array.from({ length: 24 }, (_, i) => (i % 11) as number);
    const nearMiss = scoreAgreement(
      pairsOf(spread.map((v) => [v, Math.min(10, v + 1)] as [number, number])),
    );
    const farMiss = scoreAgreement(
      pairsOf(spread.map((v) => [v, 10 - v] as [number, number])),
    );
    expect(nearMiss.weightedKappa!).toBeGreaterThan(0.8);
    expect(farMiss.weightedKappa!).toBeLessThan(0);
    expect(nearMiss.withinOnePct).toBe(100);
    expect(nearMiss.meanDifference).toBeLessThan(0);
  });
});

describe('hardFailAgreement', () => {
  it('is perfect when both raters flag the same debriefs', () => {
    const list = Array.from(
      { length: 20 },
      (_, i) => [i % 4 === 0 ? 1 : 0, i % 4 === 0 ? 1 : 0] as [number, number],
    );
    expect(hardFailAgreement(pairsOf(list)).kappa).toBe(1);
  });
});

describe('autonomyGate', () => {
  const dim = (k: number | null) => ({
    pairs: 30,
    debriefs: 30,
    weightedKappa: k,
    withinOnePct: null,
    meanDifference: null,
  });
  const fail = (k: number | null) => ({
    pairs: 30,
    debriefs: 30,
    kappa: k,
    exactAgreementPct: null,
  });

  it('passes only when every gated measure reaches 0.6', () => {
    const ok = autonomyGate(
      { accuracy: dim(0.7), evidence_specificity: dim(0.65) },
      { missed_risk_cue: fail(DEBRIEF_AUTONOMY_KAPPA) },
    );
    expect(ok.met).toBe(true);

    const low = autonomyGate(
      { accuracy: dim(0.7), evidence_specificity: dim(0.59) },
      { missed_risk_cue: fail(0.9) },
    );
    expect(low.met).toBe(false);
    expect(low.checks.find((c) => !c.passes)?.measure).toBe(
      'evidence_specificity',
    );
  });

  it('never passes on a withheld κ', () => {
    const gate = autonomyGate(
      { accuracy: dim(null), evidence_specificity: dim(0.9) },
      { missed_risk_cue: fail(0.9) },
    );
    expect(gate.met).toBe(false);
  });
});

describe('validateDebriefRating', () => {
  it('accepts a complete rating', () => {
    expect(
      validateDebriefRating({
        scores: fullScores(7),
        hardFails: ['missed_risk_cue'],
      }),
    ).toEqual([]);
  });

  it('lists every problem at once', () => {
    const scores: Record<string, unknown> = { ...fullScores(7), tone: 11 };
    delete scores.clarity;
    scores.charm = 5;
    const problems = validateDebriefRating({
      scores,
      hardFails: ['made_up'],
    });
    expect(problems).toEqual([
      'tone must be a whole number from 0 to 10',
      'clarity must be a whole number from 0 to 10',
      'charm is not a rubric dimension',
      'made_up is not a hard fail',
    ]);
  });
});
