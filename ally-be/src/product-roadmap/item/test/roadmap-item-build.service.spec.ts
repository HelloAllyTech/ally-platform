import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PlanEventKind } from 'src/product-planning/enum/product-planning.enum';
import { RoadmapItemBuildService } from '../roadmap-item-build.service';

const SPEND = 'SENTINEL-SPEND';
const TRANSCRIPT = 'SENTINEL-TRANSCRIPT';
const RANK = 'SENTINEL-WHY-RANKS';

function build(
  opts: {
    canExport?: boolean;
    session?: string | null;
    can?: Record<string, boolean>;
    releases?: { state: string; releasedAt?: string }[];
    shownStage?: string;
  } = {},
) {
  const detail = {
    code: 'OPP-0388',
    title: 'Streak reminders',
    summary: {
      problem: 'Learners forget',
      outcome: 'More return',
      whyRanks: { rationale: RANK },
    },
    spend: { spentUsd: SPEND, ceilingUsd: 100 },
    can: { exportBrief: opts.canExport ?? true, ...(opts.can ?? {}) },
    releases: opts.releases ?? [],
    shownStage: opts.shownStage ?? 'building',
  };
  const reader = { detail: jest.fn(async () => detail) };
  const ref = {
    id: 'o-1',
    code: 'OPP-0388',
    createdBy: 3,
    builderSessionId: opts.session === undefined ? 's-1' : opts.session,
  };
  const lookup = { get: jest.fn(async () => ref) };
  const planStore = {
    find: jest.fn(async (id: string) => ({
      id,
      createdBy: 3,
      plan: { successMeasure: { metric: 'Return', target: '52%' } },
    })),
    patchPlan: jest.fn(async () => undefined),
  };
  const builderSessions = {
    getSessionDetail: jest.fn(async () => ({
      messages: [{ content: TRANSCRIPT }],
      totalCostUsd: SPEND,
      prd: {
        problem: 'PRD problem',
        requirements: [
          {
            id: 'R1',
            title: 'Remind',
            description: 'd',
            acceptanceCriteria: ['once'],
          },
        ],
        technicalDesign: {
          status: 'approved',
          designMd: 'Design body',
          scope: [],
        },
      },
      designReadiness: { stale: false },
    })),
  };
  const events = { record: jest.fn(async () => undefined) };
  const inbox = { markSeen: jest.fn(async () => undefined) };
  const notifications = { emit: jest.fn() };
  const stage = { sync: jest.fn(async () => null) };
  const dataSource = { query: jest.fn(async () => [{ id: 'opp-1' }]) };
  const service = new RoadmapItemBuildService(
    reader as never,
    lookup as never,
    builderSessions as never,
    planStore as never,
    events as never,
    inbox as never,
    notifications as never,
    stage as never,
    dataSource as never,
  );
  return {
    service,
    reader,
    planStore,
    builderSessions,
    events,
    notifications,
    stage,
    dataSource,
  };
}

