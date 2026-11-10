import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product planning P1–P2 (plans/roadmap-owns-planning rev 5.2).
 *
 * - `builder_sessions.plan`: the plan's own record (PlanRecord), its own
 *   column because `metadata` is rewritten wholesale by the interview summary.
 * - `builder_sessions.planStage` / `planStageAt` and the same pair on
 *   `roadmap_opportunities`: the derived stage, written only by
 *   PlanStageService. CHECK mirrors PlanStage.
 * - `plan_notifications`: in-app notices for plan authors and leads, who are
 *   usually not Builder users. CHECK mirrors PlanNotificationKind.
 */
export class AddPlanSessionStateAndNotifications1981900100000 implements MigrationInterface {
  name = 'AddPlanSessionStateAndNotifications1981900100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "builder_sessions"
        ADD COLUMN IF NOT EXISTS "plan" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "planStage" varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS "planStageAt" timestamptz NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_plan_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD CONSTRAINT "CHK_builder_sessions_plan_stage"
         CHECK ("planStage" IS NULL OR "planStage" IN (
           'idea', 'filed', 'prd', 'design', 'ready', 'building', 'launching',
           'measuring', 'learned', 'closed'
         ))`,
    );

    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD COLUMN IF NOT EXISTS "planStage" varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS "planStageAt" timestamptz NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_plan_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities"
         ADD CONSTRAINT "CHK_roadmap_opportunities_plan_stage"
         CHECK ("planStage" IS NULL OR "planStage" IN (
           'idea', 'filed', 'prd', 'design', 'ready', 'building', 'launching',
           'measuring', 'learned', 'closed'
         ))`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_roadmap_opps_plan_stage"
        ON "roadmap_opportunities" ("planStage")
        WHERE "planStage" IS NOT NULL AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recipientUserId" integer NOT NULL,
        "sessionId" uuid NOT NULL,
        "kind" varchar(24) NOT NULL,
        "message" text NOT NULL,
        "readAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plan_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_plan_notifications_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_plan_notifications_kind" CHECK ("kind" IN (
          'archive_soon', 'archived', 'purge_soon', 'taken_on', 'handed_back',
          'nudge', 'auto_released', 'prd_ready', 'sent_to_build', 'launched',
          'outcome', 'closed', 'close_confirm', 'author_question',
          'author_answered', 'ceiling_warning', 'check_finding'
        ))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_plan_notifications_recipient"
        ON "plan_notifications" ("recipientUserId", "readAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_notifications"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_roadmap_opps_plan_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_plan_stage"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        DROP COLUMN IF EXISTS "planStageAt",
        DROP COLUMN IF EXISTS "planStage"
    `);
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_plan_stage"`,
    );
    await queryRunner.query(`
      ALTER TABLE "builder_sessions"
        DROP COLUMN IF EXISTS "planStageAt",
        DROP COLUMN IF EXISTS "planStage",
        DROP COLUMN IF EXISTS "plan"
    `);
  }
}
