import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Audio narration of a role-play's description: the public URL, the hash of what it was made
 * from (so an unchanged description is never re-synthesised), and the retry state of the
 * background generation. All nullable / defaulted, so existing rows need no backfill here — the
 * backfill script fills the audio.
 */
export class AddScenarioDescriptionAudio1981900600000 implements MigrationInterface {
  name = 'AddScenarioDescriptionAudio1981900600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios"
         ADD COLUMN IF NOT EXISTS "descriptionAudioUrl" character varying,
         ADD COLUMN IF NOT EXISTS "descriptionAudioHash" character varying,
         ADD COLUMN IF NOT EXISTS "descriptionAudioAttempts" integer NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS "descriptionAudioNextAttemptAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scenarios_description_audio_pending"
         ON "scenarios" ("descriptionAudioNextAttemptAt")
         WHERE "descriptionAudioNextAttemptAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_scenarios_description_audio_pending"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios"
         DROP COLUMN IF EXISTS "descriptionAudioNextAttemptAt",
         DROP COLUMN IF EXISTS "descriptionAudioAttempts",
         DROP COLUMN IF EXISTS "descriptionAudioHash",
         DROP COLUMN IF EXISTS "descriptionAudioUrl"`,
    );
  }
}
