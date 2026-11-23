import { QueryRunner } from 'typeorm';
import { GrantTenantAdminsUserPreferences1986500000000 } from './1986500000000-GrantTenantAdminsUserPreferences';
import {
  ADMIN_PERMISSIONS,
  MULTI_TENANT_ADMIN_PERMISSIONS,
  PERMISSIONS,
} from 'src/authorization/constants/permissions.constants';

/** A fake query runner: groups and permissions exist, and no grant does yet. */
const makeRunner = (existingGrants = false) => {
  const inserts: unknown[][] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM "groups"')) return [{ id: `group:${params[0]}` }];
    if (sql.includes('FROM "permissions"'))
      return [{ id: `perm:${params[0]}` }];
    if (sql.includes('FROM group_permissions'))
      return existingGrants ? [{ id: 'existing' }] : [];
    if (sql.startsWith('INSERT INTO group_permissions')) inserts.push(params);
    return [];
  });
  return { queryRunner: { query } as unknown as QueryRunner, inserts, query };
};

describe('GrantTenantAdminsUserPreferences', () => {
  it('grants both preference permissions to ADMIN and MULTI_TENANT_ADMIN', async () => {
    const { queryRunner, inserts } = makeRunner();
    await new GrantTenantAdminsUserPreferences1986500000000().up(queryRunner);

    expect(inserts).toEqual([
      ['group:ADMIN', 'perm:view:user:preferences'],
      ['group:ADMIN', 'perm:edit:user:preferences'],
      ['group:MULTI_TENANT_ADMIN', 'perm:view:user:preferences'],
      ['group:MULTI_TENANT_ADMIN', 'perm:edit:user:preferences'],
    ]);
  });

  it('is safe to run twice: an existing grant is not inserted again', async () => {
    const { queryRunner, inserts } = makeRunner(true);
    await new GrantTenantAdminsUserPreferences1986500000000().up(queryRunner);
    expect(inserts).toEqual([]);
  });

  it('skips a group that does not exist rather than failing', async () => {
    const inserts: unknown[][] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('INSERT INTO group_permissions'))
          inserts.push(params);
        return [];
      }),
    } as unknown as QueryRunner;
    await new GrantTenantAdminsUserPreferences1986500000000().up(queryRunner);
    expect(inserts).toEqual([]);
  });

  it('keeps permissions.constants.ts in step with what the migration grants', () => {
    for (const list of [ADMIN_PERMISSIONS, MULTI_TENANT_ADMIN_PERMISSIONS]) {
      expect(list).toContain(PERMISSIONS.VIEW_USER_PREFERENCES);
      expect(list).toContain(PERMISSIONS.EDIT_USER_PREFERENCES);
    }
  });

  it('only removes the two groups it granted, on rollback', async () => {
    const { queryRunner, query } = makeRunner();
    await new GrantTenantAdminsUserPreferences1986500000000().down(queryRunner);
    const [sql, params] = query.mock.calls[0] as unknown as [
      string,
      unknown[][],
    ];
    expect(sql).toContain('DELETE FROM "group_permissions"');
    expect(params[0]).toEqual(['ADMIN', 'MULTI_TENANT_ADMIN']);
  });
});
