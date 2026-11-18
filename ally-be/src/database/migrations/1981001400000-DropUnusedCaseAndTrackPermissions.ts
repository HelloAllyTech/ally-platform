import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two permissions that nothing checks, found by the Context Library's dead-code sweep:
 *
 * - `view:admin:case` (1770613293576-addCasesPermissions): the singular twin of
 *   `view:admin:cases`, which is what the cases endpoint gates on.
 * - `edit:tenant:track` (1826000000000-TrackPermissions, backfilled by
 *   1893000000000): a duplicate of `edit:track-tenant`, which is the one used.
 *
 * No endpoint, web app or mobile build reads either name. Removing the rows and their
 * group grants keeps role editors from offering switches that do nothing, and frees the
 * names to be reused without inheriting stale grants.
 */
const names = ['view:admin:case', 'edit:tenant:track'];

export class DropUnusedCaseAndTrackPermissions1981001400000 implements MigrationInterface {
  name = 'DropUnusedCaseAndTrackPermissions1981001400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permissionName of names) {
      await queryRunner.query(
        `DELETE FROM group_permissions
           WHERE "permissionId" = (SELECT id FROM "permissions" WHERE name = $1)`,
        [permissionName],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
        permissionName,
      ]);
    }
  }

  public async down(): Promise<void> {
    throw new Error(
      'DropUnusedCaseAndTrackPermissions is not reversible. Nothing checked these ' +
        'permissions; restore from a snapshot if the rows are needed.',
    );
  }
}
