import { QueryRunner } from 'typeorm';
import { GrantBuilderPermissionsToPlatformAdmin1989000000000 } from './1989000000000-GrantBuilderPermissionsToPlatformAdmin';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

const run = async (direction: 'up' | 'down' = 'up') => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const queryRunner = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    }),
  } as unknown as QueryRunner;
  await new GrantBuilderPermissionsToPlatformAdmin1989000000000()[direction](
    queryRunner,
  );
  return queries;
};

describe('GrantBuilderPermissionsToPlatformAdmin', () => {
  it('grants only the two Builder permissions, and only to PLATFORM_ADMIN', async () => {
    const queries = await run();
    const grant = queries.find((q) => q.sql.includes('"group_permissions"'));

    expect(grant?.params[0]).toBe('PLATFORM_ADMIN');
    expect(grant?.params[1]).toEqual([
      PERMISSIONS.VIEW_BUILDER,
      PERMISSIONS.EDIT_BUILDER,
    ]);
  });

  it('is idempotent: every insert is guarded by NOT EXISTS', async () => {
    const queries = await run();

    for (const q of queries) {
      expect(q.sql).toContain('NOT EXISTS');
    }
  });

  it('touches no feature toggle, so nobody becomes a builder without being given the toggle', async () => {
    const queries = await run();

    expect(queries.some((q) => q.sql.includes('admin_feature_toggles'))).toBe(
      false,
    );
  });

  it('down removes the same two grants from the same group', async () => {
    const [revoke] = await run('down');

    expect(revoke.sql).toContain('DELETE FROM "group_permissions"');
    expect(revoke.params).toEqual([
      'PLATFORM_ADMIN',
      [PERMISSIONS.VIEW_BUILDER, PERMISSIONS.EDIT_BUILDER],
    ]);
  });
});
