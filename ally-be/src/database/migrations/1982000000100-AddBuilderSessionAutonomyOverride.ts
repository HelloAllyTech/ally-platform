import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A per-session autonomy override on Builder sessions (docs/pm-agent.md, "Accept →
 * Builder"). NULL = the global `builder_settings` switches apply, which is every existing
 * row. `auto` = review, fix, approve, merge and release run on their own for THIS session
 * while `builder_settings.enabled` is on; set at creation for sessions the PM Agent
 * requests (`requestedBy = 'pm_agent'`). Nothing is backfilled.
 */
export class AddBuilderSessionAutonomyOverride1982000000100 implements MigrationInterface {
  name = 'AddBuilderSessionAutonomyOverride1982000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD COLUMN IF NOT EXISTS "autonomyOverride" varchar(16) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_autonomy_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD CONSTRAINT "CHK_builder_sessions_autonomy_override" CHECK ("autonomyOverride" IS NULL OR "autonomyOverride" IN ('auto'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_autonomy_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP COLUMN IF EXISTS "autonomyOverride"`,
    );
  }
}
