import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `edit:tenant-branding`: lets a tenant's own ADMINs edit their organization's
 * branding (logo, display name, colour, favicon, welcome line) from the
 * consumer web app's Branding tab. The org-level on/off switch stays with
 * platform admins (EDIT_TENANT): the routes refuse while it is off, so the
 * grant is inert for every org until Ally switches branding on for it.
 *
 * Granted to ADMIN only. PLATFORM_ADMIN already reaches the same routes
 * through EDIT_TENANT.
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL — flush those keys after deploying, or org admins
 * will 403 on the new tab until the cache expires.
 */
const NEW_PERMISSIONS = ['edit:tenant-branding'];

const GROUP_GRANTS: Record<string, string[]> = {
  ADMIN: NEW_PERMISSIONS,
};

export class AddOrgAdminBrandingPermission1980850000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of NEW_PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [name],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }

    for (const [groupName, permissionNames] of Object.entries(GROUP_GRANTS)) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      for (const name of permissionNames) {
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
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [NEW_PERMISSIONS],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      NEW_PERMISSIONS,
    ]);
  }
}
