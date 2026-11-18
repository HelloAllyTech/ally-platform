import { QueryRunner } from 'typeorm';
import { AbandonStaleCharacterInterviewSessions1980870000000 } from './1980870000000-AbandonStaleCharacterInterviewSessions';

const run = async (direction: 'up' | 'down') => {
  const queries: string[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  await new AbandonStaleCharacterInterviewSessions1980870000000()[direction](
    queryRunner,
  );
  return queries;
};

describe('AbandonStaleCharacterInterviewSessions', () => {
  it('abandons only ACTIVE, live sessions idle for over an hour', async () => {
    const [update] = await run('up');

    expect(update).toContain(`SET "status" = 'ABANDONED'`);
    expect(update).toContain(`"status" = 'ACTIVE'`);
    expect(update).toContain(`"deletedAt" IS NULL`);
    expect(update).toContain(`"updatedAt" < now() - interval '1 hour'`);
    // Word-bounded: "deletedAt" in the WHERE clause is not a DELETE.
    expect(update).not.toMatch(/\bDELETE\b/i);
  });

  it('tags each row so the way down restores exactly these and no others', async () => {
    const [up] = await run('up');
    const [down] = await run('down');

    expect(up).toContain(
      `'{"abandonedByMigration": "AbandonStaleCharacterInterviewSessions1980870000000"}'::jsonb`,
    );
    expect(down).toContain(`SET "status" = 'ACTIVE'`);
    expect(down).toContain(
      `"metadata" ->> 'abandonedByMigration' = 'AbandonStaleCharacterInterviewSessions1980870000000'`,
    );
    expect(down).toContain(`"metadata" - 'abandonedByMigration'`);
  });
});
