import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Debrief nightly check (v9 FR-49, release-2 plan P3): one row per day and
 * slice — `all`, `language:<code>`, `recipe:<key>` — with that day's measures
 * (words, quotes, sameness across learners, the judge's specificity, the gap
 * between Ally's own check and the independent check) and the alerts raised
 * against the days before. Two more slices: `anchor_set` (the run ids the
 * weekly judge re-score uses, chosen once) and `judge_drift` (each weekly
 * re-score's drift). Ids, numbers and codes only: no debrief text.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefQualityDaily1981901300000 implements MigrationInterface {
  name = 'CreateDebriefQualityDaily1981901300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_quality_daily" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "day" date NOT NULL,
        "slice" varchar(64) NOT NULL,
        "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "alerts" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_debrief_quality_daily" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_debrief_quality_daily_day_slice" UNIQUE ("day", "slice")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_quality_daily"`);
  }
}
