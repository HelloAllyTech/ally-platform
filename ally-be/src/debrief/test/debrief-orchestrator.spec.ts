import { guardSelectQuery } from '../../analytics-agent/util/sql-guard.util';
import {
  DEBRIEF_ORCHESTRATOR_DEFAULT,
  DEBRIEF_REGISTRY_AGENTS,
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
  debriefChallengerBundle,
  isOrchestrated,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import {
  AGGREGATE_MIN_GROUP,
  DEBRIEF_AGGREGATE_VIEWS,
  DebriefAggregatesService,
} from '../service/debrief-aggregates.service';

describe('The orchestrator in the release bundle (spec A2, A11)', () => {
  it('the seed never carries it, so the boot-time seed sync changes nothing for GA', () => {
    expect(DEBRIEF_SEED_BUNDLE.orchestrator).toBeUndefined();
    expect(isOrchestrated(DEBRIEF_SEED_BUNDLE)).toBe(false);
    expect(validateDebriefBundle(DEBRIEF_SEED_BUNDLE)).toEqual([]);
  });

  it('a release made before it (no orchestrator block) still validates', () => {
    const old: Partial<DebriefBundle> = {
      ...debriefChallengerBundle(DEBRIEF_SEED_BUNDLE),
    };
    delete old.orchestrator;
    expect(validateDebriefBundle(old)).toEqual([]);
    expect(isOrchestrated(old)).toBe(false);
  });

  it('a challenger bundle turns it on with every registry agent at the build version', () => {
    const b = debriefChallengerBundle(DEBRIEF_SEED_BUNDLE);
    expect(validateDebriefBundle(b)).toEqual([]);
    expect(isOrchestrated(b)).toBe(true);
    expect(b.recipes).toEqual(DEBRIEF_SEED_BUNDLE.recipes);
    expect(b.orchestrator!.agents.map((a) => a.id).sort()).toEqual(
      Object.keys(DEBRIEF_REGISTRY_AGENTS).sort(),
    );
    expect(b.prompts).toHaveProperty('debrief_planner_system', null);
    expect(b.prompts).toHaveProperty('debrief_protocol_check_system', null);
  });

  it('a disabled block is the fixed recipe and validates', () => {
    const b = debriefChallengerBundle(DEBRIEF_SEED_BUNDLE, { enabled: false });
    expect(isOrchestrated(b)).toBe(false);
    expect(validateDebriefBundle(b)).toEqual([]);
  });

  it('refuses unknown agents, versions the build lacks, duplicates and bad limits', () => {
    const b: DebriefBundle = debriefChallengerBundle(DEBRIEF_SEED_BUNDLE, {
      maxAgentsPerPlan: 40,
      agents: [
        { id: 'analyst', version: 1 },
        { id: 'analyst', version: 1 },
        { id: 'protocol_check', version: 2 },
        { id: 'mind_reader' as any, version: 1 },
      ],
    });
    const problems = validateDebriefBundle(b);
    expect(problems).toEqual(
      expect.arrayContaining([
        'orchestrator: maxAgentsPerPlan must be 1–10',
        'orchestrator: analyst is listed twice',
        'orchestrator: protocol_check v2 is not in this build (v1)',
        'orchestrator: no registry agent mind_reader',
      ]),
    );
  });

  it('refuses an unapproved or unpriced planner model, and one off in the catalog', () => {
    const b = debriefChallengerBundle(DEBRIEF_SEED_BUNDLE, {
      plannerModel: 'llama-3-70b',
    });
    expect(validateDebriefBundle(b)).toContain(
      'orchestrator: llama-3-70b is not from an approved provider',
    );
    const off = debriefChallengerBundle(DEBRIEF_SEED_BUNDLE);
    const catalog = {
      steps: new Set<string>(
        Object.values(DEBRIEF_SEED_BUNDLE.recipes).flatMap((r) =>
          r!.steps.flatMap((s) => [s.model, s.backupModel]).filter(Boolean),
        ) as string[],
      ),
      reply: new Set<string>([DEBRIEF_SEED_BUNDLE.reply!.model]),
    };
    catalog.steps.delete(DEBRIEF_ORCHESTRATOR_DEFAULT.plannerModel);
    expect(validateDebriefBundle(off, catalog)).toContain(
      `orchestrator: ${DEBRIEF_ORCHESTRATOR_DEFAULT.plannerModel} is not an active model in the LLM catalog for ally-ai`,
    );
  });
});

describe('query_aggregates (spec A4)', () => {
  const scope = {
    tenantId: '6b0d6a3e-4b8f-4a43-9a5a-1f2b3c4d5e6f',
    counselorId: 7,
    trackId: '0f1e2d3c-4b5a-4968-8776-655443322110',
  };
  const svc = (rows: Array<Record<string, unknown>> = []) => {
    const ran: string[] = [];
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      isTransactionActive: true,
      rollbackTransaction: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
      query: jest.fn(async (sql: string) => {
        ran.push(sql);
        return sql.startsWith('SELECT * FROM') ? rows : [];
      }),
    };
    const dataSource = {
      query: jest.fn(async () => [
        {
          tenant_id: scope.tenantId,
          counselor_id: scope.counselorId,
          track_id: scope.trackId,
        },
      ]),
      createQueryRunner: () => queryRunner,
    };
    return {
      service: new DebriefAggregatesService(dataSource as any),
      ran,
      queryRunner,
    };
  };

  it('builds only fixed queries, scoped to the organisation and excluding the learner, that pass the guard', () => {
    const { service } = svc();
    for (const [query, params] of [
      ['cohort_skill_rates', { skills: ['Open questions', "client's pace"] }],
      ['course_missed_skills', {}],
    ] as const) {
      const built = service.build(query, params, scope);
      expect('sql' in built).toBe(true);
      const sql = (built as { sql: string }).sql;
      expect(sql).toContain(`tenant_id = '${scope.tenantId}'`);
      expect(sql).toContain("learner_key <> md5('learner:' || 7)");
      expect(sql).toContain(`HAVING count(*) >= ${AGGREGATE_MIN_GROUP}`);
      expect(
        guardSelectQuery(sql, DEBRIEF_AGGREGATE_VIEWS, 'the debrief'),
      ).toMatchObject({
        ok: true,
      });
    }
    const cohort = service.build(
      'cohort_skill_rates',
      { skills: ['open questions'] },
      scope,
    ) as { sql: string };
    expect(cohort.sql).toContain("skill IN ('open questions')");
  });

  it('refuses free SQL, unknown queries, odd skills and a session with no course', () => {
    const { service } = svc();
    expect(service.build('SELECT * FROM users', {}, scope)).toEqual({
      refused: 'no aggregate query SELECT * FROM users',
    });
    expect(
      service.build(
        'cohort_skill_rates',
        { skills: ["x'); DROP TABLE users; --"] },
        scope,
      ),
    ).toEqual({ refused: 'no skills to compare' });
    expect(
      service.build('course_missed_skills', {}, { ...scope, trackId: null }),
    ).toEqual({ refused: 'the session is not part of a course' });
    expect(
      service.build('course_missed_skills', {}, { ...scope, tenantId: null }),
    ).toEqual({ refused: 'the session has no organisation' });
  });

  it('runs read-only and never returns a group under five learners', async () => {
    const { service, ran } = svc([
      { skill: 'pacing', learners: 6, observed_share: '0.33' },
      { skill: 'tiny', learners: 3, observed_share: '1.00' },
    ]);
    const res = await service.run(
      { id: 'run-1', scenarioSessionId: 's1' } as any,
      'cohort_skill_rates',
      { skills: ['pacing', 'tiny'] },
    );
    expect(ran).toContain('SET TRANSACTION READ ONLY');
    expect(res).toEqual({
      query: 'cohort_skill_rates',
      min_group: 5,
      rows: [{ skill: 'pacing', learners: 6, observed_share: 0.33 }],
    });
  });
});
