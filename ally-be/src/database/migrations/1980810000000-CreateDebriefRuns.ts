import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One row per Debrief agent run: which release and recipe ran, every step's
 * timing, model and estimated cost, the rule-check failures, the Evaluator's
 * verdict, the fallback rung reached, and the cards it produced.
 *
 * `mode` separates what learners can see (`live`), the shadow runs that sit
 * beside today's debrief until launch (`shadow`), and the learning loop's own
 * replays on the test sets (`replay`), which never count against production
 * spend. One production run (shadow or live) per session; replays are many.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefRuns1980810000000 implements MigrationInterface {
  name = 'CreateDebriefRuns1980810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "scenarioSessionId" uuid NOT NULL,
        "mode" character varying(12) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'queued',
        "skipReason" character varying(40),
        "releaseId" uuid,
        "releaseVersion" integer,
        "recipeKey" character varying(20),
        "experimentId" uuid,
        "arm" character varying(16),
        "language" character varying(10),
        "learnerTurns" integer NOT NULL DEFAULT 0,
        "hasRiskCue" boolean NOT NULL DEFAULT false,
        "learnerDistress" boolean NOT NULL DEFAULT false,
        "fallbackRung" smallint NOT NULL DEFAULT 0,
        "revisionRounds" smallint NOT NULL DEFAULT 0,
        "ceilingUsd" numeric(10,4),
        "estimatedCostUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "actualCostUsd" numeric(10,4),
        "evaluatorOverall" numeric(4,2),
        "evaluatorHardFails" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "checkFailures" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "workspace" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "cards" jsonb,
        "error" text,
        "startedAt" TIMESTAMP,
        "finishedAt" TIMESTAMP,
        CONSTRAINT "PK_debrief_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_runs_session" FOREIGN KEY ("scenarioSessionId")
          REFERENCES "scenario_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_debrief_runs_mode" CHECK ("mode" IN ('shadow','live','replay')),
        CONSTRAINT "CHK_debrief_runs_status" CHECK ("status" IN ('queued','running','published','below_bar','needs_person','skipped','failed')),
        CONSTRAINT "CHK_debrief_runs_arm" CHECK ("arm" IS NULL OR "arm" IN ('baseline','challenger'))
      )
    `);
    // One production debrief per session: the drain and a retry can race,
    // and the loser must not write a second debrief the learner might see.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_runs_production_session_uq"
        ON "debrief_runs" ("scenarioSessionId") WHERE "mode" IN ('shadow','live')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_runs_created_at_idx"
        ON "debrief_runs" ("createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_runs_experiment_idx"
        ON "debrief_runs" ("experimentId") WHERE "experimentId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_runs"`);
  }
}
