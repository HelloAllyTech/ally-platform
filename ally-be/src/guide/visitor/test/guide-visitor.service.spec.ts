import { HttpException, UnauthorizedException } from '@nestjs/common';
import { GUIDE_DEFAULT_POLICY } from '../../release/guide-release.bundle';
import {
  GuideVisitorService,
  hashVisitorToken,
} from '../guide-visitor.service';

function setup(
  options: {
    sentToday?: number;
    visitorUsd?: number;
    anonUsdToday?: number;
    ipCount?: number;
    createdFromIp?: number;
    existingThread?: any;
    visitorThread?: any;
    visitorMessages?: Array<{ id: string; content: string }>;
    anonymousChat?: boolean;
    hasBefore?: boolean;
  } = {},
) {
  const visitorRow = {
    id: 'vis-1',
    tokenHash: hashVisitorToken('tok'),
    ipHash: null,
  };
  const visitors = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: 'vis-new', ...row })),
    findOne: jest.fn(async ({ where }: any) =>
      where.tokenHash === visitorRow.tokenHash ? visitorRow : null,
    ),
    update: jest.fn(async () => undefined),
  };
  const threadRows = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where.visitorId) return options.visitorThread ?? null;
      if (where.id) return { ...options.visitorThread, userId: 3 };
      return null;
    }),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: 'th-new', ...row })),
    update: jest.fn(async () => undefined),
  };
  const threads = {
    assertCanOpen: jest.fn(async () => undefined),
    findActiveForUser: jest.fn(async () => options.existingThread ?? null),
    getOrCreateForUser: jest.fn(async () => ({ id: 'th-user' })),
    queueTrigger: jest.fn(async () => true),
  };
  const settings = {
    unavailableReason: jest.fn(async () => null),
    switches: jest.fn(async () => ({
      anonymousChat: options.anonymousChat ?? true,
    })),
  };
  const ledger = {
    totalForVisitorWithin: jest.fn(async () => options.visitorUsd ?? 0),
  };
  const learnerData = {
    addToNotebook: jest.fn(async () => ({})),
    hasNotebookKind: jest.fn(async () => options.hasBefore ?? false),
  };
  const counters = new Map<string, number>();
  const redis = {
    incrWithExpiry: jest.fn(async (key: string) => {
      const start = key.includes('created')
        ? (options.createdFromIp ?? 0)
        : (options.ipCount ?? 0);
      const count = (counters.get(key) ?? start) + 1;
      counters.set(key, count);
      return { count, ttlSeconds: 3600 };
    }),
  };
  const queries: string[] = [];
  const messageRepo = {
    find: jest.fn(async () => options.visitorMessages ?? []),
    findOne: jest.fn(async () => options.visitorMessages?.[0] ?? null),
  };
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM "guide_messages"')) {
        return [{ sent: options.sentToday ?? 0 }];
      }
      if (sql.includes('FROM "agent_cost_ledger"')) {
        return [{ total: String(options.anonUsdToday ?? 0) }];
      }
      return [];
    }),
    getRepository: jest.fn(() => messageRepo),
    transaction: jest.fn(async (work: any) =>
      work({ query: (sql: string) => dataSource.query(sql) }),
    ),
  };
  const service = new GuideVisitorService(
    visitors as never,
    threadRows as never,
    threads as never,
    settings as never,
    ledger as never,
    learnerData as never,
    redis as never,
    { jwt: { accessToken: { secret: 's' } } } as never,
    dataSource as never,
    { getGa: jest.fn(async () => null) } as never,
  );
  return { service, visitors, threadRows, threads, learnerData, queries };
}

const policy = GUIDE_DEFAULT_POLICY;
const admit = (t: ReturnType<typeof setup>) =>
  t.service.admit({
    visitor: { id: 'vis-1', ipHash: null },
    trackId: 'tr1',
    ipHash: 'ip-1',
    policy,
  });

