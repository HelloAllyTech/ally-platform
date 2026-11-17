import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap v2's flag and hidden switches on the Builder settings singleton
 * (plans/roadmap-builder-merge §3.2, §4.6, §5.5, §5.6), beside rev 5.2's
 * `planningEnabled`.
 *
 * - `roadmapV2Enabled` — the `roadmap_v2` flag, default false: production does
 *   not change until it is switched on.
 * - `maxLeadCeilingUsd` — how far a lead may raise their idea's ceiling.
 * - `awaitingReviewAmberDays` — when an unreviewed idea's age turns amber.
 * - `releaseWindow` — when auto-release may start; null means any time.
 * - `autoReleaseHeldPaths` — globs that hold an auto-release; null means the
 *   defaults in code (AUTO_RELEASE_HELD_PATHS_DEFAULT).
 *
 * `inProgressLimit` already exists (default 3). Additive only.
 */
export class AddRoadmapV2Settings1983000000000 implements MigrationInterface {
  name = 'AddRoadmapV2Settings1983000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "builder_settings"
        ADD COLUMN IF NOT EXISTS "roadmapV2Enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "maxLeadCeilingUsd" numeric(10,4) NOT NULL DEFAULT 200,
        ADD COLUMN IF NOT EXISTS "awaitingReviewAmberDays" integer NOT NULL DEFAULT 5,
        ADD COLUMN IF NOT EXISTS "releaseWindow" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "autoReleaseHeldPaths" jsonb NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP CONSTRAINT IF EXISTS "CHK_builder_settings_roadmap_v2_limits"`,
    );
    await queryRunner.query(`
      ALTER TABLE "builder_settings"
        ADD CONSTRAINT "CHK_builder_settings_roadmap_v2_limits"
        CHECK ("maxLeadCeilingUsd" > 0
           AND "awaitingReviewAmberDays" BETWEEN 1 AND 60)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP CONSTRAINT IF EXISTS "CHK_builder_settings_roadmap_v2_limits"`,
    );
    await queryRunner.query(`
      ALTER TABLE "builder_settings"
        DROP COLUMN IF EXISTS "autoReleaseHeldPaths",
        DROP COLUMN IF EXISTS "releaseWindow",
        DROP COLUMN IF EXISTS "awaitingReviewAmberDays",
        DROP COLUMN IF EXISTS "maxLeadCeilingUsd",
        DROP COLUMN IF EXISTS "roadmapV2Enabled"
    `);
  }
}
