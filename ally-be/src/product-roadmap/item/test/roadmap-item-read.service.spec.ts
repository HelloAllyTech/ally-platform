import { ForbiddenException } from '@nestjs/common';
import { RoadmapItemReadService } from '../roadmap-item-read.service';
import { parseItemQuery } from '../roadmap-item-query.util';

/**
 * The read model against a fake DataSource that answers by SQL shape. The
 * board's projection and the v2 facts are both stubbed; what is under test is
 * the assembly: stages, sections, why-here, role checks and what each role
 * may read.
 */

const ME = 5;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface Fixture {
  base: Record<string, unknown>;
  facts: Record<string, unknown>;
}

const item = (
  n: number,
  base: Record<string, unknown> = {},
  facts: Record<string, unknown> = {},
): Fixture => {
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  return {
    base: {
      id,
      code: `OPP-${String(n).padStart(4, '0')}`,
      description: `Idea ${n}\n\nWhy it matters ${n}`,
      type: 'idea',
      createdBy: 1,
      stage: 'new',
      createdAt: ago(30),
      updatedAt: ago(20),
      releasedAt: null,
      priorityScore: n,
      voterCount: 1,
      goalsHelped: 0,
      goalsAssessed: 0,
      compositeScore: 10 * n,
      queueRank: n,
      directorStarred: false,
      plannedMonth: null,
      referenceImages: [],
      productGoal: 'Growth',
      builderSessionId: null,
      brief: null,
      ...base,
    },
    facts: {
      id,
      reviewState: 'accepted',
      reviewedBy: 9,
      reviewedAt: ago(25),
      declineReason: null,
      starredByUserId: null,
      goalId: 'g1',
      goalName: 'Growth',
      sessionId: null,
      watchLevel: null,
      lastSeenAt: null,
      votedByMe: false,
      lastCommentAt: null,
      ...facts,
    },
  };
};

const planSession = (id: string, over: Record<string, unknown> = {}) => ({
  sessionId: id,
  sessionKind: 'plan',
  sessionStatus: 'INTERVIEWING',
  sessionVisibility: 'shared',
  sessionCreatedBy: 1,
  leadUserId: null,
  sessionPlanStage: 'filed',
  sessionPlanStageAt: ago(10),
  sessionUpdatedAt: ago(10),
  lastRunSequence: 0,
  sessionRepos: [],
  totalCostUsd: '0',
  budgetUsd: null,
  planClosed: null,
  launchedAt: null,
  planReviews: null,
  externalBuild: null,
  planningStarted: null,
  ...over,
});

function build(
  fixtures: Fixture[],
  opts: {
    roles?: Record<number, string>;
    decisions?: Record<string, unknown>[];
    reads?: { itemId: string }[];
  } = {},
) {
  const roleOf = jest.fn(
    async (id: number) => opts.roles?.[id] ?? (id === ME ? 'idea' : 'builder'),
  );
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM "roadmap_opportunities" o')) {
        return fixtures.map((f) => f.facts);
      }
      if (sql.includes('FROM "users"')) {
        return [1, 2, 3, 9, ME].map((id) => ({ id, name: `Person ${id}` }));
      }
      if (sql.includes('FROM "roadmap_item_reads"')) return opts.reads ?? [];
      if (sql.includes('AS shipped')) return [{ userId: 1, shipped: '3' }];
      if (sql.includes('SELECT "createdBy" FROM "builder_sessions"')) {
        return [{ createdBy: 1 }];
      }
      return [];
    }),
  };
  const opportunities = {
    listOpportunities: jest.fn(async () => ({
      items: fixtures.map((f) => f.base),
      count: fixtures.length,
      maxScore: 0,
    })),
    findOneWithScore: jest.fn(
      async (id: string) => fixtures.find((f) => f.base.id === id)?.base,
    ),
  };
  const decisions = {
    listPending: jest.fn(async () => opts.decisions ?? []),
    listPendingForSession: jest.fn(async (sessionId: string) =>
      (opts.decisions ?? []).filter((d) => d.sessionId === sessionId),
    ),
  };
  const builderSessions = {
    getSessionDetail: jest.fn(async () => ({
      readiness: { score: 70 },
      prdVersionNumber: 3,
      prd: { technicalDesign: { status: 'review' } },
      designReadiness: { stale: false },
    })),
  };
  const ceiling = {
    state: jest.fn(async () => ({ spentUsd: 6.5, ceilingUsd: 100 })),
  };
  const lookup = {
    get: jest.fn(async (code: string) => {
      const f = fixtures.find((x) => x.base.code === code);
      return {
        id: f?.base.id,
        code,
        createdBy: 1,
        builderSessionId: f?.base.builderSessionId ?? null,
      };
    }),
  };
  const service = new RoadmapItemReadService(
    dataSource as never,
    opportunities as never,
    { getRankContext: jest.fn(async () => ({})) } as never,
    { roleOf } as never,
    decisions as never,
    builderSessions as never,
    { find: jest.fn(async () => null) } as never,
    { facts: jest.fn() } as never,
    ceiling as never,
    lookup as never,
  );
  return { service, dataSource, decisions, roleOf };
}

