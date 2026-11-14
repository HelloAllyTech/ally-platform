import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Debrief agent's Agent logs: one row per model call or deciding code
 * step of a run — the exact message each agent was sent and its full reply
 * (model steps), or the step's real inputs and results (code steps). For
 * debugging an agent and improving it later; read by the Ally team only.
 *
 * Append-only. A row goes with its run (FK cascade), and a run with its
 * session, so deleting a session deletes its logs. The system prompt is never
 * copied: `prompt_code` + `prompt_version` name the Skills Store version that
 * stands in for `{{system_prompt}}` in `input`.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefRunLogs1981901000000 implements MigrationInterface {
  name = 'CreateDebriefRunLogs1981901000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_run_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" varchar NULL,
        "run_id" uuid NOT NULL,
        "seq" integer NOT NULL,
        "step" varchar(60) NOT NULL,
        "round" integer NULL,
        "kind" varchar(8) NOT NULL,
        "model" varchar(120) NULL,
        "fallback_model" varchar(120) NULL,
        "prompt_code" varchar(120) NULL,
        "prompt_version" integer NULL,
        "input" jsonb NULL,
        "output" jsonb NULL,
        "tokens_in" integer NULL,
        "tokens_out" integer NULL,
        "cost_usd" numeric(12,6) NULL,
        "ms" integer NULL,
        "retries" integer NOT NULL DEFAULT 0,
        "error" text NULL,
        "attention" boolean NOT NULL DEFAULT false,
        "started_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_debrief_run_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_run_logs_run" FOREIGN KEY ("run_id")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_debrief_run_logs_kind" CHECK ("kind" IN ('model','code'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_run_logs_run_seq_uq"
        ON "debrief_run_logs" ("run_id", "seq")
    `);
    // "Full agent logs are kept for runs from <date>": the first row's day.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_run_logs_created_at_idx"
        ON "debrief_run_logs" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_run_logs"`);
  }
}
