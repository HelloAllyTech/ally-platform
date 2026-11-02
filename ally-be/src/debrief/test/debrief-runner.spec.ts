import { DEBRIEF_SEED_BUNDLE } from '../constants/debrief-release.constants';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefRunnerService } from '../service/debrief-runner.service';
import { DebriefCards } from '../util/debrief-cards.util';

const transcript = [
  { turn_index: 1, role: 'counselor', text: 'What brings you here today?' },
  {
    turn_index: 2,
    role: 'client',
    text: "I don't see the point of anything anymore.",
  },
  {
    turn_index: 3,
    role: 'counselor',
    text: 'That sounds heavy. Can you tell me more?',
  },
];

const cards = (over: Partial<DebriefCards> = {}): DebriefCards => ({
  opening: 'You stayed with a client who was struggling.',
  important_moment: {
    turn_index: 2,
    quote: "I don't see the point of anything anymore.",
    handled_well: true,
    lead: 'You noticed an important moment.',
    body: 'You asked the client to say more.',
  },
  what_worked: [
    {
      skill: 'open questions',
      turn_index: 1,
      quote: 'What brings you here today?',
      lead: 'Your opening let the client lead.',
      body: 'It invited them to start anywhere.',
    },
  ],
  work_on_this: [
    {
      skill: 'exploring risk',
      turn_index: 3,
      quote: 'Can you tell me more?',
      lead: 'Ask about safety directly.',
      why: 'It is how you learn whether someone is at risk.',
      try_saying: 'Have you had thoughts of ending your life?',
    },
  ],
  practise_next: null,
  skill_words: [],
  reflective_question: 'What made it hard to ask directly?',
  progress_note: null,
  ...over,
});

const evaluation = (score: number, hardFails: string[] = []) => ({
  model: 'gemini-2.5-flash',
  evaluation: {
    dimensions: [
      'evidence_specificity',
      'accuracy',
      'actionability',
      'prioritisation',
      'personalisation_progress',
      'practice_alignment',
      'tone',
      'clarity',
    ].map((dimension) => ({ dimension, score })),
    hard_fails: hardFails.map((code) => ({ code, evidence: 'x' })),
    fixes:
      score < 8
        ? [{ section: 'work_on_this[0]', note: 'be more specific' }]
        : [],
  },
});

