import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop `prompts.useDashboardOverride`.
 *
 * The Skills Store retired the flag on 2026-10-26: every prompt serves its live
 * version, and the column was kept (always true) only so a previous build of
 * each service still resolved the store if we rolled back. That window has
 * closed and no service reads it any more.
 *
 * `down` re-adds the column as it was, NOT NULL DEFAULT true, which is the
 * value every row held.
 */
export class DropPromptUseDashboardOverride1980840000000 implements MigrationInterface {
  name = 'DropPromptUseDashboardOverride1980840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "useDashboardOverride"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "useDashboardOverride" boolean NOT NULL DEFAULT true`,
    );
  }
}
