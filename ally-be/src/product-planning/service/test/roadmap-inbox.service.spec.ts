import { BuilderNotificationKind } from 'src/builder/enum/builder.enum';
import {
  PlanNotificationKind,
  RoadmapNotificationKind as K,
  RoadmapWatchLevel as W,
} from '../../enum/product-planning.enum';
import { RoadmapInboxService } from '../roadmap-inbox.service';

const ITEM = '11111111-1111-1111-1111-111111111111';

function build(opts: { ownerIds?: number[]; voters?: number[] } = {}) {
  const saved: any[] = [];
  const notifications = {
    create: jest.fn((row) => row),
    save: jest.fn(async (rows) => {
      saved.push(...rows);
      return rows;
    }),
    find: jest.fn(),
    update: jest.fn(async () => ({ affected: 2 })),
  };
  const watches = {
    find: jest.fn(async () => [{ userId: 9, level: W.MILESTONES }]),
  };
  const roles = { owners: jest.fn(async () => opts.ownerIds ?? [3]) };
  const query = jest.fn(async (...args: unknown[]): Promise<unknown[]> => {
    const sql = String(args[0]);
    if (sql.includes('"builderSessionId" = $1')) return [{ id: ITEM }];
    if (sql.includes('LEFT JOIN "builder_sessions"'))
      return [{ authorUserId: 1, leadUserId: 2 }];
    if (sql.includes('roadmap_allocations'))
      return (opts.voters ?? [4]).map((userId) => ({ userId }));
    return [];
  });
  const service = new RoadmapInboxService(
    notifications as never,
    watches as never,
    roles as never,
    { query } as never,
  );
  return { service, saved, notifications, query, roles };
}

describe('RoadmapInboxService', () => {
  it('fans an event out by the §4.8 rules, one row per person, one group key', async () => {
    const { service, saved } = build();
    const told = await service.deliver({
      kind: K.SHIPPED,
      itemId: ITEM,
      payload: { liveSince: '2026-11-14' },
    });
    expect(told).toEqual([1, 2, 4, 9]);
    expect(saved.map((r) => r.recipientUserId)).toEqual([1, 2, 4, 9]);
    expect(new Set(saved.map((r) => r.groupKey)).size).toBe(1);
    expect(saved[0]).toMatchObject({ itemId: ITEM, kind: K.SHIPPED });
  });

  it('gives the decline reason to the author only (D10)', async () => {
    const { service, saved } = build();
    await service.deliver({
      kind: K.DECLINED,
      itemId: ITEM,
      payload: { byUserId: 3, reason: 'Overlaps another idea' },
    });
    const author = saved.find((r) => r.recipientUserId === 1);
    const voter = saved.find((r) => r.recipientUserId === 4);
    expect(author.payload).toEqual({
      byUserId: 3,
      reason: 'Overlaps another idea',
    });
    expect(voter.payload).toEqual({ byUserId: 3 });
  });

  it('looks up Owners and voters only when the kind needs them', async () => {
    const { service, roles, query } = build();
    await service.deliver({ kind: K.DECISION_NEEDED, itemId: ITEM });
    expect(roles.owners).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('allocations')),
    ).toBe(false);
  });

  it('never throws, whatever fails', async () => {
    const { service, notifications } = build();
    notifications.save.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.deliver({ kind: K.SHIPPED, itemId: ITEM }),
    ).resolves.toEqual([]);
  });

  it('dual-writes a Builder notice, keeping its original recipient and finding the idea', async () => {
    const { service, saved } = build();
    await service.fromBuilderNotification(
      { id: 'session-1', createdBy: 8 },
      BuilderNotificationKind.QUESTION_PENDING,
      'A question is waiting.',
    );
    // Agent question: author, lead, All watchers, plus the session creator.
    expect(saved.map((r) => r.recipientUserId)).toEqual([1, 2, 8]);
    expect(saved[0]).toMatchObject({
      itemId: ITEM,
      sessionId: 'session-1',
      kind: K.AGENT_QUESTION,
      payload: {
        source: 'builder',
        sourceKind: 'question_pending',
        message: 'A question is waiting.',
      },
    });
  });

  it('dual-writes a plan notice that maps to activity to its recipient only', async () => {
    const { service, saved } = build();
    await service.fromPlanNotification(
      2,
      'session-1',
      PlanNotificationKind.NUDGE,
      'No activity for a week.',
    );
    expect(saved.map((r) => r.recipientUserId)).toEqual([2]);
    expect(saved[0].kind).toBe(K.ACTIVITY);
  });

  it('adds a Milestones watch on a vote without overwriting a choice', async () => {
    const { service, query } = build();
    await service.watchOnVote(4, ITEM);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \("userId", "itemId"\) DO NOTHING/);
    expect(params).toEqual([4, ITEM, 'milestones']);
  });

  it('never fails a vote over its watch row', async () => {
    const { service, query } = build();
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(service.watchOnVote(4, ITEM)).resolves.toBeUndefined();
  });

  it('lets a person set their own level, which overwrites', async () => {
    const { service, query } = build();
    await expect(service.setWatch(4, ITEM, W.NONE)).resolves.toEqual({
      itemId: ITEM,
      level: W.NONE,
    });
    expect(query.mock.calls[0][0]).toMatch(/DO UPDATE SET "level"/);
  });

  it('groups rows by key, newest first, counting unread', () => {
    const row = (id: string, key: string, at: string, read = false) => ({
      id,
      groupKey: key,
      kind: K.AGENT_QUESTION,
      itemId: ITEM,
      sessionId: null,
      payload: { n: id },
      readAt: read ? new Date() : null,
      createdAt: new Date(at),
    });
    const groups = RoadmapInboxService.group([
      row('c', 'g2', '2026-11-17T10:20:00Z'),
      row('b', 'g1', '2026-11-17T10:05:00Z'),
      row('a', 'g1', '2026-11-17T10:01:00Z', true),
    ]);
    expect(groups).toEqual([
      expect.objectContaining({ groupKey: 'g2', count: 1, unread: 1 }),
      expect.objectContaining({
        groupKey: 'g1',
        count: 2,
        unread: 1,
        ids: ['b', 'a'],
        payload: { n: 'b' },
        firstAt: '2026-11-17T10:01:00.000Z',
        lastAt: '2026-11-17T10:05:00.000Z',
      }),
    ]);
  });

  it('marks only the caller’s unread notices read, and nothing without a target', async () => {
    const { service, notifications } = build();
    expect(await service.markRead(5, {})).toBe(0);
    expect(notifications.update).not.toHaveBeenCalled();
    await service.markRead(5, { groupKeys: ['g1'] });
    const [criteria] = notifications.update.mock.calls[0] as any[];
    expect(criteria.recipientUserId).toBe(5);
    expect(criteria.readAt).toBeDefined();
    expect(criteria.groupKey).toBeDefined();
  });
});
