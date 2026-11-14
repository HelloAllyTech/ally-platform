import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the DEBRIEF_OWNER role: `manage:admin:debrief-settings` and nothing
 * else. Until now only SUPER_DUPER_ADMIN held it, so making someone the
 * Debrief owner meant making them a platform owner. Additive and
 * platform-managed (PLATFORM_MANAGED_ROLES); holders are added in User
 * Management > Clinical advisors. Nothing is backfilled.
 */
const GROUP = 'DEBRIEF_OWNER';
const PERMISSION = 'manage:admin:debrief-settings';

export class CreateDebriefOwnerRole1981901200000 implements MigrationInterface {
  name = 'CreateDebriefOwnerRole1981901200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "groups" ("name")
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE name = $1::varchar)`,
      [GROUP],
    );
    await queryRunner.query(
      `INSERT INTO "permissions" ("name")
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
      [PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO "group_permissions" ("groupId", "permissionId")
       SELECT g.id, p.id
       FROM "groups" g
       JOIN "permissions" p ON p.name = $2
       WHERE g.name = $1
         AND NOT EXISTS (
           SELECT 1 FROM "group_permissions" existing
           WHERE existing."groupId" = g.id AND existing."permissionId" = p.id
         )`,
      [GROUP, PERMISSION],
    );
  }

  /** Drops the role with its holders; each keeps their other roles. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user_groups"
       WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)`,
      [GROUP],
    );
    await queryRunner.query(
      `DELETE FROM "group_permissions"
       WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)`,
      [GROUP],
    );
    await queryRunner.query(`DELETE FROM "groups" WHERE name = $1`, [GROUP]);
  }
}
