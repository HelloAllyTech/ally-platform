import { DebriefAgreementMeasure as M } from '../enum/debrief-review.enum';
import {
  AGREEMENT_MEASURES,
  AgreementPair,
  agreementGate,
  judgeFinding,
  measureAgreement,
  pickAgreementSample,
  prefillAnswers,
  resolveAnswers,
} from '../util/debrief-agreement.util';
import { DebriefAgreementService } from '../service/debrief-agreement.service';
import { DebriefAutonomyService } from '../service/debrief-autonomy.service';
import { kindEligibility } from '../util/debrief-console-view.util';
import { DEBRIEF_SCHEDULE_JOBS } from '../constants/debrief-schedule.constants';

const comment = (o: Partial<Record<string, unknown>>) => ({
  id: 'c',
  tag: null,
  anchorKind: 'transcript',
  turnIndex: null,
  section: null,
  ...o,
});

describe('debrief agreement: the measures', () => {
  it('one question per measure the judge emits: accuracy, evidence (with specificity), missed risk cue', () => {
    expect(AGREEMENT_MEASURES).toEqual([
      'accuracy',
      'evidence_specificity',
      'missed_risk_cue',
    ]);
  });

  it("reads the judge's finding as yes/no", () => {
    const judge = (
      accuracy: number,
      evidence: number,
      fails: string[] = [],
    ) => ({
      dimensions: [
        { dimension: 'accuracy', score: accuracy },
        { dimension: 'evidence_specificity', score: evidence },
      ],
      hardFails: fails.map((code) => ({ code })),
    });
    expect(judgeFinding(judge(8, 7), M.ACCURACY)).toBe(true);
    expect(judgeFinding(judge(7, 7), M.ACCURACY)).toBe(false);
    // A fabricated quote makes it inaccurate whatever the score.
    expect(judgeFinding(judge(9, 9, ['fabricated_quote']), M.ACCURACY)).toBe(
      false,
    );
    expect(judgeFinding(judge(9, 8), M.EVIDENCE)).toBe(true);
    expect(judgeFinding(judge(9, 5), M.EVIDENCE)).toBe(false);
    expect(judgeFinding(judge(9, 9), M.MISSED_RISK_CUE)).toBe(true);
    expect(
      judgeFinding(judge(9, 9, ['missed_risk_cue']), M.MISSED_RISK_CUE),
    ).toBe(false);
    // No reading: the debrief does not count for that measure.
    expect(judgeFinding({ hardFails: [] }, M.ACCURACY)).toBeNull();
    expect(judgeFinding(null, M.MISSED_RISK_CUE)).toBeNull();
  });
});

describe('debrief agreement: the pre-fill from comment tags', () => {
  const byMeasure = (r: ReturnType<typeof prefillAnswers>) =>
    Object.fromEntries(r.map((a) => [a.measure, a.answer]));

  it('starts every answer at Yes with no relevant tag', () => {
    const r = prefillAnswers({
      comments: [
        comment({ tag: 'tone' }),
        comment({ tag: 'good_keep_this' }),
        comment({}),
      ],
      hardFails: [],
      riskCueTurns: [4],
    });
    expect(byMeasure(r)).toEqual({
      accuracy: true,
      evidence_specificity: true,
      missed_risk_cue: true,
    });
    expect(r.every((a) => a.source === null)).toBe(true);
  });

  it('a comment tagged wrong or unsupported pre-fills Accuracy = No, citing the comment', () => {
    const r = prefillAnswers({
      comments: [
        comment({
          id: 'late',
          tag: 'wrong_or_unsupported',
          turnIndex: 20,
          createdAt: '2026-11-12T10:05:00Z',
        }),
        comment({
          id: 'early',
          tag: 'wrong_or_unsupported',
          turnIndex: 12,
          createdAt: '2026-11-12T10:00:00Z',
        }),
      ],
      hardFails: [],
      riskCueTurns: [],
    });
    expect(byMeasure(r).accuracy).toBe(false);
    expect(r[0].source).toEqual({
      kind: 'comment',
      commentId: 'early',
      anchorKind: 'transcript',
      turnIndex: 12,
      section: null,
    });
  });

  it('a comment tagged too vague pre-fills Evidence = No, and nothing else', () => {
    const r = prefillAnswers({
      comments: [comment({ id: 'vague', tag: 'too_vague', turnIndex: 5 })],
      hardFails: [],
      riskCueTurns: [5],
    });
    expect(byMeasure(r)).toEqual({
      accuracy: true,
      evidence_specificity: false,
      missed_risk_cue: true,
    });
    expect(r.find((a) => a.measure === M.EVIDENCE)?.source).toMatchObject({
      kind: 'comment',
      commentId: 'vague',
    });
  });

  it('a missed moment on a risk-cue turn pre-fills Missed risk cue = No; elsewhere it does not', () => {
    const on = prefillAnswers({
      comments: [comment({ tag: 'missed_moment', turnIndex: 7 })],
      hardFails: [],
      riskCueTurns: [7],
    });
    expect(byMeasure(on).missed_risk_cue).toBe(false);
    const off = prefillAnswers({
      comments: [comment({ tag: 'missed_moment', turnIndex: 3 })],
      hardFails: [],
      riskCueTurns: [7],
    });
    expect(byMeasure(off).missed_risk_cue).toBe(true);
  });

  it('a ticked hard fail pre-fills too, when no comment says why', () => {
    const r = prefillAnswers({
      comments: [],
      hardFails: ['missed_risk_cue', 'fabricated_quote'],
      riskCueTurns: [],
    });
    expect(byMeasure(r)).toEqual({
      accuracy: false,
      evidence_specificity: true,
      missed_risk_cue: false,
    });
    expect(r[0].source).toEqual({
      kind: 'hard_fail',
      code: 'fabricated_quote',
    });
  });

  it('records whether the reviewer changed a pre-filled answer', () => {
    const pre = prefillAnswers({
      comments: [comment({ tag: 'wrong_or_unsupported' })],
      hardFails: [],
      riskCueTurns: [],
    });
    const out = resolveAnswers(pre, { accuracy: true });
    expect(
      out.map((a) => [a.measure, a.answer, a.prefilled, a.changed]),
    ).toEqual([
      ['accuracy', true, false, true],
      ['evidence_specificity', true, true, false],
      ['missed_risk_cue', true, true, false],
    ]);
  });
});

