import { QueryRunner } from 'typeorm';
import { RevokeDebriefReviewFromPlatformGroups1981900780000 } from './1981900780000-RevokeDebriefReviewFromPlatformGroups';
import {
  PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  SUPER_DUPER_ADMIN_PERMISSIONS,
} from 'src/authorization/constants/permissions.constants';

const run = async (direction: 'up' | 'down') => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const queryRunner = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    }),
  } as unknown as QueryRunner;
  await new RevokeDebriefReviewFromPlatformGroups1981900780000()[direction](
    queryRunner,
  );
  return queries;
};

describe('RevokeDebriefReviewFromPlatformGroups', () => {
  it('removes review:admin:debriefs from the three platform groups only', async () => {
    const [revoke, ...rest] = await run('up');
    expect(rest).toHaveLength(0);
    expect(revoke.sql).toContain('DELETE FROM "group_permissions"');
    expect(revoke.params).toEqual([
      ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'],
      ['review:admin:debriefs'],
    ]);
    // The permission itself stays: clinical advisors hold it person by person.
    expect(revoke.sql).not.toContain('DELETE FROM "permissions"');
  });

  it('down gives it back to the same groups', async () => {
    const [grant] = await run('down');
    expect(grant.sql).toContain('INSERT INTO "group_permissions"');
    expect(grant.params).toEqual([
      ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'],
      ['review:admin:debriefs'],
    ]);
  });

  it('matches the platform lists in permissions.constants.ts', () => {
    expect(SUPER_ADMIN_PERMISSIONS).not.toContain(PERMISSIONS.REVIEW_DEBRIEFS);
    expect(SUPER_DUPER_ADMIN_PERMISSIONS).not.toContain(
      PERMISSIONS.REVIEW_DEBRIEFS,
    );
  });
});
