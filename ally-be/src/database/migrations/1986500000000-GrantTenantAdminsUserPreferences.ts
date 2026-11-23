import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets tenant admins read and save their own user preferences.
 *
 * ADMIN and MULTI_TENANT_ADMIN held neither `view:user:preferences` nor
 * `edit:user:preferences`; only LEARNER and the platform admin roles did. A
 * tenant admin who also held another role (usually LEARNER) inherited them,
 * because permissions are unioned across a user's roles, but one who held only
 * ADMIN got a 403 on every preference read and save. That silently broke the
 * Organization Metrics chart reorder and would break the Statistics dashboard
 * layout the same way. In prod, 6 of 51 tenant admins in real organisations were
 * in that position when this was written.
 *
 * Preferences are per user and only ever touch the caller's own row (the
 * endpoints take the user from the token), so this widens nothing beyond the
 * caller's own settings.
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL (src/authorization/service/permissions.service.ts) —
 * flush those keys after deploying this migration or affected admins keep
 * getting 403 until the cache expires.
 */
const PERMISSIONS = ['view:user:preferences', 'edit:user:preferences'];
const GROUPS = ['ADMIN', 'MULTI_TENANT_ADMIN'];

export class GrantTenantAdminsUserPreferences1986500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const groupName of GROUPS) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      for (const name of PERMISSIONS) {
        const perm = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
          [name],
        );
        const permId = perm?.[0]?.id;
        if (!permId) continue;

        const existingGrant = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permId],
        );
        if (existingGrant.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the two groups this migration granted; LEARNER and the platform
    // roles keep theirs.
    await queryRunner.query(
      `DELETE FROM "group_permissions"
        WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = ANY($1))
          AND "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($2))`,
      [GROUPS, PERMISSIONS],
    );
  }
}
