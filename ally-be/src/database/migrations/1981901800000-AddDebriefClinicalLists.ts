import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Settings › Clinical lists (2026-11-16): the words behind the score,
 * diagnosis and jargon checks, per language, editable by the clinical advisor
 * and the owner. One nullable jsonb column on the single settings row,
 * `{kind: {language: string[]}}`; nothing to backfill (absent reads as the
 * code defaults in debrief-clinical-lists.constants.ts).
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class AddDebriefClinicalLists1981901800000 implements MigrationInterface {
  name = 'AddDebriefClinicalLists1981901800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_owner_settings"
        ADD COLUMN IF NOT EXISTS "clinicalLists" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_owner_settings" DROP COLUMN IF EXISTS "clinicalLists"
    `);
  }
}
