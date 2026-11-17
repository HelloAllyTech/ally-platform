import {
  DebriefRiskCueOptionService,
  STANDARD_RISK_CUE,
  toResolved,
  validateRiskCueInput,
} from '../service/debrief-risk-cue-option.service';
import { DebriefRiskCueOption } from '../entity/debrief-risk-cue-option.entity';
import { runDebriefChecks } from '../util/debrief-cards.util';
import { toScoredRun } from '../service/debrief-score.service';
import { expectationsFor } from '../service/debrief-run-judge.service';
import { DebriefGatewayService } from '../service/debrief-gateway.service';

const GOOD = {
  name: 'End-of-life conversation',
  wording:
    'Talk of dying is expected here and is not a risk cue by itself. A plan, a means, or asking for help to end life now is.',
  handling: 'alarm' as const,
  wordListRaises: false,
  supportLinesOnCue: false,
  examples: {
    cues: ['I have the pills and I want it over tonight'],
    nonCues: ['I would like to die peacefully at home'],
  },
};

function build(seed: Partial<DebriefRiskCueOption>[] = []) {
  const rows: DebriefRiskCueOption[] = seed.map(
    (r, i) =>
      ({
        id: `id-${i}`,
        key: `k${i}`,
        name: `N${i}`,
        status: 'approved',
        version: 1,
        handling: 'alarm',
        wordListRaises: true,
        supportLinesOnCue: true,
        examples: { cues: [], nonCues: [] },
        history: [],
        createdBy: 1,
        wording: null,
        ...r,
      }) as DebriefRiskCueOption,
  );
  const repo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((r) => (where.key ? r.key === where.key : r.id === where.id)),
    ),
    exist: jest.fn(async ({ where }: any) =>
      rows.some((r) => r.key === where.key),
    ),
    count: jest.fn(
      async ({ where }: any) =>
        rows.filter((r) => r.status === where.status).length,
    ),
    create: (x: any) =>
      ({ history: [], version: 1, ...x }) as DebriefRiskCueOption,
    save: jest.fn(async (x: any) => {
      if (!rows.includes(x)) rows.push(x);
      if (!x.id) x.id = `id-${rows.length}`;
      return x;
    }),
  };
  return { svc: new DebriefRiskCueOptionService(repo as any), rows, repo };
}

