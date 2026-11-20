import { deriveItemStage } from 'src/product-planning/util/plan-stage.util';
import {
  ciState,
  itemStageFacts,
  latest,
  mergePrs,
  OpportunityFacts,
  SessionFacts,
  stageSinceOf,
} from '../roadmap-item-facts.util';

const opp = (over: Partial<OpportunityFacts> = {}): OpportunityFacts => ({
  stage: 'new',
  reviewState: 'accepted',
  reviewedBy: 9,
  reviewedAt: '2026-11-03T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  releasedAt: null,
  votes: 6,
  ...over,
});

const session = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  id: 's1',
  kind: 'plan',
  status: 'INTERVIEWING',
  visibility: 'shared',
  createdBy: 1,
  leadUserId: null,
  planStage: 'filed',
  planStageAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
  lastRunSequence: 0,
  repos: [],
  closed: null,
  launchedAt: null,
  reviews: null,
  externalBuild: null,
  planningStarted: null,
  totalCostUsd: 0,
  budgetUsd: null,
  ...over,
});

const planning = {
  prdPercent: null,
  openQuestions: 0,
  designAwaitingApproval: false,
};

const stageOf = (
  o: OpportunityFacts,
  s: SessionFacts | null,
  extra: Partial<Parameters<typeof itemStageFacts>[0]> = {},
) =>
  deriveItemStage(
    itemStageFacts({
      opportunity: o,
      session: s,
      planning,
      prs: [],
      releases: [],
      ...extra,
    }),
  );

describe('itemStageFacts → deriveItemStage (rows read the stage mirror)', () => {
  it('shows a pending review as Submitted', () => {
    expect(stageOf(opp({ reviewState: 'pending' }), null).shownStage).toBe(
      'submitted',
    );
  });

  it('shows an accepted idea with no lead as Accepted, needing a lead', () => {
    const stage = stageOf(opp(), session());
    expect(stage.shownStage).toBe('accepted');
    expect(stage.statusParts).toMatchObject({ needsLead: true });
  });

  it('reads PRD and design from the mirror', () => {
    expect(
      stageOf(opp(), session({ leadUserId: 2, planStage: 'prd' })).statusParts,
    ).toMatchObject({ stage: 'planning', step: 'prd', leadUserId: 2 });
    expect(
      stageOf(opp(), session({ leadUserId: 2, planStage: 'ready' }))
        .statusParts,
    ).toMatchObject({ stage: 'planning', step: 'ready' });
  });

  it('shows Building from the run, with open PRs and their CI', () => {
    const stage = stageOf(
      opp(),
      session({ leadUserId: 2, planStage: 'building', lastRunSequence: 1 }),
      {
        prs: [
          {
            repo: 'ally-platform',
            number: 412,
            url: 'u',
            state: 'open',
            ci: 'passing',
          },
          {
            repo: 'ally-platform',
            number: 400,
            url: 'u',
            state: 'merged',
            ci: 'passing',
          },
        ],
      },
    );
    expect(stage.statusParts).toMatchObject({
      stage: 'building',
      openPrs: [{ number: 412, ci: 'passing' }],
      mergedPrs: 1,
    });
  });

  it('reads a legacy Builder session (no plan) as planning, then building', () => {
    expect(
      stageOf(opp(), session({ kind: 'build', planStage: null })).shownStage,
    ).toBe('planning');
    expect(
      stageOf(opp(), session({ kind: 'build', status: 'COMPLETED' }))
        .shownStage,
    ).toBe('building');
  });

  it('marks it releasing while a merged PR waits for its service release', () => {
    const stage = stageOf(
      opp(),
      session({ leadUserId: 2, planStage: 'building', lastRunSequence: 1 }),
      {
        prs: [
          { repo: 'r', number: 1, url: 'u', state: 'merged', ci: 'passing' },
        ],
        releases: [
          {
            repo: 'r',
            prNumber: 1,
            service: 'be',
            state: 'pending',
            tag: null,
            releasedAt: null,
          },
        ],
      },
    );
    expect(stage.statusParts).toMatchObject({ releasing: true });
  });

  it('shows a released idea as Shipped since its release', () => {
    const stage = stageOf(
      opp({ stage: 'released', releasedAt: '2026-11-14T00:00:00.000Z' }),
      null,
    );
    expect(stage.statusParts).toMatchObject({
      stage: 'shipped',
      liveSince: '2026-11-14T00:00:00.000Z',
    });
  });

  it('keeps Declined over everything, and Closed over progress', () => {
    expect(
      stageOf(opp({ reviewState: 'declined' }), session({ planStage: 'ready' }))
        .shownStage,
    ).toBe('declined');
    expect(
      stageOf(
        opp(),
        session({
          leadUserId: 2,
          planStage: 'prd',
          closed: { at: '2026-11-09T00:00:00.000Z', by: 2 },
        }),
      ).statusParts,
    ).toMatchObject({ stage: 'closed', reason: 'not_pursuing', byUserId: 2 });
  });
});

describe('stageSinceOf', () => {
  it('dates each stage from the fact that started it', () => {
    const o = { ...opp(), updatedAt: '2026-11-20T00:00:00.000Z' };
    expect(stageSinceOf(stageOf(o, session()), o, session())).toBe(
      '2026-11-03T00:00:00.000Z',
    );
    const led = session({ leadUserId: 2, planStage: 'prd' });
    expect(stageSinceOf(stageOf(o, led), o, led)).toBe(
      '2026-11-06T00:00:00.000Z',
    );
    const pending = { ...o, reviewState: 'pending' };
    expect(stageSinceOf(stageOf(pending, null), pending, null)).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
});

describe('helpers', () => {
  it('words the CI rollup', () => {
    expect(ciState('success')).toBe('passing');
    expect(ciState('failure')).toBe('failing');
    expect(ciState('pending')).toBe('pending');
    expect(ciState('none')).toBe('unknown');
    expect(ciState(null)).toBe('unknown');
  });

  it('merges Builder and linked PRs by repo name and number, Builder first', () => {
    const merged = mergePrs(
      [
        {
          repo: 'ally-platform',
          number: 7,
          url: 'b',
          state: 'open',
          ci: 'failing',
        },
      ],
      [
        {
          repo: 'Org/ally-platform',
          number: 7,
          url: 'l',
          state: 'open',
          ci: 'unknown',
        },
        {
          repo: 'Org/ally-platform',
          number: 8,
          url: 'l',
          state: 'merged',
          ci: 'unknown',
        },
      ],
    );
    expect(merged.map((p) => [p.number, p.url])).toEqual([
      [7, 'b'],
      [8, 'l'],
    ]);
  });

  it('takes the latest of several instants', () => {
    expect(latest('2026-11-01', null, new Date('2026-11-05T00:00:00Z'))).toBe(
      '2026-11-05T00:00:00.000Z',
    );
  });
});