describe('debrief agreement: κ', () => {
  const pairs = (rows: Array<[boolean, boolean, number]>): AgreementPair[] => {
    const out: AgreementPair[] = [];
    let i = 0;
    for (const [advisor, judge, count] of rows) {
      for (let k = 0; k < count; k += 1)
        out.push({ runId: `r${i++}`, advisor, judge });
    }
    return out;
  };

  it('below 50 reviews: not measured yet, n of 50, and never passes', () => {
    const m = measureAgreement(
      M.ACCURACY,
      pairs([
        [true, true, 40],
        [false, false, 9],
      ]),
    );
    expect(m).toMatchObject({
      n: 49,
      kappa: null,
      state: 'not_enough',
      passes: false,
    });
    // Recall on the advisor's No is shown from the first review.
    expect(m.recallOnNo).toEqual({ caught: 9, of: 9, pct: 100 });
  });

  it('all Yes on both sides: κ is undefined, and does not pass', () => {
    const m = measureAgreement(M.EVIDENCE, pairs([[true, true, 60]]));
    expect(m).toMatchObject({
      n: 60,
      kappa: null,
      state: 'undefined',
      passes: false,
    });
    expect(m.recallOnNo).toEqual({ caught: 0, of: 0, pct: null });
  });

  it("computes Cohen's κ and recall on the advisor's No", () => {
    // 40 both yes, 5 both no, 3 advisor no / judge yes, 2 advisor yes / judge no.
    const m = measureAgreement(
      M.MISSED_RISK_CUE,
      pairs([
        [true, true, 40],
        [false, false, 5],
        [false, true, 3],
        [true, false, 2],
      ]),
    );
    // po = 0.9; pe = 0.84*0.86 + 0.16*0.14 = 0.7448; κ = 0.155/0.2552.
    expect(m.kappa).toBeCloseTo(0.608, 3);
    expect(m).toMatchObject({
      n: 50,
      state: 'met',
      passes: true,
      agreementPct: 90,
    });
    expect(m.recallOnNo).toEqual({ caught: 5, of: 8, pct: 62.5 });
    const low = measureAgreement(
      M.ACCURACY,
      pairs([
        [true, true, 40],
        [false, false, 2],
        [false, true, 6],
        [true, false, 2],
      ]),
    );
    expect(low.state).toBe('below');
    expect(low.passes).toBe(false);
  });

  it('one pair per debrief: the latest answer the caller passes wins', () => {
    const m = measureAgreement(M.ACCURACY, [
      { runId: 'a', advisor: true, judge: true },
      { runId: 'a', advisor: false, judge: true },
    ]);
    expect(m.n).toBe(1);
    expect(m.recallOnNo.of).toBe(1);
  });

  it('the gate needs every measure met', () => {
    const met = measureAgreement(
      M.ACCURACY,
      pairs([
        [true, true, 40],
        [false, false, 10],
      ]),
    );
    const short = measureAgreement(M.EVIDENCE, pairs([[true, true, 12]]));
    expect(agreementGate([met]).met).toBe(true);
    expect(agreementGate([met, short])).toEqual({
      met: false,
      failing: [{ measure: 'evidence_specificity', kappa: null, n: 12 }],
    });
    expect(agreementGate([]).met).toBe(false);
  });
});

