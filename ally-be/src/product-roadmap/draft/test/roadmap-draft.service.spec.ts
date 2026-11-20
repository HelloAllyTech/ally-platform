import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RoadmapNotificationKind } from 'src/product-planning/enum/product-planning.enum';
import { RoadmapDraftService } from '../roadmap-draft.service';
import { DRAFT_CHECK_ORDER } from '../roadmap-draft.util';

const ME = 7;
const SESSION = '00000000-0000-4000-8000-000000000001';

const allGates = DRAFT_CHECK_ORDER.map((id) => ({ id, met: true }));
/** A quality grade at the bar: submit is refused without one (the quality bar, 2026-11-20). */
const passing = {
  score: 75,
  passScore: 65,
  scaleMax: 4,
  passed: true,
  weakest: null,
  dimensions: [],
};

function draftRow(
  plan: Record<string, any> = {},
  over: Record<string, any> = {},
) {
  return {
    id: SESSION,
    kind: 'plan',
    visibility: 'private',
    createdBy: ME,
    title: 'Idea',
    archivedAt: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    plan: { code: 'OPP-0900', draftText: 'Counsellors retype names', ...plan },
    ...over,
  };
}

function build(opts: { role?: string; row?: any; messages?: any[] } = {}) {
  let row = opts.row ?? draftRow();
  const qb: any = {
    addSelect: () => qb,
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    take: () => qb,
    getOne: jest.fn(async () => row),
    getMany: jest.fn(async () => (row ? [row] : [])),
  };
  const deps = {
    dataSource: {
      query: jest.fn<Promise<any>, any[]>(async () => []),
    },
    settings: {},
    roles: { roleOf: jest.fn(async () => opts.role ?? 'idea') },
    store: {
      repository: {
        createQueryBuilder: () => qb,
        update: jest.fn(),
        delete: jest.fn(),
      },
      get: jest.fn(async () => row),
      find: jest.fn(async () => row),
      patchPlan: jest.fn(async (_id: string, patch: any) => {
        row = { ...row, plan: { ...row.plan, ...patch } };
      }),
      update: jest.fn(),
    },
    stage: { sync: jest.fn() },
    builderSessions: {
      createSession: jest.fn(async () => ({ id: SESSION })),
      attachHandoffContext: jest.fn(),
    },
    messages: {
      appendMessage: jest.fn(async (_id: string, m: any) => ({
        id: 'm',
        ...m,
      })),
      listBySession: jest.fn(async () => opts.messages ?? []),
    },
    copilot: { takeTurn: jest.fn() },
    opportunityService: { create: jest.fn(async () => ({ id: 'opp-1' })) },
    readinessToken: { issue: jest.fn(() => 'signed') },
    roadmapBuilder: { handoffTextForOpportunity: jest.fn(async () => null) },
    roadmapAi: { findDuplicates: jest.fn(async () => ({ matches: [] })) },
    allocations: { setVotes: jest.fn() },
    comments: { create: jest.fn(async () => ({ id: 'c1' })) },
    events: { record: jest.fn() },
    spend: {
      checkCeiling: jest.fn(async () => ({
        state: 'ok',
        spentUsd: 0.1,
        ceilingUsd: 1,
      })),
      record: jest.fn(),
    },
    ceiling: { assertWithinCeiling: jest.fn() },
    inbox: { deliver: jest.fn() },
    broadcast: { emit: jest.fn() },
    lookup: { get: jest.fn() },
    reader: {
      detail: jest.fn(async () => ({ code: 'OPP-0900' })),
      rowsFor: jest.fn(async () => []),
    },
  };
  const service = new RoadmapDraftService(
    ...(Object.values(deps) as unknown as ConstructorParameters<
      typeof RoadmapDraftService
    >),
  );
  return { service, deps, row: () => row };
}

