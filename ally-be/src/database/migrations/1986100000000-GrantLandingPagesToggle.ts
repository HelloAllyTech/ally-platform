import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches the new `landing_pages` toggle ON for the two top platform-admin
 * groups, so the Landing pages tab exists for someone the day it ships.
 *
 * Not for PLATFORM_ADMIN or MULTI_TENANT_ADMIN: the toggle is platform-only
 * and not defaultEnabled on purpose (it publishes to the public internet), so
 * those admins are granted it one by one from the Ally admins tab.
 *
 * `admin_feature_toggles` is a per-user row table where a missing row means
 * false, and a key added after the role-collapse cutover has no automatic
 * backfill, hence this migration. Idempotent (ON CONFLICT DO NOTHING); a group
 * absent from an environment is skipped by the join.
 *
 * FeatureToggleService caches enabled keys under
 * `admin:feature-toggles:${userId}` for 30 minutes and raw SQL cannot bust it,
 * so an admin sees the tab within the TTL or after a fresh sign-in.
 */
const GROUPS = ['SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];

const FEATURE_KEY = 'landing_pages';

export class GrantLandingPagesToggle1986100000000 implements MigrationInterface {
  name = 'GrantLandingPagesToggle1986100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
      SELECT DISTINCT ug."userId", $2::character varying, true
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
      ON CONFLICT ("userId", "featureKey") DO NOTHING
      `,
      [GROUPS, FEATURE_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = $1`,
      [FEATURE_KEY],
    );
  }
}
