import { QueryRunner } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { DropUnusedCaseAndTrackPermissions1981001400000 } from './1981001400000-DropUnusedCaseAndTrackPermissions';

describe('DropUnusedCaseAndTrackPermissions', () => {
  const DROPPED = ['view:admin:case', 'edit:tenant:track'];

  it('deletes both permissions and their group grants', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const queryRunner = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return [];
      }),
    } as unknown as QueryRunner;

    await new DropUnusedCaseAndTrackPermissions1981001400000().up(queryRunner);

    for (const name of DROPPED) {
      expect(
        queries.some(
          (q) =>
            q.sql.includes('DELETE FROM group_permissions') &&
            q.params[0] === name,
        ),
      ).toBe(true);
      expect(
        queries.some(
          (q) =>
            q.sql.includes('DELETE FROM "permissions" WHERE name') &&
            q.params[0] === name,
        ),
      ).toBe(true);
    }
  });

  it('drops only names the code no longer defines, never the ones still in use', () => {
    const defined = new Set<string>(Object.values(PERMISSIONS));
    for (const name of DROPPED) expect(defined.has(name)).toBe(false);
    // The live twins stay.
    expect(defined.has('view:admin:cases')).toBe(true);
    expect(defined.has('edit:track-tenant')).toBe(true);
  });
});
