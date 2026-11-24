import {
  CustomerStatisticsService,
  moversOf,
} from '../customer-statistics.service';

const NOW = new Date('2026-11-24T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const org = (id: string, over: Record<string, unknown> = {}) => ({
  tenantId: id,
  tenantName: `Org ${id}`,
  code: id,
  learners: 40,
  activeLearners28d: 20,
  completedSimulations: 500,
  completedLast28d: 60,
  completedPrev28d: 60,
  lastCompletedAt: day(1),
  creditLimit: 0,
  consumedCredits: 0,
  learnersWithCreditLimit: 0,
  ...over,
});
const extras = (id: string, over: Record<string, unknown> = {}) => ({
  tenantId: id,
  neverStartedLearners: 2,
  completedLast28d: 60,
  reviewedLast28d: 50,
  ratingsCount90d: 20,
  ratingsAverage90d: 4.5,
  ...over,
});

describe('CustomerStatisticsService', () => {
  const orgHealth = { getOrgRows: jest.fn(), getWeeklyTrend: jest.fn() };
  const repo = {
    getExtras: jest.fn(),
    latestContacts: jest.fn(),
    addContact: jest.fn(),
  };
  const redis = { get: jest.fn(), set: jest.fn() };
  const scope = { resolveScope: jest.fn(), assertTenantInScope: jest.fn() };
  const service = new CustomerStatisticsService(
    orgHealth as never,
    repo as never,
    redis as never,
    scope as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    redis.get.mockResolvedValue(null);
    scope.resolveScope.mockResolvedValue({
      tenantIds: null,
      restricted: false,
    });
    orgHealth.getWeeklyTrend.mockResolvedValue([]);
    repo.latestContacts.mockResolvedValue(new Map());
    orgHealth.getOrgRows.mockResolvedValue([
      org('a'),
      org('b', { lastCompletedAt: day(40) }),
      org('c', {
        lastCompletedAt: day(10),
        creditLimit: 100,
        consumedCredits: 95,
        learnersWithCreditLimit: 5,
      }),
    ]);
    repo.getExtras.mockResolvedValue([extras('a'), extras('b'), extras('c')]);
  });

  it('ranks the organisations asking for a message first, with their reasons', async () => {
    const out = await service.getOverview(7, NOW);
    expect(out.orgs.map((o) => o.tenantId)).toEqual(['b', 'c', 'a']);
    expect(out.orgs[0].reasons.map((r) => r.id)).toEqual(['quiet']);
    expect(out.orgs[1].reasons.map((r) => r.id)).toEqual(['creditsNearLimit']);
    expect(out.summary).toMatchObject({
      orgs: 3,
      quietOrgs: 1,
      needsOutreach: 2,
    });
  });

  it('shows a member of staff with an organisation list only those organisations', async () => {
    scope.resolveScope.mockResolvedValue({
      tenantIds: ['c'],
      restricted: true,
    });
    const out = await service.getOverview(7, NOW);
    expect(out.orgs.map((o) => o.tenantId)).toEqual(['c']);
    expect(out.summary.orgs).toBe(1);
    expect(repo.latestContacts).toHaveBeenCalledWith(['c']);
  });

  it('shows an empty list to someone whose list reaches nothing, never everything', async () => {
    scope.resolveScope.mockResolvedValue({ tenantIds: [], restricted: true });
    expect((await service.getOverview(7, NOW)).orgs).toEqual([]);
  });

  it('puts a recently contacted organisation last and out of the count', async () => {
    repo.latestContacts.mockResolvedValue(
      new Map([['b', { tenantId: 'b', at: day(2), note: 'Called the lead' }]]),
    );
    const out = await service.getOverview(7, NOW);
    expect(out.orgs.map((o) => o.tenantId)).toEqual(['c', 'a', 'b']);
    expect(out.orgs[2]).toMatchObject({
      recentlyContacted: true,
      contactNote: 'Called the lead',
    });
    expect(out.summary.needsOutreach).toBe(1);
  });

  it('brings an organisation back after a week without contact', async () => {
    repo.latestContacts.mockResolvedValue(
      new Map([['b', { tenantId: 'b', at: day(8), note: null }]]),
    );
    expect((await service.getOverview(7, NOW)).orgs[0].tenantId).toBe('b');
  });

  it("keeps the platform-wide result for ten minutes, and never stores a caller's own part", async () => {
    await service.getOverview(7, NOW);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(redis.set.mock.calls[0][1]);
    expect(stored.orgs).toHaveLength(3);
    expect(stored.orgs[0]).not.toHaveProperty('contactedAt');
    expect(redis.set.mock.calls[0][2]).toBe(600);

    redis.get.mockResolvedValue(redis.set.mock.calls[0][1]);
    orgHealth.getOrgRows.mockClear();
    await service.getOverview(7, NOW);
    expect(orgHealth.getOrgRows).not.toHaveBeenCalled();
  });

  it('still answers when the cache is down', async () => {
    redis.get.mockRejectedValue(new Error('down'));
    redis.set.mockRejectedValue(new Error('down'));
    expect((await service.getOverview(7, NOW)).orgs).toHaveLength(3);
  });

  it('draws no rate for an organisation under the learner floor', async () => {
    orgHealth.getOrgRows.mockResolvedValue([org('a', { learners: 3 })]);
    const [row] = (await service.getOverview(7, NOW)).orgs;
    expect(row).toMatchObject({
      belowFloor: true,
      ratingsAverage90d: null,
      reviewSharePercent: null,
    });
  });

  it('reads credit use only where a limit is set', async () => {
    const out = await service.getOverview(7, NOW);
    expect(out.orgs.find((o) => o.tenantId === 'c')?.creditUtilisationPct).toBe(
      95,
    );
    expect(
      out.orgs.find((o) => o.tenantId === 'a')?.creditUtilisationPct,
    ).toBeNull();
  });

  describe('recording a contact', () => {
    it("refuses an organisation outside the caller's list, and writes nothing", async () => {
      scope.assertTenantInScope.mockRejectedValue(new Error('no'));
      await expect(service.recordContact(7, 'x', 'hi')).rejects.toThrow();
      expect(repo.addContact).not.toHaveBeenCalled();
    });

    it('trims the note and stores an empty one as nothing', async () => {
      scope.assertTenantInScope.mockResolvedValue(undefined);
      await service.recordContact(7, 'x', '  Emailed the lead  ');
      await service.recordContact(7, 'x', '   ');
      expect(repo.addContact.mock.calls).toEqual([
        ['x', 7, 'Emailed the lead'],
        ['x', 7, null],
      ]);
    });
  });
});

describe('moversOf', () => {
  const m = (id: string, prev: number, last: number, belowFloor = false) => ({
    tenantId: id,
    name: id,
    completedPrev28d: prev,
    completedLast28d: last,
    belowFloor,
  });

  it('lists the biggest rises and falls, by share, among organisations with enough to compare', () => {
    const out = moversOf([
      m('a', 100, 150),
      m('b', 20, 40),
      m('c', 100, 40),
      m('d', 50, 45),
      m('e', 5, 50),
      m('f', 100, 300, true),
    ]);
    expect(out.up.map((x) => x.tenantId)).toEqual(['b', 'a']);
    expect(out.down.map((x) => x.tenantId)).toEqual(['c', 'd']);
  });
});
