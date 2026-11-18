import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Learner progress in debriefs: one row per Debrief agent run where the
 * progress agent ran — the trends it proposed after the code vetoes, the
 * follow-ups on past points, the focus it set, the vetoes themselves, and
 * whether the learner got a line or the "Your last n sessions" card.
 *
 * Append-only. The evidence it cites stays in the published runs (the
 * Analyst's evidence maps); this is the result, read back as the next run's
 * "last progress report" and by the Console's session view. A row goes with
 * its run and with its session (FK cascade).
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefProgressResults1981901100000 implements MigrationInterface {
  name = 'CreateDebriefProgressResults1981901100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_progress_results" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" varchar NULL,
        "counselor_id" integer NOT NULL,
        "run_id" uuid NOT NULL,
        "scenario_session_id" uuid NOT NULL,
        "window_session_ids" uuid[] NOT NULL DEFAULT '{}',
        "skills" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "followups" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "focus" jsonb NULL,
        "vetoes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "shown_as" varchar(8) NOT NULL,
        "analyst_versions" integer[] NOT NULL DEFAULT '{}',
        "model" varchar NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_debrief_progress_results" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_progress_results_run" FOREIGN KEY ("run_id")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_debrief_progress_results_session" FOREIGN KEY ("scenario_session_id")
          REFERENCES "scenario_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_debrief_progress_results_shown_as" CHECK ("shown_as" IN ('line','card'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_progress_results_learner_idx"
        ON "debrief_progress_results" ("counselor_id", "tenant_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_progress_results_run_idx"
        ON "debrief_progress_results" ("run_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_progress_results"`);
  }
}