describe('RoadmapDraftService', () => {
  it('New idea needs the Idea role and allocates the code it keeps for life, with no AI', async () => {
    const viewer = build({ role: 'viewer' });
    await expect(
      viewer.service.create(ME, { text: 'An idea' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const { service, deps } = build();
    deps.dataSource.query.mockResolvedValueOnce([{ code: 'OPP-0900' }]);
    const draft = await service.create(ME, { text: 'An idea\nmore' });
    expect(deps.dataSource.query.mock.calls[0][0]).toContain(
      "nextval('roadmap_opportunity_code_seq')",
    );
    expect(deps.store.patchPlan).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ code: 'OPP-0900', draftVersion: 1 }),
    );
    expect(deps.copilot.takeTurn).not.toHaveBeenCalled();
    expect(draft.code).toBe('OPP-0900');
  });

  it("someone else's draft is a 404, never a 403", async () => {
    const { service } = build({ row: draftRow({}, { createdBy: 99 }) });
    await expect(service.detail(ME, 'OPP-0900')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a stale autosave with the current draft', async () => {
    const { service, deps } = build();
    deps.dataSource.query.mockResolvedValueOnce([[], 0]);
    const error = await service
      .patch(ME, 'OPP-0900', { text: 'new', baseVersion: 3 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'draft_version_conflict',
      current: { code: 'OPP-0900' },
    });
  });

  it('a repeated idempotency key runs no second turn', async () => {
    const { service, deps } = build();
    deps.dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
    await service.turn(ME, 'OPP-0900', {
      answer: 'again',
      idempotencyKey: 'key-123456',
    });
    expect(deps.copilot.takeTurn).not.toHaveBeenCalled();
    expect(deps.messages.appendMessage).not.toHaveBeenCalled();
  });

  it('Check my idea keeps verified quotes and the goal suggestion from the same turn', async () => {
    const { service, deps, row } = build();
    deps.copilot.takeTurn.mockResolvedValue({
      reply: 'What would tell us it worked?',
      gates: allGates,
      draft: null,
      brief: null,
      readinessToken: null,
      checkTurn: {
        evidence: { who_it_affects: 'Counsellors', clear_why: 'paraphrase' },
        suggestedGoal: 'Scribe',
      },
    });
    await service.turn(ME, 'OPP-0900', {});
    expect(deps.copilot.takeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ checks: { reopened: [] } }),
      ME,
    );
    expect(row().plan.idea).toMatchObject({
      evidence: { who_it_affects: 'Counsellors' },
      suggestedGoal: 'Scribe',
      turnFailures: 0,
    });
  });

  it('counts assistant failures, and never offers Fill it in yourself (removed 2026-11-18)', async () => {
    const { service, deps, row } = build({
      row: draftRow({ idea: { turnFailures: 1 } }),
    });
    deps.copilot.takeTurn.mockRejectedValue(
      new ServiceUnavailableException('down'),
    );
    const error = await service.turn(ME, 'OPP-0900', {}).catch((e) => e);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({
      code: 'assistant_unavailable',
      failures: 2,
      selfCheckOffered: false,
    });
    expect(row().plan.idea.turnFailures).toBe(2);
  });

  it('Submit refuses anything short of 5 of 5', async () => {
    const { service, deps } = build();
    const error = await service
      .submit(ME, 'OPP-0900', { title: 'A title' })
      .catch((e) => e);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({ code: 'checks_incomplete' });
    expect(deps.opportunityService.create).not.toHaveBeenCalled();
  });

  it('Submit files with the same code, pending review, shared, and tells the Owners', async () => {
    const { service, deps } = build({
      row: draftRow({
        draftGoalId: 'g1',
        idea: {
          gates: allGates,
          quality: passing,
          brief: { assessment: { rating: 'promising' } },
          draft: { description: 'x', productGoal: 'Scribe', effort: 'm' },
        },
      }),
    });
    deps.dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "roadmap_product_goals"'))
        return [{ id: 'g1', name: 'Scribe' }];
      if (sql.includes("jsonb_build_object('filingAt'"))
        return [[{ id: SESSION }], 1];
      if (sql.includes('count(*)')) return [{ n: 0 }];
      return [];
    });
    const result = await service.submit(ME, 'OPP-0900', { title: 'A title' });
    expect(deps.opportunityService.create).toHaveBeenCalledWith(
      ME,
      expect.objectContaining({
        description: 'Counsellors retype names',
        productGoal: 'Scribe',
        readinessToken: 'signed',
      }),
      expect.objectContaining({ code: 'OPP-0900', enforceReadiness: true }),
    );
    expect(
      deps.dataSource.query.mock.calls.some(([sql]) =>
        String(sql).includes(`"reviewState" = 'pending'`),
      ),
    ).toBe(true);
    expect(deps.store.update).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ visibility: 'shared' }),
    );
    expect(deps.inbox.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: RoadmapNotificationKind.SUBMITTED }),
    );
    expect(result.firstSubmit).toBe(true);
  });

  describe('What will be submitted (audit rec. 6) and the filing record (rec. 5)', () => {
    const ready = (
      draft: any,
      brief: any = {
        assessment: { rating: 'promising', summary: 'Worth doing.' },
      },
    ) =>
      build({
        row: draftRow({
          draftGoalId: 'g1',
          idea: { gates: allGates, quality: passing, brief, draft },
        }),
      });
    const filing = (deps: any) =>
      deps.dataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM "roadmap_product_goals"'))
          return [{ id: 'g1', name: 'Scribe' }];
        if (sql.includes("jsonb_build_object('filingAt'"))
          return [[{ id: SESSION }], 1];
        if (sql.includes('count(*)')) return [{ n: 1 }];
        return [];
      });
    const statement = {
      description: 'Counsellors stop retyping client names between screens.',
      title: 'Carry client names across screens',
      productGoal: 'Scribe',
      effort: 'm',
    };

    it('the page gets the agent statement, a title, the brief and the one limit', async () => {
      const { service } = ready(statement);
      const detail = await service.detail(ME, 'OPP-0900');
      expect(detail.proposal).toEqual({
        title: 'Carry client names across screens',
        statement: statement.description,
      });
      expect(detail.brief).toMatchObject({
        assessment: { rating: 'promising' },
      });
      expect(detail.textMax).toBe(1000);
    });

    it('an older client that sends no choice files the author text verbatim', async () => {
      const { service, deps, row } = ready(statement);
      filing(deps);
      await service.submit(ME, 'OPP-0900', {
        goalId: 'g1',
        title: 'Keep client names',
      });
      expect(deps.opportunityService.create).toHaveBeenCalledWith(
        ME,
        expect.objectContaining({
          title: 'Keep client names',
          description: 'Counsellors retype names',
        }),
        expect.anything(),
      );
      expect(row().plan.submittedAs).toBe('author');
    });

    it('Use this files the edited statement as the summary under the title, signed, and keeps the author words', async () => {
      const { service, deps, row } = ready(statement);
      filing(deps);
      await service.submit(ME, 'OPP-0900', {
        use: 'agent',
        title: 'Keep client names',
        statement: 'Names typed once carry to every screen.',
      });
      // The title is its own field (#342); the opportunity service stores "title, blank, summary".
      const filed = 'Names typed once carry to every screen.';
      expect(deps.opportunityService.create).toHaveBeenCalledWith(
        ME,
        expect.objectContaining({
          title: 'Keep client names',
          description: filed,
          readinessToken: 'signed',
          interviewTranscript: [
            { role: 'admin', content: 'Counsellors retype names' },
          ],
        }),
        expect.objectContaining({ enforceReadiness: true }),
      );
      expect(deps.readinessToken.issue).toHaveBeenCalledWith(
        expect.objectContaining({ description: filed }),
      );
      expect(row().plan.draftText).toBe('Counsellors retype names');
      expect(row().plan.submittedAs).toBe('agent');
    });

    it('Use this with no agent statement fails closed', async () => {
      const { service, deps } = ready({ ...statement, description: '' });
      filing(deps);
      const error = await service
        .submit(ME, 'OPP-0900', { title: 'A title', use: 'agent' })
        .catch((e) => e);
      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toMatchObject({ code: 'no_statement' });
      expect(deps.opportunityService.create).not.toHaveBeenCalled();
    });

    it('refuses a summary past the one limit', async () => {
      const { service, deps } = ready(statement);
      filing(deps);
      const error = await service
        .submit(ME, 'OPP-0900', {
          title: 'A title',
          use: 'agent',
          statement: 'x'.repeat(1001),
        })
        .catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: 'too_long' });
    });

    /**
     * Until 2026-11-20 an idea the agent could not size was filed unsigned, with its brief and
     * interview kept on the side. An unsized idea is not an idea the board can weigh, so it now
     * waits for its scope line instead.
     */
    it('an idea the agent could not size is not submitted', async () => {
      const { service, deps } = ready(null);
      filing(deps);
      const error = await service
        .submit(ME, 'OPP-0900', { title: 'A title' })
        .catch((e) => e);
      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toMatchObject({ code: 'not_sized' });
      expect(deps.opportunityService.create).not.toHaveBeenCalled();
    });
  });

  describe('the quality bar', () => {
    const idea = (over: Record<string, any> = {}) => ({
      gates: allGates,
      quality: passing,
      brief: { assessment: { rating: 'promising', summary: 's' } },
      draft: { description: 'x', productGoal: 'Scribe', effort: 'm' },
      ...over,
    });
    const filing = (deps: any) =>
      deps.dataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM "roadmap_product_goals"'))
          return [{ id: 'g1', name: 'Scribe' }];
        if (sql.includes("jsonb_build_object('filingAt'"))
          return [[{ id: SESSION }], 1];
        if (sql.includes('count(*)')) return [{ n: 1 }];
        return [];
      });
    const refused = async (over: Record<string, any>) => {
      const { service, deps } = build({
        row: draftRow({ draftGoalId: 'g1', idea: idea(over) }),
      });
      filing(deps);
      const error = await service
        .submit(ME, 'OPP-0900', { title: 'A title' })
        .catch((e) => e);
      expect(deps.opportunityService.create).not.toHaveBeenCalled();
      return error;
    };

    it('signs the score it graded into the token it files with', async () => {
      const { service, deps } = build({
        row: draftRow({ draftGoalId: 'g1', idea: idea() }),
      });
      filing(deps);
      await service.submit(ME, 'OPP-0900', { title: 'A title' });
      expect(deps.readinessToken.issue).toHaveBeenCalledWith(
        expect.objectContaining({ qualityScore: 75 }),
      );
    });

    it('refuses an idea under the bar, saying where it stands and what to work on', async () => {
      const error = await refused({
        quality: { ...passing, score: 58, passed: false, weakest: 'outcome' },
      });
      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toMatchObject({
        code: 'quality_below_bar',
        score: 58,
        passScore: 65,
        weakest: 'outcome',
      });
    });

    it('refuses a draft the agent never graded', async () => {
      const error = await refused({ quality: undefined });
      expect(error.getResponse()).toMatchObject({ code: 'quality_below_bar' });
    });

    it('asks for a split when the agent proposed slices, or the size is XL', async () => {
      const slices = [
        { title: 'a', description: 'a', effort: 's', productGoal: null },
        { title: 'b', description: 'b', effort: 'm', productGoal: null },
      ];
      expect(
        (await refused({ draft: null, slices })).getResponse(),
      ).toMatchObject({
        code: 'needs_split',
      });
      expect(
        (
          await refused({
            draft: { description: 'x', productGoal: 'Scribe', effort: 'xl' },
          })
        ).getResponse(),
      ).toMatchObject({ code: 'needs_split' });
    });

    it('reports canSubmit false until the bar is reached', async () => {
      const { service } = build({
        row: draftRow({
          draftGoalId: 'g1',
          idea: idea({ quality: { ...passing, passed: false, score: 40 } }),
        }),
      });
      expect((await service.detail(ME, 'OPP-0900')).canSubmit).toBe(false);
    });
  });

  describe('Split: one interview, several ideas', () => {
    const slices = [
      {
        title: 'Remind',
        description: 'Reminder slice',
        effort: 's',
        productGoal: 'Scribe',
      },
      {
        title: null,
        description: 'Digest slice',
        effort: 'm',
        productGoal: null,
      },
    ];
    const splittable = (extra: Record<string, any> = {}) =>
      build({
        row: draftRow({
          idea: {
            gates: allGates,
            quality: passing,
            brief: { assessment: { rating: 'promising', summary: 's' } },
            draft: null,
            slices,
            ...extra,
          },
        }),
      });

    it('refuses when the agent proposed no split', async () => {
      const { service } = splittable({ slices: [] });
      const error = await service.split(ME, 'OPP-0900').catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: 'nothing_to_split' });
    });

    it('returns the children untouched when it was already split (idempotent)', async () => {
      const { service, deps } = splittable({
        splitInto: [{ code: 'OPP-0901', title: 'Remind' }],
      });
      const detail = await service.split(ME, 'OPP-0900');
      expect(detail.splitInto).toEqual([{ code: 'OPP-0901', title: 'Remind' }]);
      expect(deps.builderSessions.createSession).not.toHaveBeenCalled();
    });

    it('creates one graded sibling draft per slice and links them from the parent', async () => {
      const { service, deps } = splittable();
      deps.dataSource.query.mockImplementation(async (sql: string) => {
        if (sql.includes("jsonb_build_object('splittingAt'"))
          return [[{ id: SESSION }], 1];
        if (sql.includes('FROM "roadmap_product_goals"'))
          return [{ id: 'g1', name: 'Scribe' }];
        return [];
      });
      const created = jest
        .spyOn(service, 'create')
        .mockResolvedValueOnce({ code: 'OPP-0901', sessionId: 's1' } as any)
        .mockResolvedValueOnce({ code: 'OPP-0902', sessionId: 's2' } as any);

      const detail = await service.split(ME, 'OPP-0900');

      expect(created).toHaveBeenCalledTimes(2);
      expect(created).toHaveBeenNthCalledWith(
        1,
        ME,
        expect.objectContaining({ text: 'Reminder slice' }),
      );
      // Each child starts through the interview: same gates and grade, its own size and words.
      expect(deps.store.patchPlan).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          idea: expect.objectContaining({
            quality: passing,
            splitFrom: 'OPP-0900',
            draft: expect.objectContaining({
              description: 'Reminder slice',
              effort: 's',
            }),
          }),
        }),
      );
      expect(detail.splitInto).toEqual([
        { code: 'OPP-0901', title: 'Remind' },
        { code: 'OPP-0902', title: 'Digest slice' },
      ]);
      // The claim is always released, so a failed split can be tried again.
      expect(
        deps.dataSource.query.mock.calls.some(([sql]) =>
          String(sql).includes("- 'splittingAt'"),
        ),
      ).toBe(true);
    });

    it('a split parent can no longer be submitted', async () => {
      const { service } = splittable({
        draft: { description: 'x', productGoal: 'Scribe', effort: 'm' },
        splitInto: [{ code: 'OPP-0901', title: 'Remind' }],
      });
      const error = await service
        .submit(ME, 'OPP-0900', { title: 'A title' })
        .catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: 'already_split' });
    });
  });

  it('a self-filled draft no longer counts as ready, and Fill it in yourself answers 410', async () => {
    const selfCheck = Object.fromEntries(
      DRAFT_CHECK_ORDER.map((id) => [id, `answer ${id}`]),
    );
    const { service, deps } = build({
      row: draftRow({ draftGoalId: 'g1', idea: { selfCheck } }),
    });
    const error = await service
      .submit(ME, 'OPP-0900', { title: 'A title' })
      .catch((e) => e);
    expect(error.getStatus()).toBe(422);
    expect(deps.opportunityService.create).not.toHaveBeenCalled();
    const gone = await service.selfCheck().catch((e) => e);
    expect(gone.getStatus()).toBe(410);
  });
});
