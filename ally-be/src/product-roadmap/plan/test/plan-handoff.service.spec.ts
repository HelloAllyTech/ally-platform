import {
  PlanHandoffService,
  renderStartPlanningBlock,
  START_PLANNING_MARKER,
  StartPlanningFacts,
} from '../plan-handoff.service';
import {
  PLAN_ROADMAP_TOOL_NAMES,
  PlanRoadmapToolsService,
} from '../plan-roadmap-tools.service';
import { builderPlanTools } from 'src/builder/util/builder-plan-tools.registry';

const SESSION = '00000000-0000-4000-8000-000000000001';

const facts = (over: Partial<StartPlanningFacts> = {}): StartPlanningFacts => ({
  date: '2026-11-19',
  code: 'OPP-0100',
  description:
    'Supervisors see review status\n\nThey cannot tell which sessions they reviewed.',
  title: 'Supervisors see review status',
  goal: 'Supervision',
  size: 'm',
  author: 'Asha',
  filedAt: '2026-09-01',
  votes: 3,
  voters: [{ name: 'Ravi', votes: 3 }],
  comments: [],
  similar: [],
  hasFilingRecord: false,
  ...over,
});

describe('renderStartPlanningBlock (audit rec. 5)', () => {
  it('quotes the description as it reads now, dated, with the marker', () => {
    const block = renderStartPlanningBlock(facts());
    expect(block.startsWith(`${START_PLANNING_MARKER} (2026-11-19)`)).toBe(
      true,
    );
    expect(block).toContain(
      'Supervisors see review status\n\nThey cannot tell which sessions they reviewed.',
    );
    expect(block).toContain('**Size:** M');
    expect(block).toContain('3 from 1 person: Ravi (3)');
    expect(block).toContain('filed before the idea interview existed');
    expect(block).toContain('**Comments:** none yet');
    expect(block).toContain('**Similar ideas on the board:** none found');
  });

  it('names comments and similar ideas, and drops the older-idea note when a record exists', () => {
    const block = renderStartPlanningBlock(
      facts({
        hasFilingRecord: true,
        size: null,
        voters: [],
        votes: 0,
        comments: [
          { author: 'Mei', at: '2026-10-01', body: 'Also  on mobile' },
        ],
        similar: [
          {
            code: 'OPP-0200',
            title: 'Review queue',
            stage: 'accepted',
            votes: 2,
            reason: 'same list',
          },
        ],
      }),
    );
    expect(block).not.toContain('filed before the idea interview');
    expect(block).toContain('**Size:** not sized');
    expect(block).toContain('**Votes:** 0, from nobody yet');
    expect(block).toContain('- Mei (2026-10-01): Also on mobile');
    expect(block).toContain(
      '- OPP-0200 (accepted, 2 votes): Review queue — same list',
    );
  });
});

describe('PlanHandoffService.attachAtStart', () => {
  function build(opp: Record<string, any>) {
    const deps = {
      dataSource: {
        query: jest.fn(async (sql: string) =>
          sql.includes('FROM "users"') ? [{ id: 5, name: 'Mei' }] : [opp],
        ),
      },
      builderSessions: {
        attachHandoffContext: jest.fn(async () => true),
        prependHandoffBlock: jest.fn(async () => true),
      },
      reader: {
        detail: jest.fn(async () => ({
          id: 'opp-1',
          code: 'OPP-0100',
          title: 'Supervisors see review status',
          goal: { id: 'g', name: 'Supervision' },
          size: null,
          votes: 2,
          author: { id: 1, name: 'Asha' },
          summary: {},
          declineReason: 'never shown',
        })),
      },
      drafts: {
        similarTo: jest.fn(async () => {
          throw new Error('ally-ai down');
        }),
      },
      opportunities: {
        getVoters: jest.fn(async () => [{ userId: 2, name: 'Ravi', votes: 2 }]),
      },
      comments: {
        list: jest.fn(async () => [
          { createdBy: 5, body: 'Needed', createdAt: new Date('2026-10-02') },
        ]),
      },
    };
    const service = new PlanHandoffService(
      ...(Object.values(deps) as unknown as ConstructorParameters<
        typeof PlanHandoffService
      >),
    );
    return { service, deps };
  }

  it('an older idea gets no filing record, and a block that quotes its description', async () => {
    const { service, deps } = build({
      id: 'opp-1',
      code: 'OPP-0100',
      description: 'Supervisors see review status',
      prd: null,
      brief: null,
      interviewTranscript: null,
      createdAt: new Date('2026-09-01'),
    });
    await service.attachAtStart(
      9,
      'OPP-0100',
      SESSION,
      new Date('2026-11-19T10:00:00Z'),
    );
    expect(deps.builderSessions.attachHandoffContext).not.toHaveBeenCalled();
    const [sessionId, block, marker] = deps.builderSessions.prependHandoffBlock
      .mock.calls[0] as unknown as [string, string, string];
    expect(sessionId).toBe(SESSION);
    expect(marker).toBe(START_PLANNING_MARKER);
    expect(block).toContain('(2026-11-19)');
    expect(block).toContain('Supervisors see review status');
    expect(block).toContain('Ravi (2)');
    expect(block).toContain('- Mei (2026-10-02): Needed');
    // Similar ideas failing never fails the hand-off.
    expect(block).toContain('none found');
    // A decline reason is author-only, never handed to the agent.
    expect(block).not.toContain('never shown');
  });

  it('an idea with a filing record gets it written first when the session has none', async () => {
    const { service, deps } = build({
      id: 'opp-1',
      code: 'OPP-0100',
      description: 'Supervisors see review status',
      prd: null,
      brief: { assessment: { rating: 'strong', summary: 'Clear case' } },
      interviewTranscript: [{ role: 'admin', content: 'my idea' }],
      createdAt: new Date('2026-11-01'),
    });
    await service.attachAtStart(9, 'OPP-0100', SESSION);
    expect(deps.builderSessions.attachHandoffContext).toHaveBeenCalledWith(
      SESSION,
      expect.stringContaining('ADMIN: my idea'),
    );
    const block = deps.builderSessions.prependHandoffBlock.mock
      .calls[0] as unknown as [string, string];
    expect(block[1]).not.toContain('filed before the idea interview');
  });
});