function build(opts: {
  learnerTurns?: number;
  steps: Record<string, Array<unknown | Error>>;
  existing?: boolean;
  practice?: Array<{ id: number; title: string; skills: string[] }>;
  assessment?: boolean;
  inCase?: boolean;
  bundle?: unknown;
}) {
  const saved: any[] = [];
  const calls: string[] = [];
  const runs = {
    create: (x: any) => ({ ...x }),
    save: jest.fn(async (x: any) => {
      saved.push({ ...x });
      return x;
    }),
    findOne: jest.fn(async () => ({ id: 'existing', status: 'published' })),
    findOneOrFail: jest.fn(async () => ({
      id: 'run-1',
      fallbackRung: 0,
      workspace: {},
    })),
    createQueryBuilder: () => ({
      insert: () => ({
        into: () => ({
          values: () => ({
            orIgnore: () => ({
              returning: () => ({
                execute: async () => ({
                  raw: opts.existing ? [] : [{ id: 'run-1' }],
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
  const context = {
    loadSession: async () => ({
      id: 's1',
      tenantId: 't1',
      counselorId: 7,
      status: 'ENDED',
      language: 'en',
      learnerLevel: 'professional',
      learnerTurns: opts.learnerTurns ?? 8,
      scenario: { title: 'x', description: 'y' },
      expectedBehaviours: [],
      assessment: opts.assessment ?? false,
      inCase: opts.inCase ?? false,
    }),
    caseMemory: async () => 'Meena told you about her exams last time.',
    transcript: async () => transcript,
    pastWorkOnThis: async () => [],
    promptText: async () => null,
    monthToDate: async () => ({ sessions: 10, spentUsd: 0 }),
  };
  const queues = Object.fromEntries(
    Object.entries(opts.steps).map(([k, v]) => [k, [...v]]),
  );
  const ai = {
    step: jest.fn(async (path: string) => {
      calls.push(path);
      const next = queues[path]?.shift();
      if (next === undefined)
        throw Object.assign(new Error(`no fake for ${path}`), { status: 500 });
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const knowledge = {
    searchForAudience: jest.fn(async () => ({ passages: [] })),
  };
  const releases = {
    getGa: async () => ({
      id: 'rel',
      version: 1,
      bundle: opts.bundle ?? DEBRIEF_SEED_BUNDLE,
    }),
  };
  const svc = new DebriefRunnerService(
    runs as any,
    context as any,
    ai as any,
    releases as any,
    { optionsFor: async () => opts.practice ?? [] } as any,
    knowledge as any,
  );
  return { svc, saved, calls, ai, knowledge };
}

const safetyWithCue = {
  model: 'gemini-2.5-flash',
  risk_cues: [
    {
      turn_index: 2,
      quote: "I don't see the point",
      category: 'hopelessness',
      learner_response: 'explored',
    },
  ],
  learner_distress: [],
};
const analyst = {
  model: 'gemini-2.5-pro',
  evidence: { pivotal_moments: [], behaviours: [] },
};

describe('DebriefRunnerService', () => {
  it('publishes a draft that passes the checks and the bar, without revising', async () => {
    const { svc, calls } = build({
      steps: {
        'safety-reader': [safetyWithCue],
        analyst: [analyst],
        writer: [{ model: 'gemini-3-flash-preview', cards: cards() }],
        evaluator: [evaluation(9)],
      },
    });
    const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(run.status).toBe(DebriefRunStatus.PUBLISHED);
    expect(run.hasRiskCue).toBe(true);
    expect(run.recipeKey).toBe('standard');
    expect(calls).not.toContain('reviser');
    expect(run.steps.map((s) => s.step)).toEqual(
      expect.arrayContaining([
        'safety_reader',
        'analyst',
        'guidance_lookup',
        'writer',
        'checks',
        'evaluator',
      ]),
    );
    expect(Number(run.estimatedCostUsd)).toBeGreaterThan(0);
  });

  it("offers the learner's own roleplays and keeps only links to them", async () => {
    const base = cards();
    const { svc, ai } = build({
      practice: [{ id: 41, title: 'Exam stress', skills: ['Exploring risk'] }],
      steps: {
        'safety-reader': [safetyWithCue],
        analyst: [analyst],
        writer: [
          {
            model: 'gemini-3-flash-preview',
            cards: cards({
              work_on_this: [{ ...base.work_on_this[0], scenario_id: 41 }],
              practise_next: {
                skill: 'exploring risk',
                reason: 'x',
                scenario_id: 99,
              },
            }),
          },
        ],
        evaluator: [evaluation(9)],
      },
    });
    const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    const writerCall = ai.step.mock.calls.find(
      (c: unknown[]) => c[0] === 'writer',
    ) as unknown[];
    expect((writerCall[1] as any).practice_options).toEqual([
      { id: 41, title: 'Exam stress', skills: ['Exploring risk'] },
    ]);
    expect(run.cards?.work_on_this[0].scenario_id).toBe(41);
    // 99 was never offered to this learner, so it is dropped.
    expect(run.cards?.practise_next?.scenario_id).toBeNull();
  });

  describe('Case and Assessment recipes', () => {
    const steps = () => ({
      'safety-reader': [safetyWithCue],
      analyst: [analyst],
      writer: [{ model: 'gemini-3-flash-preview', cards: cards() }],
      evaluator: [evaluation(9)],
    });
    const writerInput = (ai: any) =>
      (
        ai.step.mock.calls.find((c: unknown[]) => c[0] === 'writer') as any[]
      )[1];

    it('runs Assessment for a graded course roleplay, and tells the Writer', async () => {
      const { svc, ai } = build({ assessment: true, steps: steps() });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.recipeKey).toBe('assessment');
      expect(writerInput(ai).assessment).toBe(true);
    });

    it('runs Case for a case session, with the case memory', async () => {
      const { svc, ai } = build({ inCase: true, steps: steps() });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.recipeKey).toBe('case');
      expect(writerInput(ai).case_memory).toBe(
        'Meena told you about her exams last time.',
      );
    });

    it('runs Standard under a release made before Case existed', async () => {
      const older = { ...DEBRIEF_SEED_BUNDLE.recipes };
      delete older.case;
      delete older.assessment;
      const { svc } = build({
        inCase: true,
        bundle: { ...DEBRIEF_SEED_BUNDLE, recipes: older },
        steps: steps(),
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.recipeKey).toBe('standard');
    });

    it('keeps a short session short, case or not', async () => {
      const { svc } = build({ inCase: true, learnerTurns: 3, steps: steps() });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.recipeKey).toBe('short');
    });
  });

  it('looks guidance up in the debrief knowledge base, as the organisation may read it', async () => {
    const { svc, knowledge } = build({
      steps: {
        'safety-reader': [safetyWithCue],
        analyst: [
          {
            ...analyst,
            evidence: {
              ...(analyst as any).evidence,
              pivotal_moments: [{ summary: 'client hints at self-harm' }],
            },
          },
        ],
        writer: [{ model: 'gemini-3-flash-preview', cards: cards() }],
        evaluator: [evaluation(9)],
      },
    });
    await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(knowledge.searchForAudience).toHaveBeenCalledWith(
      expect.objectContaining({
        corpus: 'debrief_knowledge',
        query: 'client hints at self-harm',
      }),
      // 't1' is not an organisation id, so only platform documents.
      { tenantId: null },
      expect.objectContaining({ consumer: 'debrief', sessionId: 's1' }),
    );
  });

  it('revises a draft below the bar and keeps the better one', async () => {
    const { svc, calls } = build({
      steps: {
        'safety-reader': [safetyWithCue],
        analyst: [analyst],
        writer: [{ cards: cards() }],
        evaluator: [evaluation(6), evaluation(8.5)],
        reviser: [{ cards: cards({ opening: 'A revised opening.' }) }],
      },
    });
    const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(calls.filter((c) => c === 'reviser')).toHaveLength(1);
    expect(run.status).toBe(DebriefRunStatus.PUBLISHED);
    expect(run.revisionRounds).toBe(1);
    expect((run.cards as any).opening).toBe('A revised opening.');
    expect(run.workspace.evaluations.map((e: any) => e.overall)).toEqual([
      6, 8.5,
    ]);
  });

  it('never publishes without a safety reading, even after a retry', async () => {
    const { svc, calls } = build({
      steps: {
        'safety-reader': [new Error('502'), new Error('502')],
        analyst: [analyst],
      },
    });
    const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(run.status).toBe(DebriefRunStatus.NEEDS_PERSON);
    expect(run.skipReason).toBe('safety_reader_failed');
    expect(calls.filter((c) => c === 'safety-reader')).toHaveLength(2);
    expect(calls).not.toContain('writer');
  });

  it('a draft that drops the risk cue goes to a person, never to the learner', async () => {
    const noMoment = cards({ important_moment: null });
    const { svc } = build({
      learnerTurns: 3, // Short recipe: no revisions
      steps: {
        'safety-reader': [safetyWithCue],
        analyst: [analyst],
        writer: [{ cards: noMoment }],
        evaluator: [evaluation(9, ['missed_risk_cue'])],
      },
    });
    const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(run.recipeKey).toBe('short');
    expect(run.status).toBe(DebriefRunStatus.NEEDS_PERSON);
    expect(run.checkFailures.map((f) => f.code)).toContain(
      'risk_cue_uncovered',
    );
  });

  it('skips a session with no learner turns', async () => {
    const { svc, calls } = build({ learnerTurns: 0, steps: {} });
    const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(run.status).toBe(DebriefRunStatus.SKIPPED);
    expect(run.skipReason).toBe('too_short');
    expect(calls).toEqual([]);
  });

  it('returns the existing run when the session already has one', async () => {
    const { svc, calls } = build({ existing: true, steps: {} });
    const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(run.id).toBe('existing');
    expect(calls).toEqual([]);
  });
});
