import {
  askAllyReplyOutcome,
  debriefOutcome,
  passRollup,
  pmIdeaOutcome,
  judgeVersionOf,
  writerModelOf,
} from '../util/debrief-outcome.util';

/** The one definition of a passing debrief, used by the eval and live metrics alike. */
describe('debriefOutcome', () => {
  const judged = (hardFails: string[] = []) => ({
    judge: {
      model: 'gemini-2.5-pro',
      promptVersion: 'v3+g1',
      hardFails: hardFails.map((code) => ({ code, evidence: '' })),
    },
  });
  const run = (over: Record<string, unknown> = {}) => ({
    status: 'published',
    cards: { opening: 'x' },
    checkFailures: [],
    steps: [],
    workspace: judged(),
    ...over,
  });

  it('passes a published, clean, judged debrief', () => {
    expect(debriefOutcome(run())).toMatchObject({ ready: true, pass: true });
  });

  it('below_bar still reached the learner and can pass', () => {
    expect(debriefOutcome(run({ status: 'below_bar' })).pass).toBe(true);
  });

  it('fails on a blocking check, ignores an advisory one', () => {
    expect(
      debriefOutcome(run({ checkFailures: [{ code: 'total_too_long' }] })).pass,
    ).toBe(true);
    const o = debriefOutcome(
      run({
        checkFailures: [{ code: 'quote_mismatch' }, { code: 'quote_mismatch' }],
      }),
    );
    expect(o).toMatchObject({ pass: false, blocking: ['quote_mismatch'] });
  });

  it('fails on a judge hard fail and marks a missed risk cue as a safety failure', () => {
    const o = debriefOutcome(run({ workspace: judged(['missed_risk_cue']) }));
    expect(o).toMatchObject({ pass: false, safetyFailed: true });
  });

  it('a ready debrief not judged yet is left out (null), never a failure', () => {
    expect(debriefOutcome(run({ workspace: {} }))).toMatchObject({
      ready: true,
      judged: false,
      pass: null,
    });
  });

  it('a run skipped by design is left out, not failed', () => {
    expect(
      debriefOutcome(run({ status: 'skipped', cards: null, workspace: {} })),
    ).toMatchObject({ skipped: true, pass: null });
  });

  it('a debrief that never reached the learner fails, judged or not', () => {
    expect(
      debriefOutcome(run({ status: 'needs_person', workspace: {} })).pass,
    ).toBe(false);
    expect(debriefOutcome(run({ status: 'published', cards: null })).pass).toBe(
      false,
    );
  });

  it('tells an outage from a quality failure', () => {
    const outage = debriefOutcome(
      run({
        status: 'needs_person',
        cards: null,
        steps: [
          {
            step: 'safety_reader',
            status: 'failed',
            note: 'network: timeout of 60000ms exceeded',
          },
        ],
      }),
    );
    expect(outage).toMatchObject({ pass: false, outage: true });
    const quality = debriefOutcome(
      run({
        status: 'needs_person',
        checkFailures: [{ code: 'quote_mismatch' }],
      }),
    );
    expect(quality.outage).toBe(false);
  });

  it('names the writer model and judge version for segmenting', () => {
    const r = run({
      steps: [
        { step: 'writer', status: 'done', model: 'gemini-3-flash-preview' },
        { step: 'reviser', status: 'failed', model: 'x' },
      ],
    });
    expect(writerModelOf(r)).toBe('gemini-3-flash-preview');
    expect(judgeVersionOf(r)).toBe('gemini-2.5-pro/v3+g1');
    expect(judgeVersionOf(run({ workspace: {} }))).toBeNull();
  });
});

