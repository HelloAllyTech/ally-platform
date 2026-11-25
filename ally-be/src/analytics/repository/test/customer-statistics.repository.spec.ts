import { CustomerStatisticsRepository } from '../customer-statistics.repository';

describe('CustomerStatisticsRepository', () => {
  const query = jest.fn();
  const repo = new CustomerStatisticsRepository({ query } as never);
  beforeEach(() => query.mockReset());

  it('reads every organisation in one query, and turns counts into numbers', async () => {
    query.mockResolvedValue([
      {
        tenantId: 't1',
        neverStartedLearners: '3',
        completedLast28d: '40',
        reviewedLast28d: '10',
        ratingsCount90d: '12',
        ratingsAverage90d: 4.25,
      },
      {
        tenantId: 't2',
        neverStartedLearners: null,
        completedLast28d: null,
        reviewedLast28d: null,
        ratingsCount90d: null,
        ratingsAverage90d: null,
      },
    ]);
    const out = await repo.getExtras(
      new Date('2026-10-28'),
      new Date('2026-08-26'),
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(out[0]).toEqual({
      tenantId: 't1',
      neverStartedLearners: 3,
      completedLast28d: 40,
      reviewedLast28d: 10,
      ratingsCount90d: 12,
      ratingsAverage90d: 4.25,
    });
    expect(out[1]).toMatchObject({
      neverStartedLearners: 0,
      ratingsAverage90d: null,
    });
  });

  it('leaves out test organisations and passes the windows as parameters', async () => {
    query.mockResolvedValue([]);
    const a = new Date('2026-10-28');
    const b = new Date('2026-08-26');
    await repo.getExtras(a, b);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('isTestOrganization');
    expect(params.slice(2)).toEqual([a, b]);
  });

  it('asks nothing when there are no organisations', async () => {
    expect((await repo.latestContacts([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('reads the latest contact of each organisation', async () => {
    query.mockResolvedValue([
      { tenantId: 't1', at: '2026-11-20T10:00:00.000Z', note: 'Called' },
    ]);
    const out = await repo.latestContacts(['t1', 't2']);
    expect(query.mock.calls[0][1]).toEqual([['t1', 't2']]);
    expect(out.get('t1')).toMatchObject({ note: 'Called' });
    expect(out.get('t1')?.at).toBeInstanceOf(Date);
  });

  it('writes the ids and the note as parameters', async () => {
    query.mockResolvedValue(undefined);
    await repo.addContact('t1', 7, "x'; DROP TABLE users;--");
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['t1', 7, "x'; DROP TABLE users;--"]);
    expect(sql).not.toContain('DROP');
  });
});