describe('risk-cue options (spec DEBRIEF_ACROSS_ROLEPLAYS §5)', () => {
  describe('input', () => {
    it('accepts a complete option and trims it', () => {
      const { value, problems } = validateRiskCueInput({
        ...GOOD,
        name: '  End-of-life conversation ',
      });
      expect(problems).toEqual([]);
      expect(value?.name).toBe('End-of-life conversation');
    });

    it('says in plain words what is missing: a short wording, no handling, no examples of either kind', () => {
      const { problems } = validateRiskCueInput({
        ...GOOD,
        wording: 'too short',
        handling: 'whatever' as any,
        examples: { cues: [], nonCues: [] },
      });
      expect(problems.join(' ')).toMatch(/at least 60 characters/);
      expect(problems.join(' ')).toMatch(/alarm or assessed/);
      expect(problems.join(' ')).toMatch(/example that is a risk cue/);
      expect(problems.join(' ')).toMatch(/example that is not a risk cue/);
    });
  });

  describe('which option a run applies', () => {
    it('reads an approved option, keeps a retired one working for roleplays that already use it, and never runs a draft', async () => {
      const { svc } = build([
        { key: 'standard', name: 'Standard' },
        {
          key: 'live',
          status: 'approved',
          handling: 'assessed',
          wording: 'W',
          version: 3,
        },
        { key: 'old', status: 'retired' },
        { key: 'wip', status: 'draft', handling: 'assessed' },
      ]);
      expect(await svc.resolve('live')).toMatchObject({
        key: 'live',
        handling: 'assessed',
        wording: 'W',
        version: 3,
      });
      expect((await svc.resolve('old')).key).toBe('old');
      expect((await svc.resolve('wip')).key).toBe('standard');
      expect((await svc.resolve(null)).key).toBe('standard');
      expect((await svc.resolve('nope')).key).toBe('standard');
    });

    it('falls back to Standard when the table cannot be read, and null wording means the pinned definition', async () => {
      const { svc, repo } = build();
      repo.findOne.mockRejectedValueOnce(new Error('db down'));
      expect(await svc.resolve('anything')).toBe(STANDARD_RISK_CUE);
      expect(STANDARD_RISK_CUE.wording).toBeNull();
      expect(
        toResolved({
          key: 'k',
          name: 'n',
          version: 1,
          handling: 'alarm',
          wordListRaises: true,
          supportLinesOnCue: true,
          wording: '  ',
        } as any).wording,
      ).toBeNull();
    });
  });

  describe('the lifecycle', () => {
    it('a creator writes a draft only they see; the dropdown lists approved ones, Standard first, plus their own work', async () => {
      const { svc } = build([
        { key: 'a', status: 'approved' },
        { key: 'standard', status: 'approved' },
        { key: 'mine', status: 'draft', createdBy: 7 },
        { key: 'theirs', status: 'draft', createdBy: 9 },
        { key: 'sent', status: 'awaiting_approval', createdBy: 7 },
        { key: 'gone', status: 'retired' },
      ]);
      const keys = (await svc.list(7)).map((o) => o.key);
      expect(keys).toEqual(['standard', 'a', 'mine', 'sent']);
      expect((await svc.list(null)).map((o) => o.key)).toEqual([
        'standard',
        'a',
      ]);
    });

    it('creates a unique key from the name, as a draft by its creator', async () => {
      const { svc } = build([{ key: 'end_of_life_conversation' }]);
      const o = await svc.create(GOOD, 7);
      expect(o).toMatchObject({
        key: 'end_of_life_conversation_2',
        status: 'draft',
        createdBy: 7,
      });
    });

    it('lets only the creator edit or submit a draft; an edit voids the last test; nothing else is editable', async () => {
      const { svc } = build([
        {
          status: 'draft',
          createdBy: 7,
          testResult: { passed: true, version: 1 },
          wording: GOOD.wording,
          name: GOOD.name,
          examples: GOOD.examples,
        },
        { status: 'awaiting_approval' },
        { status: 'approved' },
      ]);
      await expect(svc.update('id-0', GOOD, 9)).rejects.toThrow(/creator/);
      const edited = await svc.update('id-0', GOOD, 7);
      expect(edited).toMatchObject({ testResult: null, version: 2 });
      await expect(svc.update('id-1', GOOD, 1)).rejects.toThrow(
        /waiting for a clinical advisor/,
      );
      await expect(svc.update('id-2', GOOD, 1)).rejects.toThrow(
        /create a new one/,
      );
      await expect(svc.submit('id-0', 9)).rejects.toThrow(/creator/);
      expect((await svc.submit('id-0', 7)).status).toBe('awaiting_approval');
    });

    it('approves only once its test passed on this version; records the approver and keeps the version', async () => {
      const { svc } = build([
        {
          status: 'awaiting_approval',
          version: 2,
          wording: GOOD.wording,
          examples: GOOD.examples,
        },
        {
          status: 'awaiting_approval',
          version: 2,
          testResult: { passed: true, version: 1 },
        },
        {
          status: 'awaiting_approval',
          version: 2,
          testResult: { passed: false, version: 2 },
        },
        {
          status: 'awaiting_approval',
          version: 2,
          testResult: { passed: true, version: 2 },
          wording: GOOD.wording,
          examples: GOOD.examples,
        },
        { status: 'draft' },
      ]);
      for (const id of ['id-0', 'id-1', 'id-2']) {
        await expect(svc.approve(id, 5)).rejects.toThrow(/Run its test first/);
      }
      await expect(svc.approve('id-4', 5)).rejects.toThrow(/awaiting approval/);
      const ok = await svc.approve('id-3', 5, ' fine ');
      expect(ok).toMatchObject({
        status: 'approved',
        approvedBy: 5,
        reviewNote: 'fine',
      });
      expect(ok.history).toHaveLength(1);
      expect(ok.history[0]).toMatchObject({ version: 2, approvedBy: 5 });
    });

    it('turns an option down only with a reason, back to its creator', async () => {
      const { svc } = build([{ status: 'awaiting_approval' }]);
      await expect(svc.reject('id-0', ' ')).rejects.toThrow(/Say why/);
      expect(await svc.reject('id-0', 'Too broad')).toMatchObject({
        status: 'draft',
        reviewNote: 'Too broad',
      });
    });

    it('retires an approved option, but never Standard, and never one that is not approved', async () => {
      const { svc } = build([
        { key: 'standard', status: 'approved' },
        { key: 'x', status: 'approved' },
        { key: 'y', status: 'draft' },
      ]);
      await expect(svc.retire('id-0')).rejects.toThrow(/default/);
      await expect(svc.retire('id-2')).rejects.toThrow(/approved/);
      expect((await svc.retire('id-1')).status).toBe('retired');
    });

    it('records a test against the option’s current version', async () => {
      const { svc } = build([{ status: 'draft', version: 3 }]);
      const o = await svc.recordTest('id-0', { passed: true });
      expect(o.testResult).toMatchObject({ passed: true, version: 3 });
    });
  });
});

