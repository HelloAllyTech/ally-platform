import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What learners tell us about a Debrief agent debrief: one "Was this helpful?"
 * answer per learner per debrief, and "This isn't right" flags on single
 * cards, each reviewed by the Ally team (kept or removed, with a note the
 * learner sees). A flag on the important moment is urgent.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefRunFeedback1980820000000 implements MigrationInterface {
  name = 'CreateDebriefRunFeedback1980820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_run_feedback" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "runId" uuid NOT NULL,
        "scenarioSessionId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "kind" character varying(12) NOT NULL,
        "helpful" boolean,
        "section" character varying(48),
        "reason" character varying(24),
        "note" text,
        "urgent" boolean NOT NULL DEFAULT false,
        "status" character varying(12) NOT NULL,
        "resolvedBy" integer,
        "resolvedAt" TIMESTAMP,
        "resolutionNote" text,
        CONSTRAINT "PK_debrief_run_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_run_feedback_run" FOREIGN KEY ("runId")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_debrief_run_feedback_kind" CHECK ("kind" IN ('helpful','flag')),
        CONSTRAINT "CHK_debrief_run_feedback_reason" CHECK ("reason" IS NULL OR "reason" IN ('didnt_say','described_wrongly','advice_doesnt_fit','something_else')),
        CONSTRAINT "CHK_debrief_run_feedback_status" CHECK ("status" IN ('open','kept','removed','withdrawn','noted')),
        CONSTRAINT "CHK_debrief_run_feedback_shape" CHECK (
          ("kind" = 'helpful' AND "helpful" IS NOT NULL AND "section" IS NULL)
          OR ("kind" = 'flag' AND "section" IS NOT NULL AND "reason" IS NOT NULL)
        )
      )
    `);
    // One answer per learner per debrief, one flag per card per learner.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_run_feedback_helpful_uq"
        ON "debrief_run_feedback" ("runId", "userId") WHERE "kind" = 'helpful'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_run_feedback_flag_uq"
        ON "debrief_run_feedback" ("runId", "userId", "section") WHERE "kind" = 'flag'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_run_feedback_open_idx"
        ON "debrief_run_feedback" ("createdAt") WHERE "status" = 'open'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_run_feedback"`);
  }
}
