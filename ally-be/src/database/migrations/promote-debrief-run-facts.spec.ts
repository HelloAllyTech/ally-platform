import { PromoteDebriefRunFacts1984420000000 } from './1984420000000-PromoteDebriefRunFacts';

const collect = async (dir: 'up' | 'down') => {
  const queries: string[] = [];
  const qr = {
    query: jest.fn(async (sql: string) => void queries.push(sql)),
  } as any;
  await new PromoteDebriefRunFacts1984420000000()[dir](qr);
  return queries.join('\n');
};

describe('PromoteDebriefRunFacts', () => {
  it('only adds: columns, a backfill that fills empty ones, and an index', async () => {
    const sql = await collect('up');
    for (const col of [
      'judgeOverall',
      'judgeModel',
      'judgePromptVersion',
      'languageSource',
      'retries',
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${col}"`);
    }
    // Safe to run again and never overwrites a value a newer writer set.
    expect(sql).toContain('WHERE "judgeOverall" IS NULL');
    expect(sql).toContain('WHERE "languageSource" IS NULL');
    expect(sql).toContain('WHERE "retries" = 0');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "debrief_runs_status_created_at_idx"',
    );
    expect(sql).not.toMatch(/DROP|DELETE|TRUNCATE/i);
  });

  it('goes back by dropping only what it added', async () => {
    const sql = await collect('down');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "debrief_runs_status_created_at_idx"',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS "judgeOverall"');
    expect(sql).not.toContain('workspace');
  });
});
