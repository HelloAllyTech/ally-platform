import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Access for the Ally guide's admin surfaces (plans/ally-guide/plan.md §10.5)
 * and its kill switches (§7.5).
 *
 * Permissions go to the platform-tier groups that can still hold them, each
 * granted explicitly (the `...SUPER_ADMIN_PERMISSIONS` spread is TypeScript
 * only; `group_permissions` rows are written once by migration).
 *
 * Toggles: `ally_guide` (the Ally Console) and `ally_guide_org` (the org Ally
 * tab) are backfilled ON for the same groups — a new key grants itself to
 * nobody, since a missing `admin_feature_toggles` row means false.
 * `ally_guide_transcripts` is deliberately NOT backfilled: reading learner
 * conversations is granted person by person.
 *
 * The `ally_guide` global_settings row is seeded with every switch OFF, so the
 * guide stays dark in every environment until someone turns it on. An
 * existing row is left alone.
 *
 * Lists are written out, not imported: a migration must keep meaning what it
 * meant when it ran. Permissions and toggles are cached in Redis
 * (`group:permissions:*`, `admin:feature-toggles:v2:*`); admins active at
 * deploy time see the tabs within the TTL.
 */
const GROUPS = ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];

const PERMISSIONS = [
  'view:admin:ally-guide',
  'edit:admin:ally-guide',
  'review:admin:ally-guide-transcripts',
];

const BACKFILLED_TOGGLES = ['ally_guide', 'ally_guide_org'];

const SETTINGS_NAME = 'ally_guide';
const SWITCHES_OFF = {
  enabled: false,
  anonymousChat: false,
  voice: false,
  disabledCapabilities: [],
  disabledTenants: [],
  disabledCourses: [],
};

export class AddAllyGuideAccess1980640000000 implements MigrationInterface {
  name = 'AddAllyGuideAccess1980640000000';

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

    for (const featureKey of BACKFILLED_TOGGLES) {
      await queryRunner.query(
        `
        INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
        SELECT DISTINCT ug."userId", $2::character varying, true
        FROM "user_groups" ug
        JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
        ON CONFLICT ("userId", "featureKey") DO NOTHING
        `,
        [GROUPS, featureKey],
      );
    }

    await queryRunner.query(
      `INSERT INTO "global_settings" ("name", "value", "createdBy", "updatedBy")
       SELECT $1::character varying, $2::jsonb, 0, 0
       WHERE NOT EXISTS (SELECT 1 FROM "global_settings" WHERE name = $1)`,
      [SETTINGS_NAME, JSON.stringify(SWITCHES_OFF)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "global_settings" WHERE name = $1`, [
      SETTINGS_NAME,
    ]);
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = ANY($1)`,
      [[...BACKFILLED_TOGGLES, 'ally_guide_transcripts']],
    );
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
