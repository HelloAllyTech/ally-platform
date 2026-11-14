import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Review debriefs (expert)" (debrief orchestrator spec B1): read a run's
 * transcript and debrief side by side, comment on exact lines and give a
 * verdict. Granted to the platform-tier groups explicitly — the
 * `...SUPER_ADMIN_PERMISSIONS` spread is TypeScript only, and PLATFORM_ADMIN
 * (cloned from it) gets its own `group_permissions` row. Clinical experts
 * outside those groups are granted it person by person by the Ally team.
 *
 * The routes also need the Debrief Console's Analytics toggle, which is not
 * backfilled here: it already gates the Console. Lists are written out, not
 * imported. Group permissions sit behind a 30-minute Redis cache
 * (`group:permissions:*`); admins active at deploy see the tab within it.
 */
const GROUPS = ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];
const PERMISSIONS = ['review:admin:debriefs'];

export class AddDebriefExpertReviewPermission1981900710000 implements MigrationInterface {
  name = 'AddDebriefExpertReviewPermission1981900710000';

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
