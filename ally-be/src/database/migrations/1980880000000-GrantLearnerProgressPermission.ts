import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `edit:learner-progress`: lets a tenant's own ADMINs fix up a learner's course
 * progress from the consumer web app's Org Metrics learner table (remove them
 * from a course, reopen scenario-quiz or assessment attempts). These routes
 * were gated on `edit:user`, which no tenant ADMIN holds and which also opens
 * user and role editing, so they could not simply be handed out. Every route
 * acts only on learners in the caller's own organisation.
 *
 * Granted to ADMIN, plus every group that holds `edit:user` today so nobody
 * who could reach these routes loses them. Copying from `edit:user` rather than
 * naming PLATFORM_ADMIN keeps this correct for any cloned role: group_permissions
 * rows are written once by migration and never recomputed from the constants.
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL — flush those keys after deploying, or org admins will
 * not see the Courses button until the cache expires.
 */
const PERMISSION = 'edit:learner-progress';
const SOURCE_PERMISSION = 'edit:user';
const EXTRA_GROUPS = ['ADMIN'];

export class GrantLearnerProgressPermission1980880000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT id FROM "permissions" WHERE name = $1`,
      [PERMISSION],
    );
    if (existing.length === 0) {
      await queryRunner.query(`INSERT INTO "permissions" (name) VALUES ($1)`, [
        PERMISSION,
      ]);
    }

    const perm = await queryRunner.query(
      `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
      [PERMISSION],
    );
    const permId = perm?.[0]?.id;
    if (!permId) return;

    // Groups to grant: those holding edit:user, plus the named extras.
    const groups: { id: number }[] = await queryRunner.query(
      `SELECT DISTINCT gp."groupId" AS id
         FROM group_permissions gp
         JOIN "permissions" p ON p.id = gp."permissionId"
        WHERE p.name = $1
       UNION
       SELECT g.id FROM "groups" g WHERE g.name = ANY($2)`,
      [SOURCE_PERMISSION, EXTRA_GROUPS],
    );

    for (const { id: groupId } of groups) {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = $1)`,
      [PERMISSION],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
      PERMISSION,
    ]);
  }
}