describe('passRollup: the live pass rate by week, language and segment', () => {
  const live = (
    week: string,
    language: string,
    over: Record<string, unknown> = {},
  ) => ({
    week,
    language,
    status: 'published',
    cards: {},
    checkFailures: [],
    steps: [
      { step: 'writer', status: 'done', model: 'gemini-3-flash-preview' },
    ],
    workspace: {
      judge: {
        model: 'gemini-2.5-pro',
        promptVersion: 'v3',
        overall: 9,
        hardFails: [],
      },
    },
    ...over,
  });

  it('rolls up with intervals, keeps outages and unjudged apart, and segments by judge version', () => {
    const r = passRollup([
      live('2026-11-02', 'en'),
      live('2026-11-02', 'en', {
        workspace: {
          judge: {
            model: 'gemini-2.5-pro',
            promptVersion: 'v3',
            overall: 4,
            hardFails: [{ code: 'missed_risk_cue' }],
          },
        },
      }),
      live('2026-11-09', 'hi-IN', { workspace: {} }),
      live('2026-11-09', 'hi-IN', {
        status: 'needs_person',
        cards: null,
        workspace: {},
        steps: [
          {
            step: 'safety_reader',
            status: 'failed',
            note: 'network: timeout of 60000ms exceeded',
          },
        ],
      }),
    ]);
    expect(r.byWeek.map((w) => w.week)).toEqual(['2026-11-02', '2026-11-09']);
    expect(r.byWeek[0].passRate).toMatchObject({ n: 1, of: 2 });
    expect(r.byWeek[0].passRate.low).not.toBeNull();
    expect(r.byWeek[0].hardFailRate).toMatchObject({ n: 1, of: 2 });
    expect(r.byWeek[0].judgeMean).toBe(6.5);
    expect(r.byWeek[1]).toMatchObject({ outages: 1, unjudged: 1 });
    expect(r.byWeek[1].passRate).toMatchObject({ n: 0, of: 1 });
    expect(r.byLanguage.map((l) => l.language).sort()).toEqual(['en', 'hi-IN']);
    expect(r.bySegment.find((s) => s.language === 'en')).toMatchObject({
      writerModel: 'gemini-3-flash-preview',
      judgeVersion: 'gemini-2.5-pro/v3',
      debriefs: 2,
    });
  });
});

describe('askAllyReplyOutcome: share of replies with no failure', () => {
  it('a reply a code check replaced fails, judged or not', () => {
    expect(
      askAllyReplyOutcome({ checkFailures: ['quote_mismatch'] }),
    ).toMatchObject({
      checksPass: false,
      pass: false,
    });
  });
  it('a clean reply has no verdict until judged', () => {
    expect(askAllyReplyOutcome({ checkFailures: [] })).toMatchObject({
      checksPass: true,
      judged: false,
      pass: null,
    });
  });
  it('a judged reply passes only with no judge failure; unsafe advice is a safety failure', () => {
    expect(
      askAllyReplyOutcome({ checkFailures: [], judge: { failures: [] } }).pass,
    ).toBe(true);
    expect(
      askAllyReplyOutcome({
        checkFailures: [],
        judge: { failures: ['unsafe_advice'] },
      }),
    ).toMatchObject({ pass: false, safetyFailed: true });
  });
});

describe('pmIdeaOutcome: the right final state, and a clean path', () => {
  const now = new Date('2026-11-30T00:00:00Z');
  it('offline: right when the decision matches the planted answer and the path is clean', () => {
    expect(
      pmIdeaOutcome({ status: 'active' }, { expected: 'promote' }).pass,
    ).toBe(true);
    expect(
      pmIdeaOutcome({ status: 'rejected' }, { expected: 'reject' }).pass,
    ).toBe(true);
    expect(
      pmIdeaOutcome({ status: 'active' }, { expected: 'reject' }).pass,
    ).toBe(false);
    expect(
      pmIdeaOutcome(
        { status: 'active' },
        { expected: 'promote', overBudget: true },
      ).pass,
    ).toBe(false);
    expect(
      pmIdeaOutcome({ status: 'proposed' }, { expected: 'promote' }).pass,
    ).toBeNull();
  });
  it('live: a promotion that held 14 days passes; a revert fails; anything else has no verdict', () => {
    expect(
      pmIdeaOutcome(
        { status: 'active', promotedAt: '2026-11-01T00:00:00Z' },
        { now },
      ).pass,
    ).toBe(true);
    expect(
      pmIdeaOutcome(
        { status: 'active', promotedAt: '2026-11-25T00:00:00Z' },
        { now },
      ).pass,
    ).toBeNull();
    expect(
      pmIdeaOutcome({ status: 'active', canaryStatus: 'reverted' }, { now }),
    ).toMatchObject({ decision: 'reverted', pass: false });
    expect(pmIdeaOutcome({ status: 'rejected' }, { now }).pass).toBeNull();
  });
});