describe('debrief agreement: the weekly random sample', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `run-${i}`);

  it('picks the sample size at random, without repeats', () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const picked = pickAgreementSample(ids, { size: 5, random });
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    expect(picked.every((p) => ids.includes(p))).toBe(true);
    // Not simply the first five.
    expect(picked).not.toEqual(ids.slice(0, 5));
  });

  it('tops up only to the backlog, and copes with too few candidates', () => {
    expect(
      pickAgreementSample(ids, { size: 5, waiting: 8, backlog: 10 }),
    ).toHaveLength(2);
    expect(
      pickAgreementSample(ids, { size: 5, waiting: 10, backlog: 10 }),
    ).toHaveLength(0);
    expect(pickAgreementSample(ids.slice(0, 3), { size: 5 })).toHaveLength(3);
  });

  it('the job: inserts the picked runs, looking only at unreviewed, unsampled judged debriefs outside test organisations', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('count(*)::int AS n')) return [{ n: 0 }];
      if (sql.includes('SELECT r.id, r.tenant_id')) {
        return ids.slice(0, 8).map((id) => ({ id, tenant_id: 't1' }));
      }
      return [];
    });
    const svc = new DebriefAgreementService({ query } as any);
    const added = await svc.sampleNow(() => 0);
    expect(added).toBe(5);
    const select = query.mock.calls.find(([s]) =>
      String(s).includes('SELECT r.id, r.tenant_id'),
    )![0] as string;
    expect(select).toContain(`r.workspace->'judge'->>'overall' IS NOT NULL`);
    expect(select).toContain('NOT EXISTS (SELECT 1 FROM debrief_reviews v');
    expect(select).toContain(
      'NOT EXISTS (SELECT 1 FROM debrief_agreement_samples s',
    );
    expect(select).toContain('isTestOrganization');
    const inserts = query.mock.calls.filter(([s]) =>
      String(s).includes('INSERT INTO debrief_agreement_samples'),
    );
    expect(inserts).toHaveLength(5);
  });

  it('is a Settings › Schedules job: weekly on Monday India time, no model spend', () => {
    const job = DEBRIEF_SCHEDULE_JOBS.find(
      (j) => j.key === 'debrief-agreement-sample',
    )!;
    expect(job.defaults).toMatchObject({
      frequency: 'weekly',
      weekday: 1,
      time: '07:30',
      enabled: true,
    });
    expect(job.learningBudget).toBe(false);
    expect(job.locked).toBe(false);
  });

  it('κ reads the latest verdict per debrief that carries answers', async () => {
    const judge = {
      dimensions: [
        { dimension: 'accuracy', score: 9 },
        { dimension: 'evidence_specificity', score: 4 },
      ],
      hardFails: [],
    };
    const query = jest.fn(async () => [
      { runId: 'a', measure: 'accuracy', answer: false, judge },
      { runId: 'a', measure: 'evidence_specificity', answer: false, judge },
      { runId: 'a', measure: 'missed_risk_cue', answer: true, judge },
    ]);
    const svc = new DebriefAgreementService({ query } as any);
    const pairs = await svc.pairs();
    expect(pairs.accuracy).toEqual([
      { runId: 'a', advisor: false, judge: true },
    ]);
    expect(pairs.evidence_specificity).toEqual([
      { runId: 'a', advisor: false, judge: false },
    ]);
    const sql = (query.mock.calls[0] as unknown as [string])[0];
    expect(sql).toContain('DISTINCT ON (v."runId")');
    expect(sql).toContain('ORDER BY v."runId", v."updatedAt" DESC');
  });
});

describe('debrief agreement: canary eligibility reads it', () => {
  const build = (gate: { met: boolean; failing: unknown[] }) => {
    const agreement = { gate: jest.fn(async () => gate), view: jest.fn() };
    const service = new DebriefAutonomyService(
      { query: jest.fn(async () => []) } as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn(() => agreement) } as any,
    );
    return { service, agreement };
  };

  it("the autonomy facts' κ gate comes from the advisor's answers", async () => {
    const { service, agreement } = build({
      met: false,
      failing: [{ measure: 'accuracy', kappa: null, n: 37 }],
    });
    const f = await service.facts();
    expect(agreement.gate).toHaveBeenCalled();
    expect(f.gate.met).toBe(false);
    expect(kindEligibility('prompts', f, 'canary')).toMatchObject({
      eligible: false,
      reason:
        'Not yet: agreement below 0.6 (Accuracy not measured yet: 37 of 50 reviews).',
    });
    // Steps learners never see stay free of the gate.
    expect(kindEligibility('prompts', f, 'paired_trial').eligible).toBe(true);
  });

  it('met on every measure opens the canary', async () => {
    const { service } = build({ met: true, failing: [] });
    const f = await service.facts();
    expect(kindEligibility('settings', f, 'canary').eligible).toBe(true);
  });

  it('an undefined κ at 50+ reviews reads in words', async () => {
    const { service } = build({
      met: false,
      failing: [{ measure: 'evidence_specificity', kappa: null, n: 60 }],
    });
    expect(kindEligibility('prompts', await service.facts()).reason).toBe(
      'Not yet: agreement below 0.6 (Evidence not measurable yet: every answer is the same).',
    );
  });
});