describe('PlanRoadmapToolsService (audit rec. 5)', () => {
  function build(role = 'owner') {
    const deps = {
      dataSource: {
        query: jest.fn(async (sql: string) =>
          sql.includes('code = ANY')
            ? [
                { id: 'a', code: 'OPP-0001', description: 'Visible idea' },
                { id: 'b', code: 'OPP-0002', description: 'Hidden idea' },
              ]
            : sql.includes('FROM "users"')
              ? []
              : [{ description: 'Full text', brief: null }],
        ),
      },
      roles: { roleOf: jest.fn(async () => role) },
      reader: {
        search: jest.fn(async () => ({
          items: [{ code: 'OPP-0002' }],
          recent: [],
        })),
        // The read model drops what the caller may not see (OPP-0002 here).
        rowsFor: jest.fn(async () => [
          {
            id: 'a',
            code: 'OPP-0001',
            title: 'Visible',
            shownStage: 'accepted',
            votes: 4,
            size: 'm',
          },
        ]),
        detail: jest.fn(async () => ({
          id: 'a',
          code: 'OPP-0001',
          title: 'Visible',
          shownStage: 'declined',
          votes: 4,
          size: null,
          plannedMonth: null,
          releasedAt: null,
          declineReason: 'author only',
        })),
      },
      copilotTools: {
        execute: jest.fn(async (name: string) => ({
          modelResult:
            name === 'search_roadmap'
              ? JSON.stringify({ ok: true, matches: [{ code: 'OPP-0001' }] })
              : JSON.stringify({
                  ok: true,
                  interviews: [{ title: 'Supervisor call' }],
                }),
          summary: '1 interview note',
          ok: true,
        })),
      },
      comments: { list: jest.fn(async () => []) },
    };
    const service = new PlanRoadmapToolsService(
      ...(Object.values(deps) as unknown as ConstructorParameters<
        typeof PlanRoadmapToolsService
      >),
    );
    return { service, deps };
  }
  const ctx = { session: { id: SESSION, kind: 'plan' } as any, userId: 9 };

  afterEach(() => builderPlanTools.clear());

  it('registers three read-only tools into the plan-session belt', () => {
    const { service } = build();
    service.onModuleInit();
    expect(builderPlanTools.definitions().map((t) => t.name)).toEqual(
      Object.values(PLAN_ROADMAP_TOOL_NAMES),
    );
    expect(builderPlanTools.providerFor('read_roadmap_idea')).toBe(service);
    expect(builderPlanTools.providerFor('update_prd')).toBeNull();
  });

  it('search returns only ideas the caller can read', async () => {
    const { service } = build();
    const out = await service.execute(
      PLAN_ROADMAP_TOOL_NAMES.SEARCH,
      { query: 'review' },
      ctx,
    );
    expect(out.modelResult.matches).toEqual([
      expect.objectContaining({
        code: 'OPP-0001',
        description: 'Visible idea',
      }),
    ]);
  });

  it('reading an idea never returns its decline reason', async () => {
    const { service } = build();
    const out = await service.execute(
      PLAN_ROADMAP_TOOL_NAMES.READ,
      { code: 'opp-0001' },
      ctx,
    );
    expect(out.modelResult.ok).toBe(true);
    expect(out.modelResult.idea.description).toBe('Full text');
    expect(JSON.stringify(out.modelResult)).not.toContain('author only');
  });

  it('interview notes reuse the idea agent lookup', async () => {
    const { service, deps } = build();
    const out = await service.execute(
      PLAN_ROADMAP_TOOL_NAMES.NOTES,
      { query: 'supervisor' },
      ctx,
    );
    expect(deps.copilotTools.execute).toHaveBeenCalledWith(
      'search_user_interviews',
      { query: 'supervisor' },
      { userId: 9 },
    );
    expect(out.modelResult.interviews).toHaveLength(1);
  });

  it('a caller with no Roadmap access reads nothing', async () => {
    const { service, deps } = build('none');
    const out = await service.execute(
      PLAN_ROADMAP_TOOL_NAMES.SEARCH,
      { query: 'x' },
      ctx,
    );
    expect(out.modelResult.ok).toBe(false);
    expect(deps.reader.search).not.toHaveBeenCalled();
  });
});
