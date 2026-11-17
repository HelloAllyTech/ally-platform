import { RoadmapMetricsService } from '../roadmap-metrics.service';

/**
 * The service only maps rows; the rules are the util's. These pin the
 * mapping: which timestamp feeds which step, and that a private draft's spend
 * row never carries a title.
 */
describe('RoadmapMetricsService', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date('2026-12-01T00:00:00Z');
  const now = new Date('2026-11-17T12:00:00Z');

  const respond = (sql: string): unknown[] => {
    if (
      sql.includes('FROM "roadmap_opportunities" o') &&
      sql.includes('drafted')
    ) {
      return [
        {
          id: 'o1',
          createdAt: '2026-11-03T00:00:00Z',
          reviewState: 'accepted',
          reviewedAt: '2026-11-04T00:00:00Z',
          stage: 'prioritised',
          releasedAt: null,
          builderSessionId: 's1',
          sessionCreatedAt: '2026-11-02T00:00:00Z',
          drafted: true,
          planClosed: false,
          planningStartedAt: '2026-11-05T00:00:00Z',
          externalBuildAt: null,
        },
        {
          // Filed the legacy way: no draft behind it.
          id: 'o2',
          createdAt: '2026-11-06T00:00:00Z',
          reviewState: null,
          reviewedAt: null,
          stage: 'new',
          releasedAt: null,
          builderSessionId: null,
          sessionCreatedAt: null,
          drafted: null,
          planClosed: false,
          planningStartedAt: null,
          externalBuildAt: null,
        },
      ];
    }
    if (
      sql.includes('FROM "builder_sessions" s') &&
      sql.includes('draftVersion')
    ) {
      return [
        { id: 's1', createdAt: '2026-11-02T00:00:00Z' },
        { id: 's9', createdAt: '2026-11-08T00:00:00Z' }, // still a draft
      ];
    }
    if (sql.includes('FROM "plan_events" e')) {
      return [
        {
          sessionId: 's1',
          planningAt: '2026-11-05T00:00:00Z',
          externalBuildAt: null,
          buildingAt: null,
          shippedAt: null,
        },
      ];
    }
    if (sql.includes('"builder_build_runs"')) {
      return [{ sessionId: 's1', firstRunAt: '2026-11-07T00:00:00Z' }];
    }
    if (sql.includes('"item_linked_prs"')) return [];
    if (sql.includes('"plan_outcome_reviews"')) return [];
    if (sql.includes('"release_policy_log"')) {
      return [
        {
          kind: 'decision',
          mode: 'shadow',
          decision: 'held',
          outcome: null,
          healthy: null,
          service: 'be',
          at: '2026-11-09T00:00:00Z',
        },
      ];
    }
    if (sql.includes('"item_releases"')) return [{ n: 1 }];
    if (sql.includes('FROM "plan_events"') && sql.includes('LIKE')) {
      return [{ n: 0 }];
    }
    if (sql.includes('"plan_spend_entries"')) {
      return [
        {
          sessionId: 's1',
          totalUsd: 2.5,
          approximate: false,
          draftCode: 'OPP-0001',
          code: 'OPP-0001',
          description: 'Course reminders\nMore words',
        },
        {
          sessionId: 's9',
          totalUsd: 0.4,
          approximate: true,
          draftCode: 'OPP-0009',
          code: null,
          description: null,
        },
      ];
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  };

  const make = () => {
    const query = jest.fn(async (sql: string) => respond(sql));
    return {
      query,
      service: new RoadmapMetricsService({ query } as any),
    };
  };

  it('maps rows into the funnel, stage times, releases and spend', async () => {
    const { service } = make();
    const result = await service.compute({ from, to, amberDays: 5, now });

    expect(result.funnel).toEqual({
      captured: 2,
      submitted: 1,
      accepted: 1,
      shipped: 0,
      measured: 0,
      filedWithoutDraft: 1,
    });
    const stage = (key: string) => result.stages.find((s) => s.key === key);
    expect(stage('submitted_accepted')?.medianMs).toBe(86_400_000);
    expect(stage('accepted_planning')?.medianMs).toBe(86_400_000);
    expect(stage('planning_building')?.medianMs).toBe(2 * 86_400_000);
    expect(result.releases.held).toEqual({
      total: 1,
      shadow: 1,
      byService: [{ service: 'be', count: 1 }],
    });
    expect(result.releases.failingIdeasNow).toBe(1);
    expect(result.idleLeadReleases).toBe(0);
    expect(result.spend.top).toEqual([
      {
        code: 'OPP-0001',
        title: 'Course reminders',
        totalUsd: 2.5,
        approximate: false,
      },
      { code: 'OPP-0009', title: null, totalUsd: 0.4, approximate: true },
    ]);
  });

  it('never selects a decline reason, a transcript or a draft text', async () => {
    const { service, query } = make();
    await service.compute({ from, to, amberDays: 5, now });
    const sql = query.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sql).not.toMatch(/declineReason|interviewTranscript|draftText/);
  });
});
