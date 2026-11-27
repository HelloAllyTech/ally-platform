import { QueryRunner } from 'typeorm';
import { RetireEvaluatorRole1989200000000 } from './1989200000000-RetireEvaluatorRole';

describe('RetireEvaluatorRole', () => {
  const run = async (direction: 'up' | 'down') => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const queryRunner = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return [];
      }),
    } as unknown as QueryRunner;
    await new RetireEvaluatorRole1989200000000()[direction](queryRunner);
    return queries;
  };

  it('up removes holders, grants, the permission and then the group', async () => {
    const q = await run('up');
    expect(q).toHaveLength(4);
    expect(q[0].sql).toContain('DELETE FROM "user_groups"');
    expect(q[1].sql).toContain('DELETE FROM "group_permissions"');
    expect(q[2].sql).toContain('DELETE FROM "permissions"');
    expect(q[3].sql).toContain('DELETE FROM "groups"');
    expect(q[0].params).toEqual(['EVALUATOR']);
    expect(q[2].params).toEqual(['evaluator:access']);
  });

  it('down recreates the group, permission and link', async () => {
    const q = await run('down');
    expect(q).toHaveLength(3);
    expect(q[0].sql).toContain('INSERT INTO "groups"');
    expect(q[1].sql).toContain('INSERT INTO "permissions"');
    expect(q[2].sql).toContain('INSERT INTO "group_permissions"');
  });
});
