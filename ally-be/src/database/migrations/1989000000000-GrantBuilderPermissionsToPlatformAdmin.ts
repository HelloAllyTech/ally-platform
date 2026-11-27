import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives the PLATFORM_ADMIN group the two Builder permissions.
 *
 * 1937200000000-AddBuilderPermissions granted them to SUPER_ADMIN and
 * SUPER_DUPER_ADMIN only. PLATFORM_ADMIN, the one group the Add platform admin
 * screen grants, was created earlier (1895000000001) and never got them, so an
 * admin added after the role collapse who was given the Builder toggle still
 * could not build: the Roadmap role reads the toggle AND the permission
 * (RoadmapRoleService.grantsOf), found the permission missing, and listed them
 * as an Idea. The admins who could build were the ones who still held a legacy
 * group (OPP-0938, 2026-11-26).
 *
 * This opens nothing by itself. `builder` has no default (a missing
 * `admin_feature_toggles` row is false) and every Builder route is gated on the
 * toggle as well, so only an admin who has been given the toggle, on the Users
 * screen or in Roadmap → Settings → Builders, becomes a builder.
 *
 * Written out, not imported: a migration keeps meaning what it meant when it
 * ran. Idempotent. `group_permissions` is cached in Redis
 * (`group:permissions:*`, 30 minutes); raw SQL cannot bust it, so admins see
 * the change within that window.
 */
const GROUP = 'PLATFORM_ADMIN';
const PERMISSIONS = ['view:admin:builder', 'edit:admin:builder'];

export class GrantBuilderPermissionsToPlatformAdmin1989000000000 implements MigrationInterface {
  name = 'GrantBuilderPermissionsToPlatformAdmin1989000000000';

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
      `INSERT INTO "group_permissions" ("groupId", "permissionId")
       SELECT g.id, p.id
         FROM "groups" g
         JOIN "permissions" p ON p.name = ANY($2::character varying[])
        WHERE g.name = $1
          AND NOT EXISTS (
            SELECT 1 FROM "group_permissions" gp
             WHERE gp."groupId" = g.id AND gp."permissionId" = p.id
          )`,
      [GROUP, PERMISSIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions" gp
        USING "groups" g, "permissions" p
        WHERE gp."groupId" = g.id AND g.name = $1
          AND gp."permissionId" = p.id AND p.name = ANY($2::character varying[])`,
      [GROUP, PERMISSIONS],
    );
  }
}
