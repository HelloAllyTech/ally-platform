import { QueryRunner } from 'typeorm';

import { BackfillRoleplayCompletionLogic1982100000000 } from './1982100000000-BackfillRoleplayCompletionLogic';

const run = async (direction: 'up' | 'down') => {
  const queries: string[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  await new BackfillRoleplayCompletionLogic1982100000000()[direction](
    queryRunner,
  );
  return queries.map((q) => q.replace(/\s+/g, ' ').trim());
};

describe('BackfillRoleplayCompletionLogic', () => {
  it('stamps SCORE_AND_DURATION onto roleplay items only', async () => {
    const [update] = await run('up');
    expect(update).toContain(`UPDATE "track_items"`);
    expect(update).toContain(
      `'{"completionLogic": "SCORE_AND_DURATION"}'::jsonb`,
    );
    expect(update).toContain(`WHERE "type" = 'ROLEPLAY'`);
  });

  it('keeps the other criteria keys and handles a NULL column', async () => {
    const [update] = await run('up');
    // Merged with ||, not replaced, so minScore / minDurationSeconds /
    // assessmentMode survive.
    expect(update).toContain(
      `COALESCE("completionCriteria", '{}'::jsonb) || '{"completionLogic"`,
    );
  });

  it('never overwrites a logic a trainer already chose', async () => {
    const [update] = await run('up');
    expect(update).toContain(`NOT ("completionCriteria" ? 'completionLogic')`);
  });

  it('down removes only the stamped default', async () => {
    const [down] = await run('down');
    expect(down).toContain(`"completionCriteria" - 'completionLogic'`);
    expect(down).toContain(
      `"completionCriteria" ->> 'completionLogic' = 'SCORE_AND_DURATION'`,
    );
  });
});
