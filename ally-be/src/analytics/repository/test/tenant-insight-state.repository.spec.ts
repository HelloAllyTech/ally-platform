import { TenantInsightStateRepository } from '../tenant-insight-state.repository';

describe('TenantInsightStateRepository', () => {
  const query = jest.fn();
  const repo = new TenantInsightStateRepository({ query } as never);

  beforeEach(() => query.mockReset());

  it('asks which of these the person has put away, for that person only', async () => {
    query.mockResolvedValue([{ fingerprint: 'a:2026-W48' }]);
    const hidden = await repo.hiddenFingerprints(7, [
      'a:2026-W48',
      'b:2026-W48',
    ]);
    expect([...hidden]).toEqual(['a:2026-W48']);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([7, ['a:2026-W48', 'b:2026-W48']]);
    expect(sql).toContain(`"userId" = $1`);
    // Done stays hidden; a snooze only until it runs out.
    expect(sql).toContain(`"state" = 'done'`);
    expect(sql).toContain(`"until" > now()`);
  });

  it('does not ask when there is nothing to ask about', async () => {
    expect([...(await repo.hiddenFingerprints(7, []))]).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('writes ids as parameters, and replaces what was said before', async () => {
    query.mockResolvedValue(undefined);
    await repo.put('tenant-1', 7, "x'; DROP TABLE users;--", 'snoozed', 3);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([
      'tenant-1',
      7,
      "x'; DROP TABLE users;--",
      'snoozed',
      3,
    ]);
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('ON CONFLICT ("userId", "fingerprint")');
    expect(sql).toContain('make_interval(days => $5::int)');
  });

  it('keeps a done finding without an end, and a snoozed one with days', async () => {
    query.mockResolvedValue(undefined);
    await repo.put('tenant-1', 7, 'a:2026-W48', 'done', 7);
    expect(query.mock.calls[0][1][4]).toBeNull();
    await repo.put('tenant-1', 7, 'a:2026-W48', 'snoozed', 3);
    expect(query.mock.calls[1][1][4]).toBe(3);
  });

  it('gives the state and fingerprint one type each, which Postgres needs to run it', async () => {
    query.mockResolvedValue(undefined);
    await repo.put('tenant-1', 7, 'a:2026-W48', 'done', 7);
    const [sql] = query.mock.calls[0];
    // Used twice (once as a column value, once in a comparison), a parameter is rejected.
    [1, 2, 3, 4].forEach((n) =>
      expect(sql.match(new RegExp(`\\$${n}(?!\\d)`, 'g'))).toHaveLength(1),
    );
  });
});