describe('what an option changes elsewhere', () => {
  const clearCue = {
    quote: 'q',
    category: 'suicide_or_self_harm',
    strength: 'clear',
    turn_index: 2,
    learner_response: 'missed',
    response_turn_index: 3,
  } as any;
  const base = {
    cards: {
      opening: 'hi',
      what_worked: [],
      work_on_this: [],
      skill_words: [],
    } as any,
    transcript: [
      { turn_index: 1, role: 'counselor', text: 'How are you?' },
      { turn_index: 2, role: 'client', text: 'I want to die' },
      { turn_index: 3, role: 'counselor', text: 'Tell me more' },
    ] as any,
    safety: { risk_cues: [clearCue], learner_distress: [] },
    language: 'en',
    shortForm: true,
    hasProgress: false,
  };
  const uncovered = (riskHandling?: 'alarm' | 'assessed') =>
    runDebriefChecks({ ...base, riskHandling }).filter(
      (f) => f.code === 'risk_cue_uncovered',
    );

  it('requires an important moment for a clear cue under alarm (today), and not under assessed', () => {
    expect(uncovered()).toHaveLength(1);
    expect(uncovered('alarm')).toHaveLength(1);
    expect(uncovered('assessed')).toHaveLength(0);
  });

  it('counts the risk gate on the judge’s missed cue alone under assessed, and on the cards too under alarm', () => {
    const row = (handling: string | null, judge: unknown[] = []) =>
      toScoredRun({
        id: 'r',
        createdAt: '2026-11-17T00:00:00Z',
        status: 'published',
        has_cards: true,
        judged: true,
        quality: 9,
        hard_fails: judge,
        shown: true,
        risk_cues: [clearCue],
        important_moment: null,
        risk_handling: handling,
      });
    expect(row(null).missedClearRiskCue).toBe(true);
    expect(row('alarm').missedClearRiskCue).toBe(true);
    expect(row('assessed').missedClearRiskCue).toBe(false);
    expect(
      row('assessed', [{ code: 'missed_risk_cue' }]).missedClearRiskCue,
    ).toBe(true);
  });

  it('gives the judge the roleplay’s expectations, or nothing when it lists none', () => {
    expect(
      expectationsFor({
        helpfulBehaviours: [],
        unhelpfulBehaviours: [],
        competencies: [],
      }),
    ).toBeNull();
    expect(expectationsFor(null)).toBeNull();
    expect(
      expectationsFor({
        helpfulBehaviours: ['Asks open questions'],
        unhelpfulBehaviours: [],
        competencies: [],
      }),
    ).toEqual({
      helpful_behaviours: ['Asks open questions'],
      unhelpful_behaviours: [],
      competencies: [],
    });
  });
});

describe('the checks gateway applies the roleplay’s handling', () => {
  const transcript = [
    { turn_index: 1, role: 'counselor', text: 'How are you?' },
    { turn_index: 2, role: 'client', text: 'I want to die' },
    { turn_index: 3, role: 'counselor', text: 'Tell me more' },
  ];
  const cue = {
    quote: 'q',
    category: 'suicide_or_self_harm',
    strength: 'clear',
    turn_index: 2,
    learner_response: 'missed',
    response_turn_index: 3,
  };
  const body = (extra: Record<string, unknown> = {}) => ({
    cards: {
      opening: 'hi',
      what_worked: [],
      work_on_this: [],
      skill_words: [],
    } as any,
    safety: { risk_cues: [cue], learner_distress: [] } as any,
    language: 'en',
    short_form: true,
    ...extra,
  });
  const gateway = () => {
    const svc = Object.create(DebriefGatewayService.prototype) as any;
    svc.context = { transcript: jest.fn(async () => transcript) };
    svc.clinicalLists = undefined;
    return svc as DebriefGatewayService;
  };
  const uncovered = async (
    run: Record<string, unknown>,
    extra?: Record<string, unknown>,
  ) =>
    (
      await gateway().runChecks(
        { scenarioSessionId: 's1', ...run } as any,
        body(extra),
      )
    ).failures.filter((f) => f.code === 'risk_cue_uncovered');

  it('reads the handling the graph sends, else the one recorded on the run, else alarm', async () => {
    expect(await uncovered({})).toHaveLength(1);
    expect(
      await uncovered({
        workspace: { riskCueOption: { handling: 'assessed' } },
      }),
    ).toHaveLength(0);
    expect(await uncovered({}, { risk_handling: 'assessed' })).toHaveLength(0);
    expect(
      await uncovered(
        { workspace: { riskCueOption: { handling: 'assessed' } } },
        { risk_handling: 'alarm' },
      ),
    ).toHaveLength(1);
  });
});
