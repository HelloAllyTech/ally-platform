import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product planning P0 (plans/roadmap-owns-planning rev 5.2): the schema the
 * idea-to-outcome plan builds on. Nothing reads or writes it yet beyond the
 * services that define it, and `builder_settings.planningEnabled` starts off.
 *
 * - `builder_sessions.kind` / `visibility` / `leadUserId`: a plan reuses the
 *   Builder session tables from its first message. Every existing row is a
 *   BUILD session, SHARED, with no lead — exactly what it was before.
 * - `plan_events`: the append-only "who did what" log beside the transcript.
 * - `plan_spend_entries`: the priced, awaited spend ledger behind the meter.
 * - `builder_settings.plan*`: the master switch, one $100 ceiling per plan
 *   (everything from the first message to the outcome review, design and build
 *   runs included) with its $1 Idea-stage wrap-up point, and the second-Lead
 *   vote threshold.
 *
 * CHECK lists mirror BuilderSessionKind, BuilderSessionVisibility, PlanStage
 * and PlanEventKind (check-constraints-cover-enums.spec.ts).
 */
export class AddProductPlanningFoundations1981001400000 implements MigrationInterface {
  name = 'AddProductPlanningFoundations1981001400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "builder_sessions"
        ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'build',
        ADD COLUMN IF NOT EXISTS "visibility" varchar(16) NOT NULL DEFAULT 'shared',
        ADD COLUMN IF NOT EXISTS "leadUserId" integer NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD CONSTRAINT "CHK_builder_sessions_kind"
         CHECK ("kind" IN ('build', 'plan'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_visibility"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD CONSTRAINT "CHK_builder_sessions_visibility"
         CHECK ("visibility" IN ('private', 'shared'))`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_builder_sessions_private_author"
        ON "builder_sessions" ("createdBy", "updatedAt")
        WHERE "visibility" = 'private' AND "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_builder_sessions_lead"
        ON "builder_sessions" ("leadUserId")
        WHERE "leadUserId" IS NOT NULL AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "kind" varchar(32) NOT NULL,
        "actorUserId" integer NULL,
        "detail" jsonb NULL,
        "at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_plan_events_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_plan_events_kind" CHECK ("kind" IN (
          'parked', 'filed', 'taken_on', 'handed_back', 'auto_released',
          'stage_changed', 'archived', 'restored', 'visibility_changed',
          'author_asked', 'budget_changed', 'check_required', 'check_resolved',
          'finding_dismissed', 'measure_frozen', 'measure_changed', 'design_started',
          'design_approved', 'build_sent', 'exported', 'launched',
          'outcome_reviewed', 'closed', 'reopened'
        ))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_plan_events_session_at"
        ON "plan_events" ("sessionId", "at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_spend_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NULL,
        "stage" varchar(16) NULL,
        "actorUserId" integer NULL,
        "specialist" varchar(48) NULL,
        "taskId" varchar(96) NOT NULL,
        "provider" varchar(32) NOT NULL,
        "model" varchar(80) NOT NULL,
        "tokensIn" integer NOT NULL DEFAULT 0,
        "tokensOut" integer NOT NULL DEFAULT 0,
        "cachedTokens" integer NOT NULL DEFAULT 0,
        "cacheWriteTokens" integer NOT NULL DEFAULT 0,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "priced" boolean NOT NULL DEFAULT true,
        "at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_spend_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_plan_spend_entries_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_plan_spend_entries_stage" CHECK ("stage" IS NULL OR "stage" IN (
          'idea', 'filed', 'prd', 'design', 'ready', 'building', 'launching',
          'measuring', 'learned', 'closed'
        ))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_plan_spend_entries_session_at"
        ON "plan_spend_entries" ("sessionId", "at")
    `);

    await queryRunner.query(`
      ALTER TABLE "builder_settings"
        ADD COLUMN IF NOT EXISTS "planningEnabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "planCeilingUsd" numeric(10,4) NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS "planIdeaCeilingUsd" numeric(10,4) NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "planCloseConfirmVotes" integer NOT NULL DEFAULT 10
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "builder_settings"
        DROP COLUMN IF EXISTS "planCloseConfirmVotes",
        DROP COLUMN IF EXISTS "planIdeaCeilingUsd",
        DROP COLUMN IF EXISTS "planCeilingUsd",
        DROP COLUMN IF EXISTS "planningEnabled"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_spend_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_events"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_builder_sessions_lead"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_builder_sessions_private_author"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_visibility"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "builder_sessions"
        DROP COLUMN IF EXISTS "leadUserId",
        DROP COLUMN IF EXISTS "visibility",
        DROP COLUMN IF EXISTS "kind"
    `);
  }
}
