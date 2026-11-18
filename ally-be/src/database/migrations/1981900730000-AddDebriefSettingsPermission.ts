import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Debrief owner (debrief-console-redesign-notes.md, "Who can act"):
 * `manage:admin:debrief-settings` gates switching an organisation on, budgets,
 * test thresholds and accepting proposed values, autonomy unlocks, steering
 * weights, and (with `review:admin:debriefs` holders) pinned-rule sign-off.
 *
 * Granted to SUPER_DUPER_ADMIN only, explicitly — the
 * `...SUPER_ADMIN_PERMISSIONS` spread is TypeScript only. Anyone else is
 * granted it person by person. The Ally team keeps acting on platform access
 * and the clinical advisor on `review:admin:debriefs` (1981900710000); no new
 * role is created.
 *
 * Lists are written out, not imported. Group permissions sit behind a
 * 30-minute Redis cache (`group:permissions:*`).
 */
const GROUPS = ['SUPER_DUPER_ADMIN'];
const PERMISSIONS = ['manage:admin:debrief-settings'];

export class AddDebriefSettingsPermission1981900730000 implements MigrationInterface {
  name = 'AddDebriefSettingsPermission1981900730000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "permissions" (name)
         SELECT $1::character varying
         WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1)`,
        [name],
      );
    }
    await queryRunner.query(
      `
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g
      JOIN "permissions" p ON p.name = ANY($2::character varying[])
      WHERE g.name = ANY($1::character varying[])
        AND NOT EXISTS (
          SELECT 1 FROM "group_permissions" gp
          WHERE gp."groupId" = g.id AND gp."permissionId" = p.id
        )
      `,
      [GROUPS, PERMISSIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions"
        WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [PERMISSIONS],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      PERMISSIONS,
    ]);
  }
}