describe('RoadmapItemBuildService', () => {
  it('builds the brief from the allowlist only, with its length and deep-link fit', async () => {
    const { service } = build();
    const brief = await service.brief(7, 'OPP-0388');
    expect(brief.markdown).toContain('PRD problem');
    expect(brief.markdown).toContain('Design body');
    expect(brief.markdown).toContain('Return: 52%');
    for (const sentinel of [SPEND, TRANSCRIPT, RANK]) {
      expect(brief.markdown).not.toContain(sentinel);
    }
    expect(brief).toMatchObject({
      code: 'OPP-0388',
      length: brief.markdown.length,
      fitsDeepLink: true,
      filename: 'OPP-0388-brief.md',
      branch: 'opp-0388-streak-reminders',
      prTitle: 'OPP-0388: Streak reminders',
    });
  });

  it('says a brief over 14,000 characters does not fit a deep link', async () => {
    const built = build();
    built.builderSessions.getSessionDetail.mockResolvedValueOnce({
      prd: {
        technicalDesign: { status: 'approved', designMd: 'x'.repeat(15000) },
      },
      designReadiness: { stale: false },
    } as never);
    const brief = await built.service.brief(7, 'OPP-0388');
    expect(brief.length).toBeGreaterThan(14000);
    expect(brief.fitsDeepLink).toBe(false);
  });

  it('refuses anyone who cannot start the build', async () => {
    const { service, planStore } = build({ canExport: false });
    await expect(service.brief(7, 'OPP-0388')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.recordExternalBuild(7, 'OPP-0388'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(planStore.patchPlan).not.toHaveBeenCalled();
  });

  it('records "Brief sent to Claude Code" on the plan, as an event, and tells open queues', async () => {
    const { service, planStore, events, notifications, reader } = build();
    await service.recordExternalBuild(7, 'OPP-0388');
    expect(planStore.patchPlan).toHaveBeenCalledWith('s-1', {
      externalBuild: {
        tool: 'claude_code',
        byUserId: 7,
        at: expect.any(String),
      },
    });
    expect(events.record).toHaveBeenCalledWith({
      sessionId: 's-1',
      kind: PlanEventKind.EXTERNAL_BUILD,
      actorUserId: 7,
      detail: { tool: 'claude_code' },
    });
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ITEM_CHANGED',
        fields: ['externalBuild'],
      }),
    );
    expect(reader.detail).toHaveBeenCalledTimes(2);
  });

  it('refuses an idea with no plan session', async () => {
    const { service } = build({ session: null });
    await expect(
      service.recordExternalBuild(7, 'OPP-0388'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('build mode', () => {
    it('lets the assigned builder pick and switch it, with an event each time it changes', async () => {
      const { service, planStore, events, notifications } = build({
        can: { setBuildMode: true },
      });
      await service.setBuildMode(5, 'OPP-0388', 'builder_agent');
      expect(planStore.patchPlan).toHaveBeenCalledWith('s-1', {
        buildMode: expect.objectContaining({
          mode: 'builder_agent',
          byUserId: 5,
        }),
      });
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PlanEventKind.BUILD_MODE_SET,
          detail: { from: null, to: 'builder_agent' },
        }),
      );
      expect(notifications.emit).toHaveBeenCalled();
    });

    it('records nothing when the mode is unchanged', async () => {
      const { service, planStore, events } = build({
        can: { setBuildMode: true },
      });
      planStore.find.mockResolvedValueOnce({
        id: 's-1',
        createdBy: 3,
        plan: { buildMode: { mode: 'outside', byUserId: 5, at: 'x' } },
      } as never);
      await service.setBuildMode(5, 'OPP-0388', 'outside');
      expect(planStore.patchPlan).not.toHaveBeenCalled();
      expect(events.record).not.toHaveBeenCalled();
    });

    it('refuses anyone but the assigned builder or an Owner', async () => {
      const { service } = build({ can: { setBuildMode: false } });
      await expect(
        service.setBuildMode(5, 'OPP-0388', 'outside'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sending the brief to Claude Code makes it built outside', async () => {
      const { service, events } = build();
      await service.recordExternalBuild(5, 'OPP-0388');
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PlanEventKind.BUILD_MODE_SET,
          detail: { from: null, to: 'outside' },
        }),
      );
    });
  });

  describe('mark released', () => {
    it("is a person's click: moves the stage, stamps when the work went live, records it", async () => {
      const { service, dataSource, events, stage } = build({
        can: { markReleased: true },
        releases: [
          { state: 'live', releasedAt: '2026-11-10T08:00:00.000Z' },
          { state: 'live', releasedAt: '2026-11-12T08:00:00.000Z' },
        ],
      });
      await service.markReleased(5, 'OPP-0388');
      const [sql, params] = dataSource.query.mock.calls[0] as unknown as [
        string,
        unknown[],
      ];
      expect(sql).toContain(`stage IN ('new', 'prioritised')`);
      expect(params).toEqual(['o-1', '2026-11-12T08:00:00.000Z', 5]);
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: PlanEventKind.MARKED_RELEASED,
          actorUserId: 5,
        }),
      );
      expect(stage.sync).toHaveBeenCalledWith('s-1', 5);
    });

    it('stamps now when not every release is live', async () => {
      const { service, dataSource } = build({
        can: { markReleased: true },
        releases: [{ state: 'pending' }],
      });
      await service.markReleased(5, 'OPP-0388');
      expect((dataSource.query.mock.calls[0] as unknown[])[1]).toEqual([
        'o-1',
        null,
        5,
      ]);
    });

    it('refuses anyone but the assigned builder or an Owner', async () => {
      const { service, dataSource } = build({ can: { markReleased: false } });
      await expect(service.markReleased(5, 'OPP-0388')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('says so when someone else moved it a moment ago', async () => {
      const { service, dataSource } = build({ can: { markReleased: true } });
      dataSource.query.mockResolvedValueOnce([] as never);
      await expect(service.markReleased(5, 'OPP-0388')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
