import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product planning P4 and P8 (plans/roadmap-owns-planning rev 5.2).
 *
 * - `plan_checks`: one review-board check (safety, privacy, AI quality) per
 *   plan and kind, with its findings and how the lead resolved each.
 * - `plan_outcome_reviews`: one outcome review per plan and due date.
 * - `plan_suggestions`: ideas the weekly signal scout suggests to Leads.
 */
export class AddPlanChecksAndOutcomeReviews1981900200000 implements MigrationInterface {
  name = 'AddPlanChecksAndOutcomeReviews1981900200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_checks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL,
        "mode" varchar(8) NOT NULL DEFAULT 'live',
        "findings" jsonb NOT NULL DEFAULT '[]',
        "factsHash" varchar(64) NULL,
        "error" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_checks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_plan_checks_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_plan_checks_kind" CHECK ("kind" IN ('safety', 'privacy', 'ai_quality')),
        CONSTRAINT "CHK_plan_checks_status" CHECK ("status" IN ('running', 'findings', 'resolved', 'failed')),
        CONSTRAINT "CHK_plan_checks_mode" CHECK ("mode" IN ('shadow', 'live'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_plan_checks_session_kind"
        ON "plan_checks" ("sessionId", "kind")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_outcome_reviews" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "dueDate" date NOT NULL,
        "verdict" varchar(20) NOT NULL,
        "observed" text NOT NULL,
        "reasons" text NOT NULL,
        "nextSteps" jsonb NOT NULL DEFAULT '[]',
        "chunkCode" varchar(32) NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_outcome_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "FK_plan_outcome_reviews_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_plan_outcome_reviews_verdict" CHECK ("verdict" IN (
          'hit', 'partial', 'miss', 'too_early', 'measurement_broken'
        ))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_plan_outcome_reviews_session_due"
        ON "plan_outcome_reviews" ("sessionId", "dueDate")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_suggestions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" varchar(200) NOT NULL,
        "problem" text NOT NULL,
        "who" text NOT NULL,
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "whyNow" text NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "status" varchar(12) NOT NULL DEFAULT 'open',
        "decidedBy" integer NULL,
        "decidedAt" timestamptz NULL,
        "sessionId" uuid NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_suggestions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_plan_suggestions_status" CHECK ("status" IN ('open', 'dismissed', 'worked_up'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_plan_suggestions_status"
        ON "plan_suggestions" ("status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_suggestions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_outcome_reviews"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_checks"`);
  }
}