describe('GuideVisitorService', () => {
  it('stores only a hash of the token, and refuses a sixth visit from one address in an hour', async () => {
    const t = setup({ createdFromIp: 4 });
    const { token } = await t.service.create('203.0.113.9', policy);
    expect(t.visitors.save).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: hashVisitorToken(token) }),
    );
    expect(JSON.stringify(t.visitors.save.mock.calls)).not.toContain(token);
    expect(JSON.stringify(t.visitors.save.mock.calls)).not.toContain(
      '203.0.113.9',
    );
    await expect(
      t.service.create('203.0.113.9', policy),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects an unknown or spent token', async () => {
    await expect(setup().service.resolve('nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(setup().service.resolve(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('counts the allowance down by messages, and to zero once the spend is used', async () => {
    expect(
      await setup({ sentToday: 9 }).service.allowance('vis-1', 'tr1', policy),
    ).toEqual({ remaining: 3, limit: 12 });
    expect(
      await setup({ sentToday: 1, visitorUsd: 0.26 }).service.allowance(
        'vis-1',
        'tr1',
        policy,
      ),
    ).toEqual({ remaining: 0, limit: 12 });
  });

  it('admits within the allowance, and refuses past each ceiling', async () => {
    expect(await admit(setup({ sentToday: 3 }))).toBeNull();
    expect(await admit(setup({ sentToday: 12 }))).toBe('allowance_exhausted');
    expect(await admit(setup({ anonUsdToday: 25 }))).toBe('anonymous_paused');
    expect(await admit(setup({ ipCount: 60 }))).toBe('rate_limited');
  });

  it('a visitor conversation becomes the learner’s when they have none', async () => {
    const t = setup({
      visitorThread: { id: 'th-vis', visitorId: 'vis-1', trackId: 'tr1' },
      visitorMessages: [{ id: 'm1', content: 'I would sit with her.' }],
    });
    const result = await t.service.claim(
      'tok',
      { id: 3, tenantId: 'org', username: 'x' },
      'tr1',
    );
    expect(result.outcome).toBe('claimed');
    expect(t.queries.join('\n')).toContain('"epochSnapshot" = NULL');
    // Their first move is kept as the notebook's "before" (plan §3 stage 13).
    expect(t.learnerData.addToNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'first_move',
        text: 'I would sit with her.',
        owner: { id: 3, tenantId: 'org' },
      }),
    );
    expect(t.visitors.update).toHaveBeenCalledWith(
      'vis-1',
      expect.objectContaining({ claimedByUserId: 3, claimedTenantId: 'org' }),
    );
  });

  it('keeps the first "before" when a later visit is claimed again', async () => {
    const t = setup({
      hasBefore: true,
      visitorThread: { id: 'th-vis', visitorId: 'vis-1', trackId: 'tr1' },
      visitorMessages: [{ id: 'm1', content: 'Second visit.' }],
    });
    await t.service.claim(
      'tok',
      { id: 3, tenantId: 'org', username: 'x' },
      'tr1',
    );
    expect(t.learnerData.addToNotebook).not.toHaveBeenCalled();
  });

  it('folds the visitor conversation into the learner’s existing one', async () => {
    const t = setup({
      existingThread: { id: 'th-user', tenantId: 'org' },
      visitorThread: { id: 'th-vis', visitorId: 'vis-1', trackId: 'tr1' },
      visitorMessages: [{ id: 'm1', content: 'How long is it?' }],
    });
    const result = await t.service.claim(
      'tok',
      { id: 3, tenantId: 'org', username: 'x' },
      'tr1',
    );
    expect(result.outcome).toBe('merged');
    expect(result.thread.id).toBe('th-user');
    expect(t.threadRows.update).toHaveBeenCalledWith('th-vis', {
      status: 'merged',
    });
    expect(t.threads.queueTrigger).toHaveBeenCalledWith(
      { id: 'th-user', tenantId: 'org' },
      expect.objectContaining({
        kind: 'visitor_merged',
        description: expect.stringContaining('How long is it?'),
      }),
    );
  });

  it('checks access before claiming anything', async () => {
    const t = setup({
      visitorThread: { id: 'th-vis', visitorId: 'vis-1', trackId: 'tr1' },
    });
    t.threads.assertCanOpen.mockRejectedValueOnce(new Error('no access'));
    await expect(
      t.service.claim('tok', { id: 3, tenantId: 'org', username: 'x' }, 'tr1'),
    ).rejects.toThrow('no access');
    expect(t.visitors.update).not.toHaveBeenCalled();
  });
});
