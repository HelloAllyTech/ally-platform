import {
  DEBRIEF_MODELS,
  DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
  debriefChallengerBundle,
} from '../constants/debrief-release.constants';
import {
  DEBRIEF_ORCHESTRATOR_TOOLS,
  DEBRIEF_GATEWAY_TOOLS,
} from '../service/debrief-run-token.service';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import {
  DebriefGraphError,
  DebriefGraphResponse,
} from '../service/debrief-graph.client';
import { DebriefRunnerService } from '../service/debrief-runner.service';
import { defaultOwnerSettings } from '../constants/debrief-owner-settings.constants';

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

const graphAnswer = (
  over: Partial<DebriefGraphResponse> = {},
): DebriefGraphResponse => ({
  status: 'published',
  skip_reason: null,
  recipe_key: 'standard',
  cards: { opening: 'You stayed with a client who was struggling.' },
  steps: [
    {
      step: 'safety_reader',
      label: 'Reading the session…',
      status: 'done',
      startedAt: '2026-11-10T00:00:00.000Z',
      ms: 1200,
      model: 'gemini-2.5-flash',
      estimatedUsd: 0.001,
    },
  ],
  workspace: {
    safety: { risk_cues: [], learner_distress: [] },
    decision: { status: 'published', round: 0, why: 'Published round 0.' },
    revisionRounds: 0,
  },
  estimated_cost_usd: 0.07123,
  fallback_rung: 1,
  has_risk_cue: true,
  learner_distress: false,
  revision_rounds: 1,
  evaluator_overall: 9.2,
  evaluator_hard_fails: [],
  check_failures: [
    { code: 'total_too_long', section: 'whole debrief', detail: '231 words' },
  ] as any,
  resumed: false,
  ...over,
});

/**
 * A release without the orchestrator (every release before 2026-11-16, and
 * any person may still make one): the fixed recipes. The seed runs the
 * orchestrator since 2026-11-16.
 */
const FIXED_RECIPES = (() => {
  const b = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
  delete b.orchestrator;
  for (const code of DEBRIEF_ORCHESTRATOR_PROMPT_CODES) delete b.prompts[code];
  return b;
})();

