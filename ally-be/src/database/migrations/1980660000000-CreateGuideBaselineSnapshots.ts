import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `guide_baseline_snapshots` (plans/ally-guide/plan.md decision 19, §8.1,
 * §13.3): with no classic holdout, the guided experience is judged against
 * how public courses did before it — completion, first-day wins, return,
 * quiz first-attempt pass — captured once before launch and on demand after.
 * Aggregates only; no learner appears in a row.
 */
export class CreateGuideBaselineSnapshots1980660000000 implements MigrationInterface {
  name = 'CreateGuideBaselineSnapshots1980660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "guide_baseline_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "windowDays" integer NOT NULL,
        "windowStart" timestamp NOT NULL,
        "windowEnd" timestamp NOT NULL,
        "capturedByUserId" integer,
        "note" character varying(500),
        "metrics" jsonb NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_baseline_snapshots_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_guide_baseline_snapshots_created" ON "guide_baseline_snapshots" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "guide_baseline_snapshots"`);
  }
}
