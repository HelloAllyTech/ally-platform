import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants build, stage 7: the Overview's two new daily numbers on the rollup. `people` is the
 * distinct end persons (contacts) who wrote that day; `handover_wait_p50` is the median minutes
 * from a chat needing a person (or a crisis flag) to the first reply from a person.
 *
 * Additive only (expand-contract): nullable-free `people` defaults to 0, the wait is null with no
 * answered hand-over. No existing column changes; the hourly job fills both.
 */
export class AddOverviewDailyStats1987200000000 implements MigrationInterface {
  name = 'AddOverviewDailyStats1987200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_daily_stats"
         ADD COLUMN IF NOT EXISTS "people" integer NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS "handover_wait_p50" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_daily_stats"
         DROP COLUMN IF EXISTS "handover_wait_p50",
         DROP COLUMN IF EXISTS "people"`,
    );
  }
}
