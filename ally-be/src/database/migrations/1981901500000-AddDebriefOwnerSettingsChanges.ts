import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Debrief v2 (autonomy by default, A10): who last changed each owner
 * setting, when, why and the change it belongs to, so Settings › Tests shows
 * the PM agent's tuning beside a person's edits. One nullable jsonb column on
 * the single settings row; nothing to backfill (no entry reads as "default").
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class AddDebriefOwnerSettingsChanges1981901500000 implements MigrationInterface {
  name = 'AddDebriefOwnerSettingsChanges1981901500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_owner_settings"
        ADD COLUMN IF NOT EXISTS "changes" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_owner_settings" DROP COLUMN IF EXISTS "changes"
    `);
  }
}
