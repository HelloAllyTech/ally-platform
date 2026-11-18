import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a debrief run read, so a past run is reproducible without a join: a hash of the release
 * bundle it ran and the prompt version each step used. Both nullable and additive: a run from
 * before them has neither, and nothing reads them but a person investigating a run.
 */
export class AddDebriefRunSnapshot1984440000000 implements MigrationInterface {
  name = 'AddDebriefRunSnapshot1984440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_runs"
        ADD COLUMN IF NOT EXISTS "bundleHash" character varying(64),
        ADD COLUMN IF NOT EXISTS "promptVersions" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_runs"
        DROP COLUMN IF EXISTS "promptVersions",
        DROP COLUMN IF EXISTS "bundleHash"
    `);
  }
}
