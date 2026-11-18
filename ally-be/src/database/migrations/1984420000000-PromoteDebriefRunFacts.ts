import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Facts the Debrief reads in SQL (nightly check, console, trials, drain) sat inside
 * `debrief_runs.workspace` with no index: the judge's overall score, model and prompt version, how
 * the language was found, and the retry counter. They become real columns. Additive: `workspace`
 * keeps its copies for now and every reader falls back to it, so an older ally-be running during a
 * deploy, and every older row, still work. The backfill only fills empty columns, so a re-run
 * changes nothing. Also the (status, createdAt) index the drain and sweeps filter on.
 */
export class PromoteDebriefRunFacts1984420000000 implements MigrationInterface {
  name = 'PromoteDebriefRunFacts1984420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_runs"
        ADD COLUMN IF NOT EXISTS "judgeOverall" numeric(4,2),
        ADD COLUMN IF NOT EXISTS "judgeModel" character varying(80),
        ADD COLUMN IF NOT EXISTS "judgePromptVersion" character varying(80),
        ADD COLUMN IF NOT EXISTS "languageSource" character varying(40),
        ADD COLUMN IF NOT EXISTS "retries" smallint NOT NULL DEFAULT 0
    `);
    // Fill only what is empty: safe to run again, and never overwrites a column a newer writer set.
    await queryRunner.query(`
      UPDATE "debrief_runs"
         SET "judgeOverall" = (workspace->'judge'->>'overall')::numeric,
             "judgeModel" = left(workspace->'judge'->>'model', 80),
             "judgePromptVersion" = left(workspace->'judge'->>'promptVersion', 80)
       WHERE "judgeOverall" IS NULL
         AND workspace->'judge'->>'overall' ~ '^-?[0-9]+(\\.[0-9]+)?$'
    `);
    await queryRunner.query(`
      UPDATE "debrief_runs"
         SET "languageSource" = left(workspace->>'languageSource', 40)
       WHERE "languageSource" IS NULL AND workspace->>'languageSource' IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "debrief_runs"
         SET "retries" = (workspace->>'retries')::int
       WHERE "retries" = 0 AND workspace->>'retries' ~ '^[0-9]+$'
         AND (workspace->>'retries')::int BETWEEN 1 AND 32000
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_runs_status_created_at_idx"
        ON "debrief_runs" ("status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "debrief_runs_status_created_at_idx"`,
    );
    await queryRunner.query(`
      ALTER TABLE "debrief_runs"
        DROP COLUMN IF EXISTS "retries",
        DROP COLUMN IF EXISTS "languageSource",
        DROP COLUMN IF EXISTS "judgePromptVersion",
        DROP COLUMN IF EXISTS "judgeModel",
        DROP COLUMN IF EXISTS "judgeOverall"
    `);
  }
}
