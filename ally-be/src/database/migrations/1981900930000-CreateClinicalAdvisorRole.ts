import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the CLINICAL_ADVISOR role: the Debrief console's clinical advisor,
 * carrying `review:admin:debriefs` and nothing else.
 *
 * RevokeDebriefReviewFromPlatformGroups1981900780000 took that permission off
 * the platform admin groups and said the advisor would be granted it "person by
 * person (user_permissions)". ally-be has no per-user permissions: a permission
 * only ever comes from a group. This role is that grant. It is additive, held
 * alongside the account's normal role, and platform-managed
 * (PLATFORM_MANAGED_ROLES), so the generic role picker can't hand it out.
 *
 * Nothing is backfilled: holders are added by the Ally team (user_groups).
 * The permission row already exists (1981900710000); it is created here only
 * if missing. Redis caches `user:groups:*` for 30 minutes, which a raw
 * migration can't bust; that only matters once the role has holders.
 */
const GROUP = 'CLINICAL_ADVISOR';
const PERMISSION = 'review:admin:debriefs';

export class CreateClinicalAdvisorRole1981900930000 implements MigrationInterface {
  name = 'CreateClinicalAdvisorRole1981900930000';

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

  /**
   * Drops the role with its holders. Safe: it grants only the advisor's
   * console actions, and every holder keeps their own normal role. The
   * permission row stays; other migrations own it.
   */
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
