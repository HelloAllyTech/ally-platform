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
            assessment: false,
            inCase: opts.inCase ?? false,
            languageRecorded: opts.languageRecorded ?? true,
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
      bundle: opts.bundle ?? DEBRIEF_SEED_BUNDLE,
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
        Object.values(DEBRIEF_MODELS).map((model) => ({ model })),
    } as any,
    agentLogs as any,
    ownerSettings as any,
    progressResults as any,
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
      for (const code of Object.keys(DEBRIEF_SEED_BUNDLE.prompts)) {
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

    it('holds the run for a person when no allowed provider can run a step (plan §8.9)', async () => {
      const { svc, graph } = build({ providerAllowlist: ['openai'] });
      const run = await svc.run('s1', { mode: DebriefRunMode.SHADOW });
      expect(run.status).toBe(DebriefRunStatus.NEEDS_PERSON);
      expect(run.skipReason).toBe('provider_not_allowed');
      expect(run.workspace?.providerAllowlist?.allowed).toEqual(['openai']);
      expect(graph.run).not.toHaveBeenCalled();
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
      expect(context.progressProfile).toHaveBeenCalledWith(7, 't1', 's1', {
        window: 8,
        cardEvery: 3,
        useFhs: true,
        showWorseToLearners: false,
      });
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
    expect(tokens.sign).toHaveBeenCalledWith('run-1', 's1', [
      ...DEBRIEF_GATEWAY_TOOLS,
      ...DEBRIEF_ORCHESTRATOR_TOOLS,
    ]);
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