describe('RoadmapItemReadService.list', () => {
  it('checks the role per view', async () => {
    const { service } = build([item(1)]);
    await expect(
      service.list(ME, parseItemQuery({ view: 'leading' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const builder = build([item(1)], { roles: { [ME]: 'builder' } });
    await expect(
      builder.service.list(ME, parseItemQuery({ view: 'to-triage' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const none = build([item(1)], { roles: { [ME]: 'none' } });
    await expect(
      none.service.list(ME, parseItemQuery({ view: 'all' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('pages All ideas by rank with a cursor and a total', async () => {
    const fixtures = [item(3), item(1), item(2)];
    const { service } = build(fixtures);
    const first = (await service.list(
      ME,
      parseItemQuery({ view: 'all', limit: '2' }),
    )) as { rows: { code: string }[]; nextCursor?: string; total: number };
    expect(first.rows.map((r) => r.code)).toEqual(['OPP-0001', 'OPP-0002']);
    expect(first.total).toBe(3);
    const second = (await service.list(
      ME,
      parseItemQuery({ view: 'all', limit: '2', cursor: first.nextCursor }),
    )) as { rows: { code: string }[]; nextCursor?: string };
    expect(second.rows.map((r) => r.code)).toEqual(['OPP-0003']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('builds For you: the lead’s decision, own ideas, watched ideas, recent ships', async () => {
    const led = item(
      1,
      { builderSessionId: 's1' },
      planSession('s1', {
        leadUserId: ME,
        sessionPlanStage: 'building',
        lastRunSequence: 1,
      }),
    );
    const mine = item(2, { createdBy: ME });
    const voted = item(3, {}, { votedByMe: true });
    const shipped = item(4, { stage: 'released', releasedAt: ago(2) });
    const oldShip = item(5, { stage: 'released', releasedAt: ago(40) });
    const unrelated = item(6);
    const { service } = build([led, mine, voted, shipped, oldShip, unrelated], {
      roles: { [ME]: 'builder' },
      decisions: [
        {
          sessionId: 's1',
          kind: 'pr_merge',
          waitingSince: ago(1),
          prompt: 'Merge?',
        },
      ],
    });
    const result = (await service.list(
      ME,
      parseItemQuery({ view: 'for-you' }),
    )) as unknown as {
      sections: Record<string, { code: string; whyHere?: unknown }[]>;
    };
    const codes = (k: string) => result.sections[k].map((r) => r.code);
    expect(codes('needsYou')).toEqual(['OPP-0001']);
    expect(result.sections.needsYou[0].whyHere).toMatchObject({
      kind: 'decision',
      decision: 'merge',
    });
    expect(codes('yourIdeas')).toEqual(['OPP-0002']);
    expect(codes('watching')).toEqual(['OPP-0003']);
    expect(codes('recentlyShipped')).toEqual(['OPP-0004']);
  });

  it('puts an agent question on a watched-on-All idea in Needs you, with a preview', async () => {
    const watched = item(
      1,
      { builderSessionId: 's1' },
      {
        ...planSession('s1', { leadUserId: 2, sessionPlanStage: 'prd' }),
        watchLevel: 'all',
      },
    );
    const { service } = build([watched], {
      decisions: [
        {
          sessionId: 's1',
          kind: 'question',
          waitingSince: ago(3),
          prompt: 'Which learners see the streak first?',
        },
      ],
    });
    const result = (await service.list(
      ME,
      parseItemQuery({ view: 'for-you' }),
    )) as unknown as {
      sections: Record<string, { whyHere?: unknown; statusParts: unknown }[]>;
    };
    expect(result.sections.needsYou[0].whyHere).toMatchObject({
      kind: 'agentQuestion',
      phase: 'plan',
      questionPreview: 'Which learners see the streak first?',
    });
    expect(result.sections.needsYou[0].statusParts).toMatchObject({
      stage: 'planning',
      openQuestions: 1,
    });
  });

  it('builds To triage for an Owner: one Backlog list, never an idea someone leads', async () => {
    const pending = item(1, {}, { reviewState: 'pending' });
    const noLead = item(2, { builderSessionId: 's2' }, planSession('s2'));
    const idle = item(
      3,
      { builderSessionId: 's3' },
      planSession('s3', {
        leadUserId: 2,
        sessionPlanStage: 'prd',
        sessionUpdatedAt: ago(9),
      }),
    );
    const busy = item(
      4,
      { builderSessionId: 's4' },
      planSession('s4', {
        leadUserId: 2,
        sessionPlanStage: 'prd',
        sessionUpdatedAt: ago(1),
      }),
    );
    const { service } = build([pending, noLead, idle, busy], {
      roles: { [ME]: 'owner' },
    });
    const result = (await service.list(
      ME,
      parseItemQuery({ view: 'to-triage' }),
    )) as unknown as {
      sections: Record<string, { code: string; whyHere?: any }[]>;
    };
    // One Backlog list: the unreviewed idea and the accepted one with no lead. The led ideas
    // (idle or busy) are Being built: Leading shows them, To triage does not.
    expect(Object.keys(result.sections)).toEqual(['backlog']);
    expect(result.sections.backlog.map((r) => r.code).sort()).toEqual([
      'OPP-0001',
      'OPP-0002',
    ]);
    const why = Object.fromEntries(
      result.sections.backlog.map((r) => [r.code, r.whyHere?.kind]),
    );
    expect(why).toEqual({
      'OPP-0001': 'awaitingReview',
      'OPP-0002': 'needsLead',
    });
  });

  it('filters to the ideas the person leads, wrote, or that wait on them', async () => {
    const mineAuthored = item(1, { createdBy: ME });
    const ledByMe = item(
      2,
      { builderSessionId: 's2' },
      planSession('s2', { leadUserId: ME, sessionPlanStage: 'prd' }),
    );
    const other = item(3);
    const waiting = item(
      4,
      { builderSessionId: 's4' },
      planSession('s4', { leadUserId: ME, sessionPlanStage: 'prd' }),
    );
    const { service } = build([mineAuthored, ledByMe, other, waiting], {
      decisions: [
        {
          sessionId: 's4',
          kind: 'question',
          waitingSince: ago(1),
          prompt: 'Which learners first?',
        },
      ],
    });
    const codes = async (q: Record<string, string>) =>
      (
        (await service.list(ME, parseItemQuery({ view: 'all', ...q }))) as {
          rows: { code: string }[];
        }
      ).rows
        .map((r) => r.code)
        .sort();
    expect(await codes({ wroteByMe: '1' })).toEqual(['OPP-0001']);
    expect(await codes({ ledByMe: '1' })).toEqual(['OPP-0002', 'OPP-0004']);
    expect(await codes({ needsYou: '1' })).toEqual(['OPP-0004']);
  });

  it('marks a row unread only when something happened since it was opened', async () => {
    const seenThenChanged = item(
      1,
      { updatedAt: ago(1) },
      { lastSeenAt: ago(2) },
    );
    const seen = item(2, { updatedAt: ago(5) }, { lastSeenAt: ago(2) });
    const neverOpened = item(3);
    const { service } = build([seenThenChanged, seen, neverOpened]);
    const result = (await service.list(
      ME,
      parseItemQuery({ view: 'all' }),
    )) as {
      rows: { code: string; unread: boolean }[];
    };
    expect(
      Object.fromEntries(result.rows.map((r) => [r.code, r.unread])),
    ).toEqual({ 'OPP-0001': true, 'OPP-0002': false, 'OPP-0003': false });
  });

  it('names people with their role, never a bare id', async () => {
    const { service } = build([
      item(
        1,
        { builderSessionId: 's1' },
        planSession('s1', {
          leadUserId: 2,
          sessionPlanStage: 'prd',
        }),
      ),
    ]);
    const result = (await service.list(
      ME,
      parseItemQuery({ view: 'all' }),
    )) as {
      rows: { author: unknown; lead: unknown }[];
    };
    expect(result.rows[0].author).toEqual({
      id: 1,
      name: 'Person 1',
      role: 'builder',
      relation: 'author',
      // Released ideas they filed (§4.14), counted once for the page.
      ideasShipped: 3,
    });
    expect(result.rows[0].lead).toMatchObject({
      id: 2,
      relation: 'lead',
      ideasShipped: 0,
    });
  });
});

describe('RoadmapItemReadService.detail', () => {
  const planned = () =>
    item(
      1,
      { builderSessionId: 's1' },
      planSession('s1', { leadUserId: 2, sessionPlanStage: 'design' }),
    );

  it('returns the whole page for the Idea role: PRD, design, spend, can{}', async () => {
    const { service } = build([planned()]);
    const detail = await service.detail(ME, 'OPP-0001');
    expect(detail).toMatchObject({
      code: 'OPP-0001',
      title: 'Idea 1',
      shownStage: 'planning',
      sessionId: 's1',
      prd: { readinessPct: 70, versionNumber: 3 },
      design: { state: 'awaitingApproval' },
      spend: { spentUsd: 6.5, ceilingUsd: 100 },
      summary: { problem: 'Why it matters 1' },
      reviewState: 'accepted',
      watchLevel: 'none',
    });
    expect(detail.can).toMatchObject({
      vote: true,
      answer: true,
      approveDesign: false,
      editTitle: false,
      editLead: false,
    });
    expect(detail.people.map((p) => p.relation)).toEqual([
      'author',
      'lead',
      'owner',
    ]);
  });

  it('gives the lead the design approval and the inline edits', async () => {
    const { service } = build([planned()], { roles: { [ME]: 'builder' } });
    const fixtures = [
      item(
        1,
        { builderSessionId: 's1' },
        planSession('s1', { leadUserId: ME, sessionPlanStage: 'design' }),
      ),
    ];
    const lead = build(fixtures, { roles: { [ME]: 'builder' } });
    const detail = await lead.service.detail(ME, 'OPP-0001');
    expect(detail.can).toMatchObject({
      approveDesign: true,
      editTitle: true,
      editSummary: true,
      editLead: false,
      editMonth: false,
    });
    expect((await service.detail(ME, 'OPP-0001')).can.editTitle).toBe(false);
  });

  it('shows a Viewer the board facts only (D2)', async () => {
    const { service } = build([planned()], { roles: { [ME]: 'viewer' } });
    const detail = await service.detail(ME, 'OPP-0001');
    expect(detail.sessionId).toBeUndefined();
    expect(detail.prd).toBeUndefined();
    expect(detail.design).toBeUndefined();
    expect(detail.spend).toBeUndefined();
    expect(detail.runs).toEqual([]);
    expect(detail.can.answer).toBe(false);
  });

  it('shows a decline reason to the author and Owners only', async () => {
    const declined = (createdBy: number) => [
      item(
        1,
        { createdBy },
        {
          reviewState: 'declined',
          declineReason: 'Overlaps OPP-0212',
        },
      ),
    ];
    const other = await build(declined(1)).service.detail(ME, 'OPP-0001');
    expect(other.shownStage).toBe('declined');
    expect(other.declineReason).toBeUndefined();
    const author = await build(declined(ME)).service.detail(ME, 'OPP-0001');
    expect(author.declineReason).toBe('Overlaps OPP-0212');
    const owner = await build(declined(1), {
      roles: { [ME]: 'owner' },
    }).service.detail(ME, 'OPP-0001');
    expect(owner.declineReason).toBe('Overlaps OPP-0212');
  });

  it('is 404 for a bug report', async () => {
    const { service } = build([item(1, { type: 'bug' })]);
    await expect(service.detail(ME, 'OPP-0001')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('RoadmapItemReadService.search', () => {
  it('finds by code and title, exact code first', async () => {
    const { service } = build([
      item(12, { description: 'Mentions 7 learners' }),
      item(7),
    ]);
    const result = await service.search(ME, '7');
    expect(result.items.map((r) => r.code)).toEqual(['OPP-0007', 'OPP-0012']);
    expect(result.recent).toEqual([]);
  });

  it('returns the caller’s recent ideas when q is empty: opened, then their own', async () => {
    const fixtures = [item(1), item(2, { createdBy: ME }), item(3)];
    const { service } = build(fixtures, {
      reads: [{ itemId: fixtures[2].base.id as string }],
    });
    const result = await service.search(ME, '');
    expect(result.items).toEqual([]);
    expect(result.recent.map((r) => r.code)).toEqual(['OPP-0003', 'OPP-0002']);
  });
});
