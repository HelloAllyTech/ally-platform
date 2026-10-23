import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches the new `content_view_all` toggle ON for every platform-tier admin
 * who exists today, so introducing "see only the content you created" takes
 * nothing away from anyone already inside. Admins added from now on start
 * without it — that is the point of the toggle.
 *
 * Why only this key needs a migration: `admin_feature_toggles` is a per-user
 * row table where a MISSING row means false, and `legacyGrants` is inert for
 * every key added after 1895000000001-CreatePlatformAdminRole. The other keys
 * introduced alongside it — create_roleplays / create_cases / create_courses
 * and the eight sidebar-tab keys — are `defaultEnabled` in the registry, so a
 * missing row already means ON for a platform admin and they need no rows.
 *
 * All four groups, as in 1938000000000-BackfillContentManagementToggle: the
 * retired tiers alone would miss every admin minted by the Ally admins tab,
 * who hold PLATFORM_ADMIN and nothing else.
 *
 * Idempotent (ON CONFLICT DO NOTHING) and safe to re-run. A group absent from
 * an environment is simply skipped by the join.
 *
 * No cache flush needed: FeatureToggleService moved to the
 * `admin:feature-toggles:v2:` key in the same release, so nothing cached
 * before this ran is read afterwards.
 */
const PLATFORM_TIER_GROUPS = [
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'SUPER_DUPER_ADMIN',
  'MULTI_TENANT_ADMIN',
];

const FEATURE_KEY = 'content_view_all';

export class AddModularContentAccessToggles1980100000000 implements MigrationInterface {
  name = 'AddModularContentAccessToggles1980100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
      SELECT DISTINCT ug."userId", $2::character varying, true
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
      ON CONFLICT ("userId", "featureKey") DO NOTHING
      `,
      [PLATFORM_TIER_GROUPS, FEATURE_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = $1`,
      [FEATURE_KEY],
    );
  }
}