function build(
  opts: {
    learnerTurns?: number;
    existing?: boolean;
    noSession?: boolean;
    transcript?: unknown[];
    languageRecorded?: boolean;
    inCase?: boolean;
    monthToDate?: { sessions: number; spentUsd: number };
    providerAllowlist?: string[];
    graph?: DebriefGraphResponse | Error;
    live?: unknown[] | Error;
    cohort?: unknown;
    bundle?: unknown;
    owner?: Record<string, unknown>;
    progressProfile?: unknown;
    progressInsert?: Error;
    /** The language-pin lookup (DebriefChangeHoldsService); absent in most tests. */
    holds?: unknown;
    /** The ally-ai model catalogue; the seed's models by default. */
    catalog?: string[];
    debriefTabOff?: boolean;
    /** The roleplay's two Debrief choices, and what the services answer for them. */
    riskCueOption?: string | null;
    framework?: unknown;
  } = {},
) {
  const saved: any[] = [];
  const runs = {
    query: jest.fn(async () => []),
    update: jest.fn(async () => undefined),
    create: (x: any) => ({ ...x }),
    save: jest.fn(async (x: any) => {
      saved.push({ ...x });
      return x;
    }),
    findOne: jest.fn(async () => ({ id: 'existing', status: 'published' })),
    findOneOrFail: jest.fn(async () => ({
      id: 'run-1',
      scenarioSessionId: 's1',
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
    loadSession: jest.fn(async () =>
      opts.noSession
        ? null
        : {
            id: 's1',
            tenantId: 't1',
            counselorId: 7,
            status: 'ENDED',
            language: 'en',
            learnerLevel: 'professional',
            learnerTurns: opts.learnerTurns ?? 8,
            scenarioId: 41,
            scenario: { title: 'x', description: 'y' },
            expectedBehaviours: ['open questions'],
            helpfulBehaviours: ['Uses the client name'],
            unhelpfulBehaviours: ['Interrupts the client'],
            competencies: [
              {
                name: 'open questions',
                helpful: ['Asks open questions'],
                unhelpful: [],
              },
            ],
            assessment: false,
            inCase: opts.inCase ?? false,
            languageRecorded: opts.languageRecorded ?? true,
            debriefTabOff: opts.debriefTabOff ?? false,
            riskCueOption: opts.riskCueOption ?? null,
          },
    ),
    caseMemory: jest.fn(async () => 'Meena told you about her exams.'),
    transcript: jest.fn(async () => opts.transcript ?? transcript),
    pastWorkOnThis: jest.fn(async () => [
      { date: '2026-11-01', skill: 'reflections', point: 'Reflect feelings.' },
    ]),
    promptText: jest.fn(
      async (code: string, version: number | null) =>
        `live ${code}@${version ?? 'current'}`,
    ),
    currentPromptVersions: jest.fn(async (codes: string[]) =>
      Object.fromEntries(codes.map((c) => [c, 2])),
    ),
    providerAllowlist: jest.fn(
      async () => opts.providerAllowlist ?? ['gemini', 'openai', 'anthropic'],
    ),
    monthToDate: jest.fn(
      async () => opts.monthToDate ?? { sessions: 10, spentUsd: 0 },
    ),
    liveDetections: jest.fn(async () => {
      if (opts.live instanceof Error) throw opts.live;
      return opts.live ?? [];
    }),
    cohortStats: jest.fn(async () => opts.cohort ?? null),
    progressProfile: jest.fn(async () => {
      if (opts.progressProfile instanceof Error) throw opts.progressProfile;
      return opts.progressProfile ?? null;
    }),
    availability: jest.fn(async () => ({
      org_protocols: 2,
      past_debriefs: 4,
      cohort: true,
      course: false,
    })),
  };
  const graph = {
    run: jest.fn(async () => {
      const g = opts.graph ?? graphAnswer();
      if (g instanceof Error) throw g;
      return g;
    }),
  };
  const tokens = { sign: jest.fn(() => 'signed-run-token') };
  const config = { publicApiBaseUrl: 'https://be.example/' };
  const releases = {
    getGa: async () => ({
      id: 'rel',
      version: 3,
      bundle: opts.bundle ?? FIXED_RECIPES,
    }),
  };
  const practice = {
    optionsFor: jest.fn(async () => [
      { id: 41, title: 'Exam stress', skills: ['reflections'] },
    ]),
  };
  const agentLogs = { record: jest.fn(async () => 0) };
  const ownerSettings = {
    get: jest.fn(async () => ({
      ...defaultOwnerSettings(),
      ...(opts.owner ?? {}),
    })),
  };
  const progressResults = {
    insert: jest.fn(async () => {
      if (opts.progressInsert) throw opts.progressInsert;
      return {};
    }),
  };
  const svc = new DebriefRunnerService(
    runs as any,
    context as any,
    graph as any,
    tokens as any,
    config as any,
    releases as any,
    practice as any,
    {
      // Every model the seed names is in the catalog, as it is in prod.
      getModels: async () =>
        (opts.catalog ?? Object.values(DEBRIEF_MODELS)).map((model) => ({
          model,
        })),
    } as any,
    agentLogs as any,
    ownerSettings as any,
    progressResults as any,
    opts.holds as any,
    opts.framework
      ? ({ forTenant: jest.fn(async () => opts.framework) } as any)
      : undefined,
  );
  const request = () => (graph.run.mock.calls as any[][])[0]?.[0];
  return {
    svc,
    saved,
    runs,
    context,
    graph,
    tokens,
    practice,
    request,
    agentLogs,
    progressResults,
  };
}

describe('DebriefRunnerService', () => {
  it('runs the seed when the live release names a model switched off in the catalog', async () => {
    const { svc } = build();
    const custom = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
    custom.recipes.standard.steps.find(
      (s: { step: string }) => s.step === 'writer',
    ).model = 'gpt-4.1';
    const { release, bundle } = await svc.resolveRelease({
      id: 'r',
      version: 9,
      bundle: custom,
    } as any);
    expect(release).toBeNull();
    expect(bundle).toBe(DEBRIEF_SEED_BUNDLE);
  });

  describe('what the roleplay chose (skill framework and risk-cue option)', () => {
    const custom = {
      id: 'DG-0300',
      ids: ['DG-0300'],
      name: 'Palliative skills',
      foundational: false,
      skills: [{ key: 'presence', name: 'Presence' }],
      areas: [],
    };
    it('sends no framework when the library has none: no skills, Standard, legacy labels', async () => {
      const { svc, request } = build();
      await svc.run('s1', { mode: DebriefRunMode.LIVE });
      const s = request().session;
      expect(s.framework).toMatchObject({
        foundational: false,
        skills: [],
        areas: [],
      });
      expect(s.risk_cue).toEqual({
        key: 'standard',
        name: 'Standard',
        handling: 'alarm',
        word_list_raises: true,
      });
      expect(s.speaker_labels).toBe('legacy');
      // Standard reads the pinned definition: the prompt is the store's live text, untouched.
      expect(request().prompts[DEBRIEF_PROMPT_CODES.riskCueDefinition]).toMatch(
        /^live /,
      );
    });

    it('sends the organisation’s framework and the practised choice; the pinned definition always stays', async () => {
      const { svc, request, context, saved } = build({
        riskCueOption: 'part_of_practice',
        framework: custom,
      });
      await svc.run('s1', { mode: DebriefRunMode.LIVE });
      const s = request().session;
      expect(s.framework).toEqual(custom);
      expect(s.risk_cue).toEqual({
        key: 'part_of_practice',
        name: 'Part of the practice',
        handling: 'assessed',
        word_list_raises: true,
      });
      expect(request().prompts[DEBRIEF_PROMPT_CODES.riskCueDefinition]).toMatch(
        /^live /,
      );
      // The progress profile is built for this roleplay's skills and named competencies.
      expect(context.progressProfile).toHaveBeenCalledWith(
        7,
        't1',
        's1',
        expect.anything(),
        { framework: custom, competencies: ['open questions'] },
      );
      // The run records what it used, so a later edit never changes a past debrief.
      const ws = saved[saved.length - 1]?.workspace ?? {};
      expect(ws.frameworkUsed).toMatchObject({
        id: 'DG-0300',
        ids: ['DG-0300'],
        areas: [],
      });
      expect(ws.riskCueOption).toMatchObject({
        key: 'part_of_practice',
        version: 1,
        handling: 'assessed',
        supportLinesOnCue: true,
        wording: null,
      });
    });

    it('sends neutral labels only when the release says its prompt texts are the neutral ones', async () => {
      const bundle = JSON.parse(JSON.stringify(FIXED_RECIPES));
      bundle.settings.neutralWording = true;
      const { svc, request } = build({ bundle });
      await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(request().session.speaker_labels).toBe('neutral');
    });
  });

  describe('prepare', () => {
    it('builds the graph request: run, release, bundle with overrides, session, transcript and context', async () => {
      const { svc, request, tokens } = build({
        live: [{ behaviour: 'open questions', detected: true, times: 2 }],
        cohort: { trainees: 'five or more', skills: [] },
      });
      await svc.run('s1', {
        mode: DebriefRunMode.SHADOW,
        settingOverrides: { passScore: 7 },
      });
      const req = request();
      expect(req).toMatchObject({
        run_id: 'run-1',
        scenario_session_id: 's1',
        mode: 'shadow',
        resume: false,
        release: { id: 'rel', version: 3 },
        run_token: 'signed-run-token',
        gateway_url: 'https://be.example/api/v1/internal/debrief',
        transcript,
      });
      expect(tokens.sign).toHaveBeenCalledWith(
        'run-1',
        's1',
        DEBRIEF_GATEWAY_TOOLS,
        expect.any(Object),
      );
      expect(req.bundle.settings.passScore).toBe(7);
      expect(req.bundle.settings.deadlineMs).toBe(
        DEBRIEF_SEED_BUNDLE.settings.deadlineMs,
      );
      expect(req.session).toMatchObject({
        tenant_id: 't1',
        counselor_id: 7,
        language: 'en',
        language_source: 'recorded',
        learner_turns: 8,
        scenario_id: 41,
        expected_behaviours: ['open questions'],
        // The competencies' content goes with the names (review 2026-11-16).
        helpful_behaviours: ['Uses the client name'],
        unhelpful_behaviours: ['Interrupts the client'],
        competencies: [
          {
            name: 'open questions',
            helpful: ['Asks open questions'],
            unhelpful: [],
          },
        ],
        assessment: false,
        in_case: false,
      });
      expect(req.context).toEqual({
        live_detections: [
          { behaviour: 'open questions', detected: true, times: 2 },
        ],
        past_work_on_this: [
          {
            date: '2026-11-01',
            skill: 'reflections',
            point: 'Reflect feelings.',
          },
        ],
        cohort: { trainees: 'five or more', skills: [] },
        case_memory: null,
        practice_options: [
          { id: 41, title: 'Exam stress', skills: ['reflections'] },
        ],
        progress_profile: null,
      });
    });

    it('resolves every prompt the bundle names, with the run’s overrides applied', async () => {
      const { svc, request } = build();
      await svc.run('s1', {
        mode: DebriefRunMode.REPLAY,
        promptOverrides: { [DEBRIEF_PROMPT_CODES.writer]: 'challenger text' },
      });
      const prompts = request().prompts;
      for (const code of Object.keys(FIXED_RECIPES.prompts)) {
        expect(prompts).toHaveProperty(code);
      }
      expect(prompts[DEBRIEF_PROMPT_CODES.writer]).toBe('challenger text');
      expect(prompts[DEBRIEF_PROMPT_CODES.safetyReader]).toBe(
        `live ${DEBRIEF_PROMPT_CODES.safetyReader}@current`,
      );
    });

    it('prices every model the bundle names, per million tokens', async () => {
      const { svc, request } = build();
      await svc.run('s1', { mode: DebriefRunMode.REPLAY });
      const prices = request().prices;
      const named = new Set(
        Object.values(DEBRIEF_SEED_BUNDLE.recipes).flatMap((r) =>
          r!.steps.flatMap((s) => [s.model, s.backupModel]).filter(Boolean),
        ),
      );
      for (const model of named) {
        expect(prices[model as string]).toEqual({
          input_per_m: expect.any(Number),
          output_per_m: expect.any(Number),
        });
      }
    });

    it('uses the release ceiling for a replay and the pool’s for production', async () => {
      const replay = build();
      await replay.svc.run('s1', { mode: DebriefRunMode.REPLAY });
      expect(replay.request().ceiling_usd).toBe(
        DEBRIEF_SEED_BUNDLE.settings.runCeilingUsd,
      );
      expect(replay.context.monthToDate).not.toHaveBeenCalled();

      const shadow = build({ monthToDate: { sessions: 1000, spentUsd: 49 } });
      const run = await shadow.svc.run('s1', { mode: DebriefRunMode.SHADOW });
      const ceiling = shadow.request().ceiling_usd;
      expect(ceiling).toBeLessThanOrEqual(1);
      expect(ceiling).toBeGreaterThan(0);
      expect(run.ceilingUsd).toBe(ceiling.toFixed(4));
    });

    it('ends the run (today’s debrief) when no allowed provider has a priced model for a step (plan §8.9)', async () => {
      const { svc, graph } = build({ providerAllowlist: ['openai'] });
      const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(run.status).toBe(DebriefRunStatus.SKIPPED);
      expect(run.skipReason).toBe('provider_not_allowed');
      expect(run.workspace?.providerAllowlist?.allowed).toEqual(['openai']);
      expect(run.workspace.decision.why).toMatch(/today’s debrief/);
      expect(graph.run).not.toHaveBeenCalled();
    });

    it('runs a step on a priced model of an allowed provider instead of blocking it (plan §8.9)', async () => {
      const { svc, request } = build({
        providerAllowlist: ['openai'],
        catalog: [...Object.values(DEBRIEF_MODELS), 'gpt-4.1-mini', 'gpt-4.1'],
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(run.status).toBe(DebriefRunStatus.PUBLISHED);
      const steps = request().bundle.recipes.standard.steps as Array<{
        step: string;
        model: string | null;
      }>;
      // Never a model on a provider the organisation does not allow.
      for (const s of steps) {
        expect(s.model).toMatch(/^gpt-/);
      }
      // Same tier first: a flash step gets the mini model.
      expect(steps.find((s) => s.step === 'safety_reader')?.model).toBe(
        'gpt-4.1-mini',
      );
      const writer = steps.find((s) => s.step === 'writer')?.model;
      const evaluator = steps.find((s) => s.step === 'evaluator')?.model;
      expect(evaluator).not.toBe(writer);
      expect(
        run.workspace.providerAllowlist.substitutedSteps['standard.writer'],
      ).toBe(writer);
      expect(Object.keys(request().prices)).toEqual(
        expect.arrayContaining(['gpt-4.1-mini']),
      );
    });

    it('skips a roleplay whose Debrief tab is off, without calling the graph', async () => {
      const { svc, graph } = build({ debriefTabOff: true });
      const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(run.status).toBe(DebriefRunStatus.SKIPPED);
      expect(run.skipReason).toBe('debrief_tab_off');
      expect(graph.run).not.toHaveBeenCalled();
    });

    it('runs a live debrief past the month’s cap on the floor, marked over cap', async () => {
      const cap = DEBRIEF_SEED_BUNDLE.settings.monthlyCapUsd;
      const { svc, graph, request } = build({
        monthToDate: { sessions: 10, spentUsd: cap + 3 },
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(graph.run).toHaveBeenCalled();
      expect(request().ceiling_usd).toBe(
        DEBRIEF_SEED_BUNDLE.settings.runFloorUsd,
      );
      expect(request().allow_over_ceiling).toBe(true);
      expect(run.workspace.overCap).toBe(true);
      expect(run.workspace.overCapSpend).toEqual({
        spentUsd: cap + 3,
        capUsd: cap,
      });
    });

    it('raises a live ceiling below the floor to the floor (budget_below_minimum)', async () => {
      const cap = DEBRIEF_SEED_BUNDLE.settings.monthlyCapUsd;
      const floor = DEBRIEF_SEED_BUNDLE.settings.runFloorUsd;
      const { svc, request } = build({
        monthToDate: { sessions: 10, spentUsd: cap - floor / 2 },
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(request().ceiling_usd).toBe(floor);
      expect(run.workspace.overCap).toBe(true);
    });

    it('sends no over-ceiling allowance for a shadow run', async () => {
      const { svc, request } = build();
      await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(request().allow_over_ceiling).toBeUndefined();
      expect(request().attempt).toBeUndefined();
    });

    it('retries a run on its own row and a fresh graph thread', async () => {
      const { svc, request, practice } = build();
      const failed = {
        id: 'run-9',
        scenarioSessionId: 's1',
        mode: DebriefRunMode.LIVE,
        status: DebriefRunStatus.RUNNING,
        skipReason: 'safety_reader_failed',
        cards: null,
        fallbackRung: 6,
        workspace: {
          retries: 1,
          decision: { status: 'needs_person', why: 'safety' },
        },
      } as any;
      const run = await svc.retry(failed);
      expect(request().run_id).toBe('run-9');
      expect(request().attempt).toBe(1);
      expect(request().resume).toBe(false);
      expect(run.status).toBe(DebriefRunStatus.PUBLISHED);
      expect(run.skipReason).toBeNull();
      expect(run.workspace.retries).toBe(1);
      expect(practice.optionsFor).toHaveBeenCalledWith(7, 't1', 's1');
    });

    it('holds the run for a person at the monthly cap, without calling the graph', async () => {
      const { svc, graph } = build({
        monthToDate: {
          sessions: 10,
          spentUsd: DEBRIEF_SEED_BUNDLE.settings.monthlyCapUsd,
        },
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.status).toBe(DebriefRunStatus.NEEDS_PERSON);
      expect(run.skipReason).toBe('monthly_cap');
      expect(run.fallbackRung).toBe(6);
      expect(run.recipeKey).toBe('standard');
      expect(run.workspace.decision.why).toMatch(/budget is spent/);
      expect(graph.run).not.toHaveBeenCalled();
    });

    it.each([
      ['no_session', { noSession: true }, DebriefRunStatus.SKIPPED],
      ['too_short', { learnerTurns: 0 }, DebriefRunStatus.SKIPPED],
      ['no_transcript', { transcript: [] }, DebriefRunStatus.SKIPPED],
    ])('ends a %s run in ally-be', async (reason, o, status) => {
      const { svc, graph } = build(o as any);
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.status).toBe(status);
      expect(run.skipReason).toBe(reason);
      expect(run.workspace.decision).toMatchObject({ status, round: null });
      expect(graph.run).not.toHaveBeenCalled();
    });

    it('returns the existing run when the session already has one', async () => {
      const { svc, graph } = build({ existing: true });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.id).toBe('existing');
      expect(graph.run).not.toHaveBeenCalled();
    });

    it('leaves an unrecorded language to the graph, and keeps what it read', async () => {
      const { svc, request } = build({
        languageRecorded: false,
        graph: {
          ...graphAnswer(),
          language: 'ta',
          workspace: {
            ...graphAnswer().workspace,
            languageSource: 'detected',
          },
        },
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      // ally-be sends what it knows: the default, flagged as not recorded.
      expect(request().session).toMatchObject({
        language: 'en',
        language_source: null,
        language_recorded: false,
      });
      // The graph's answer fills the run record as detection here did.
      expect(run.language).toBe('ta');
      expect(run.workspace?.languageSource).toBe('detected');
    });

    it('a pin that cannot be read fails the attempt: nothing is claimed and the graph is not called', async () => {
      const { svc, graph } = build({
        holds: {
          releaseForSession: jest.fn(async () => {
            throw new Error('db down');
          }),
        },
      });
      await expect(
        svc.run('s1', { mode: DebriefRunMode.LIVE }),
      ).rejects.toThrow('db down');
      expect(graph.run).not.toHaveBeenCalled();
    });

    it('reads the case memory for a case session, and debriefs on when an optional read fails', async () => {
      const { svc, request } = build({
        inCase: true,
        live: new Error('db down'),
      });
      await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(request().context.case_memory).toBe(
        'Meena told you about her exams.',
      );
      expect(request().context.live_detections).toEqual([]);
    });

    it('says what it could not read: the run keeps a note of each failed read', async () => {
      const { svc, saved } = build({
        inCase: true,
        live: new Error('db down'),
      });
      await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      const ws = saved[saved.length - 1]?.workspace ?? {};
      expect(ws.dataNotes).toEqual([
        {
          contextKey: 'live_detections',
          item: 'live_detections',
          why: 'db down',
        },
      ]);
    });

    it('keeps no note when every read worked', async () => {
      const { svc, saved } = build();
      await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      const ws = saved[saved.length - 1]?.workspace ?? {};
      expect(ws).not.toHaveProperty('dataNotes');
    });
  });

  describe('apply', () => {
    it('writes every field of the graph’s answer onto the run', async () => {
      const { svc, saved } = build();
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run).toMatchObject({
        status: DebriefRunStatus.PUBLISHED,
        skipReason: null,
        recipeKey: 'standard',
        cards: { opening: 'You stayed with a client who was struggling.' },
        estimatedCostUsd: '0.0712',
        fallbackRung: 1,
        hasRiskCue: true,
        learnerDistress: false,
        revisionRounds: 1,
        evaluatorOverall: '9.20',
        evaluatorHardFails: [],
        checkFailures: [
          {
            code: 'total_too_long',
            section: 'whole debrief',
            detail: '231 words',
          },
        ],
        tenantId: 't1',
        language: 'en',
        learnerTurns: 8,
      });
      expect(run.steps).toHaveLength(1);
      expect(run.finishedAt).toBeInstanceOf(Date);
      // The graph's workspace is merged over what ally-be wrote.
      expect(run.workspace).toMatchObject({
        languageSource: 'recorded',
        safety: { risk_cues: [], learner_distress: [] },
        decision: { status: 'published' },
      });
      expect(saved).toHaveLength(1);
    });

    it('stores the graph’s agent logs with each prompt’s version (an override keeps its text)', async () => {
      const logs = [
        { seq: 1, kind: 'code', step: 'plan', input: {}, output: {} },
      ];
      const { svc, agentLogs } = build({
        graph: { ...graphAnswer(), logs } as any,
      });
      const run = await svc.run('s1', {
        mode: DebriefRunMode.REPLAY,
        promptOverrides: { [DEBRIEF_PROMPT_CODES.writer]: 'challenger text' },
      });
      expect(agentLogs.record).toHaveBeenCalledTimes(1);
      const [stored, entries, versions] = (
        agentLogs.record.mock.calls as any[][]
      )[0];
      expect(stored).toBe(run);
      expect(entries).toEqual(logs);
      expect(versions[DEBRIEF_PROMPT_CODES.writer]).toEqual({
        text: 'challenger text',
      });
      expect(versions[DEBRIEF_PROMPT_CODES.safetyReader]).toBe(2);
    });

    it('keeps a needs-person decision and its reason', async () => {
      const { svc } = build({
        graph: graphAnswer({
          status: 'needs_person',
          skip_reason: 'safety_reader_failed',
          cards: null,
          fallback_rung: 6,
          evaluator_overall: null,
          check_failures: [],
        }),
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.status).toBe(DebriefRunStatus.NEEDS_PERSON);
      expect(run.skipReason).toBe('safety_reader_failed');
      expect(run.fallbackRung).toBe(6);
      expect(run.evaluatorOverall).toBeNull();
      expect(run.cards).toBeNull();
    });

    it('marks the run failed on an unexpected error', async () => {
      const { svc } = build({
        graph: new Error('debrief graph: something odd'),
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.status).toBe(DebriefRunStatus.FAILED);
      expect(run.error).toBe('debrief graph: something odd');
      expect(run.fallbackRung).toBe(6);
      expect(run.workspace.decision.why).toMatch(/unexpected error/);
    });

    it('leaves a production run running for the sweeper when ally-ai does not answer (v9 FR-3)', async () => {
      for (const status of [null, 502]) {
        const { svc } = build({
          graph: new DebriefGraphError(
            status,
            'debrief graph network: socket hang up',
          ),
        });
        const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
        // Not finished: the claim's `running` stays for the sweeper.
        expect(run.status).not.toBe(DebriefRunStatus.FAILED);
        expect(run.workspace.graphUnreachable.error).toMatch(/socket hang up/);
        expect(run.finishedAt).toBeFalsy();
      }
    });

    it('ends a replay as failed when ally-ai does not answer (replays are not swept)', async () => {
      const { svc } = build({
        graph: new DebriefGraphError(
          null,
          'debrief graph network: socket hang up',
        ),
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.REPLAY });
      expect(run.status).toBe(DebriefRunStatus.FAILED);
    });

    it('marks the run failed when the graph answers without a decision', async () => {
      const { svc } = build({ graph: { status: 'running' } as any });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.status).toBe(DebriefRunStatus.FAILED);
      expect(run.error).toMatch(/no decision/);
    });
  });

  describe('learner progress', () => {
    const profile = { session_number: 5, card_due: true, sessions: [] };

    it('sends the progress profile with the owner settings, and asks for the progress prompt', async () => {
      const { svc, request, context } = build({
        progressProfile: profile,
        owner: { progressWindow: 8, progressCardEvery: 3 },
      });
      await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(request().context.progress_profile).toEqual(profile);
      expect(context.progressProfile).toHaveBeenCalledWith(
        7,
        't1',
        's1',
        {
          window: 8,
          cardEvery: 3,
          useFhs: true,
          showWorseToLearners: false,
        },
        // The organisation's framework (none here) and the roleplay's named competencies.
        expect.objectContaining({
          framework: expect.objectContaining({ skills: [] }),
          competencies: expect.any(Array),
        }),
      );
      expect(request().prompts).toHaveProperty(DEBRIEF_PROMPT_CODES.progress);
    });

    it('sends no profile when progress is switched off', async () => {
      const { svc, request, context } = build({
        progressProfile: profile,
        owner: { progressOn: false },
      });
      await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(context.progressProfile).not.toHaveBeenCalled();
      expect(request().context.progress_profile).toBeNull();
    });

    it('an unreadable profile never blocks the debrief', async () => {
      const { svc, request } = build({ progressProfile: new Error('boom') });
      const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(request().context.progress_profile).toBeNull();
      expect(run.status).toBe(DebriefRunStatus.PUBLISHED);
    });

    const progress = {
      report: {
        skills: [
          {
            skill: 'empathy',
            trend: 'too_early' as const,
            why: 'Two sessions.',
            evidence: [{ run_id: 'this', turn_index: 3 }],
            fhs: 'absent' as const,
            learner_line: '',
          },
        ],
        followups: [{ point: 'Reflect feelings.', status: 'partly' }],
        focus: { skill: 'empathy', why: 'x', learner_line: 'y' },
        shown_as: 'card' as const,
      },
      vetoes: [{ skill: 'empathy', veto: 'too_few_sessions', detail: '2 < 3' }],
      shown_as: 'card' as const,
      model: 'gemini-2.5-flash',
      window_session_ids: [
        '11111111-1111-1111-1111-111111111111',
        'not-a-uuid',
      ],
      analyst_versions: [2, 3],
    };

    it('stores the progress reading when the graph sends one', async () => {
      const { svc, progressResults } = build({
        graph: graphAnswer({ progress }),
      });
      await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(progressResults.insert).toHaveBeenCalledWith({
        tenantId: 't1',
        counselorId: 7,
        runId: 'run-1',
        scenarioSessionId: 's1',
        windowSessionIds: ['11111111-1111-1111-1111-111111111111'],
        skills: progress.report.skills,
        followups: progress.report.followups,
        focus: progress.report.focus,
        vetoes: progress.vetoes,
        shownAs: 'card',
        analystVersions: [2, 3],
        model: 'gemini-2.5-flash',
      });
    });

    it('stores nothing when the progress agent did not run', async () => {
      const { svc, progressResults } = build();
      await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(progressResults.insert).not.toHaveBeenCalled();
    });

    it('a failed write never fails the run', async () => {
      const { svc, progressResults, agentLogs } = build({
        graph: graphAnswer({ progress }),
        progressInsert: new Error('no table'),
      });
      const run = await svc.run('s1', { mode: DebriefRunMode.LIVE });
      expect(progressResults.insert).toHaveBeenCalled();
      expect(run.status).toBe(DebriefRunStatus.PUBLISHED);
      expect(agentLogs.record).toHaveBeenCalled();
    });
  });

  describe('resume (v9 FR-3)', () => {
    it('calls the graph with resume: true and the same run id', async () => {
      const { svc, request } = build();
      const stuck = {
        id: 'run-9',
        scenarioSessionId: 's1',
        mode: DebriefRunMode.SHADOW,
        status: DebriefRunStatus.RUNNING,
        fallbackRung: 0,
        workspace: { resumes: 1 },
      } as any;
      const done = await svc.resume(stuck);
      expect(request()).toMatchObject({ run_id: 'run-9', resume: true });
      expect(done.status).toBe(DebriefRunStatus.PUBLISHED);
      expect(done.workspace.resumes).toBe(1);
    });
  });
});

describe('DebriefRunnerService with the orchestrator (spec A11)', () => {
  it('a release without the orchestrator runs as before: base tools, no availability, no orchestrator prompts', async () => {
    const { svc, request, tokens, context } = build();
    await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    expect(tokens.sign).toHaveBeenCalledWith(
      'run-1',
      's1',
      DEBRIEF_GATEWAY_TOOLS,
      expect.any(Object),
    );
    expect(context.availability).not.toHaveBeenCalled();
    expect(request().context).not.toHaveProperty('availability');
    for (const code of DEBRIEF_ORCHESTRATOR_PROMPT_CODES) {
      expect(request().prompts).not.toHaveProperty(code);
    }
    expect(request().bundle.orchestrator).toBeUndefined();
  });

  it('a challenger release sends the orchestrator, its tools, prompts, prices and the availability facts', async () => {
    const { svc, request, tokens } = build({
      bundle: debriefChallengerBundle(DEBRIEF_SEED_BUNDLE),
    });
    await svc.run('s1', { mode: DebriefRunMode.SHADOW });
    const req = request();
    expect(req.bundle.orchestrator.enabled).toBe(true);
    expect(tokens.sign).toHaveBeenCalledWith(
      'run-1',
      's1',
      [...DEBRIEF_GATEWAY_TOOLS, ...DEBRIEF_ORCHESTRATOR_TOOLS],
      expect.any(Object),
    );
    expect(req.context.availability).toEqual({
      org_protocols: 2,
      past_debriefs: 4,
      cohort: true,
      course: false,
    });
    for (const code of DEBRIEF_ORCHESTRATOR_PROMPT_CODES) {
      expect(req.prompts).toHaveProperty(code);
    }
    for (const model of [
      DEBRIEF_MODELS.planner,
      DEBRIEF_MODELS.registryAgent,
      DEBRIEF_MODELS.registryAgentBackup,
    ]) {
      expect(req.prices[model]).toEqual({
        input_per_m: expect.any(Number),
        output_per_m: expect.any(Number),
      });
    }
  });
});
