import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The clinical advisor's permission, `review:admin:debriefs`, stops coming
 * with the platform admin groups (debrief-console-redesign-notes.md, "Mobile
 * round 2"; e2e PE-06 / PM-10). Migration 1981900710000 granted it to them,
 * so every Ally team member could give expert verdicts, sign off pinned rules
 * and score any session. The Ally team keeps acting on platform access
 * (`system:access`); the clinical advisor is granted the permission person
 * by person after release (user_permissions, not a group).
 *
 * Lists are written out, not imported. Person-by-person grants are left as
 * they are. Group permissions sit behind a 30-minute Redis cache
 * (`group:permissions:*`).
 */
const GROUPS = ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];
const PERMISSIONS = ['review:admin:debriefs'];

export class RevokeDebriefReviewFromPlatformGroups1981900780000 implements MigrationInterface {
  name = 'RevokeDebriefReviewFromPlatformGroups1981900780000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      DELETE FROM "group_permissions" gp
      USING "groups" g, "permissions" p
      WHERE gp."groupId" = g.id
        AND gp."permissionId" = p.id
        AND g.name = ANY($1::character varying[])
        AND p.name = ANY($2::character varying[])
      `,
      [GROUPS, PERMISSIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
}
