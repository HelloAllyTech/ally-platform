import { backfillOwners } from '../backfill-owners';

describe('backfillOwners (A1)', () => {
  const unowned = [
    {
      id: 'b1',
      name: 'Sunrise',
      created_by: 7,
      creator_exists: true,
      archived: false,
    },
    {
      id: 'b2',
      name: 'Old',
      created_by: 9,
      creator_exists: false,
      archived: true,
    },
    {
      id: 'b3',
      name: 'Seeded',
      created_by: null,
      creator_exists: false,
      archived: false,
    },
  ];

  function db() {
    const writes: unknown[][] = [];
    return {
      writes,
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.trim().startsWith('SELECT')) return unowned;
        writes.push(params ?? []);
        return [];
      }),
    };
  }

  it('dry run lists what it would do and writes nothing', async () => {
    const fake = db();
    const report = await backfillOwners(fake as never, { dryRun: true });
    expect(report.assigned.map((b) => [b.id, b.ownerUserId])).toEqual([
      ['b1', 7],
    ]);
    expect(report.needsOwner.map((b) => b.id)).toEqual(['b2', 'b3']);
    expect(fake.writes).toEqual([]);
  });

  it('real run makes each creator the owner, and only them', async () => {
    const fake = db();
    const report = await backfillOwners(fake as never, { dryRun: false });
    expect(fake.writes).toEqual([['b1', 7]]);
    const insert = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO chatbot_members'),
    )!;
    expect(insert[0]).toContain("'owner'");
    expect(insert[0]).toContain('ON CONFLICT (chatbot_id, user_id)');
    expect(report.needsOwner.map((b) => b.name)).toEqual(['Old', 'Seeded']);
  });

  it('only looks at bots with no owner', async () => {
    const fake = db();
    await backfillOwners(fake as never, { dryRun: true });
    expect(fake.query.mock.calls[0][0]).toMatch(
      /NOT EXISTS[\s\S]*'owner' = ANY\(m\.roles\)/,
    );
  });
});
