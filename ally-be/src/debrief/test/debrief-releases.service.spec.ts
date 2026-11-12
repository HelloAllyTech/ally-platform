import { ConflictException } from '@nestjs/common';
import { DebriefReleasesService } from '../service/debrief-releases.service';

/**
 * Releases lists only releases that have been live, each with where it came
 * from and why it was retired. v1 (seed) was replaced by v2 (an idea), which
 * was rolled back to v1.
 */
function build() {
  const releases = [
    {
      id: 'r2',
      version: 2,
      status: 'retired',
      authorKind: 'human',
      notes: 'PM agent idea (canary): x',
      promotedAt: '2026-11-05',
    },
    {
      id: 'r1',
      version: 1,
      status: 'ga',
      authorKind: 'seed',
      notes: 'Seeded',
      promotedAt: '2026-11-01',
    },
  ];
  const audit = [
    {
      releaseId: 'r1',
      action: 'promoted',
      detail: {},
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      releaseId: 'r2',
      action: 'promoted',
      detail: { fromReleaseId: 'r1' },
      createdAt: '2026-11-05T00:00:00Z',
    },
    {
      releaseId: 'r1',
      action: 'rolled_back',
      detail: { fromReleaseId: 'r2', reason: 'judge median fell' },
      createdAt: '2026-11-07T00:00:00Z',
    },
  ];
  const ideas = [
    {
      id: 'i9',
      text: 'Shorter Try saying lines',
      status: 'active',
      releaseId: 'r2',
      change: {},
      evidence: {},
    },
  ];
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM agent_release_audit')) return audit;
      if (sql.includes('FROM agent_lessons')) return ideas;
      if (sql.includes("\"authorKind\" = 'seed' AND status = 'draft'"))
        return [];
      if (sql.includes('FROM agent_releases r LEFT JOIN users'))
        return releases;
      return [];
    }),
  };
  const harness = {
    getById: jest.fn(async (id: string) => ({
      id,
      agentKey: 'debrief',
      version: id === 'r1' ? 1 : 2,
      status: id === 'r1' ? 'ga' : 'retired',
      promotedAt: new Date(),
      bundle: {},
    })),
    makeGa: jest.fn(),
  };
  const svc = new DebriefReleasesService(
    dataSource as any,
    harness as any,
    {} as any,
  );
  return { svc, harness };
}

describe('DebriefReleasesService', () => {
  it('lists live history: where each came from, and why it was retired', async () => {
    const { svc } = build();
    const { items } = await svc.list();
    const v1 = items.find((i) => i.version === 1)!;
    const v2 = items.find((i) => i.version === 2)!;
    expect(v1).toMatchObject({
      status: 'live',
      cameFrom: {
        kind: 'roll_back',
        fromVersion: 2,
        reason: 'judge median fell',
      },
      liveTimes: 2,
      retired: null,
    });
    expect(v2).toMatchObject({
      status: 'retired',
      title: 'Shorter Try saying lines',
      cameFrom: { kind: 'idea', ideaId: 'i9', proposedBy: 'pm_agent' },
      retired: {
        reason: 'rolled_back',
        byVersion: 1,
        why: 'judge median fell',
      },
    });
  });

  it('rolls back only to a release that has been live, never to the live one', async () => {
    const { svc, harness } = build();
    await expect(svc.rollback('r1', 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    harness.getById.mockResolvedValueOnce({
      id: 'r3',
      agentKey: 'debrief',
      version: 3,
      status: 'draft',
      promotedAt: null,
    } as any);
    await expect(svc.rollback('r3', 7)).rejects.toThrow(/has been live/);
  });
});
