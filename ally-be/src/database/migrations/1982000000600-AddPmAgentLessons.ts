import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PM Agent weekly lessons (docs/pm-agent.md, "Contract addendum … Weekly lessons").
 *
 * Lessons are `pm_agent_memory` rows with `kind = 'lesson'` (no new table). This adds the
 * lesson-only columns (all NULL / false for facts), widens the memory `scope` CHECK with the
 * lesson scopes `category` and `lane`, the `source` CHECK with `weekly_job`, and gives the
 * settings singleton the job's switch, weekday and last-run record. Nothing is backfilled:
 * no lesson rows exist before this.
 */
export class AddPmAgentLessons1982000000600 implements MigrationInterface {
  name = 'AddPmAgentLessons1982000000600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const memoryColumns = [
      `"lessonStatus" varchar(16) NULL`,
      `"lane" varchar(32) NULL`,
      `"category" varchar(32) NULL`,
      `"supportCount" integer NULL`,
      `"supportRatio" numeric(4,3) NULL`,
      `"evidenceCardIds" jsonb NULL`,
      `"evalResult" jsonb NULL`,
      `"requiresConfirm" boolean NOT NULL DEFAULT false`,
      `"lastSupportedAt" timestamptz NULL`,
      `"predicate" jsonb NULL`,
      `"lessonEvents" jsonb NULL`,
    ];
    for (const column of memoryColumns) {
      await queryRunner.query(
        `ALTER TABLE "pm_agent_memory" ADD COLUMN IF NOT EXISTS ${column}`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_memory_scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" ADD CONSTRAINT "CHK_pm_agent_memory_scope" CHECK ("scope" IN ('global', 'feature', 'tenant', 'category', 'lane'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_memory_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" ADD CONSTRAINT "CHK_pm_agent_memory_source" CHECK ("source" IN ('card', 'answer', 'rejection', 'feedback', 'manual', 'weekly_job'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_memory_lesson_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" ADD CONSTRAINT "CHK_pm_agent_memory_lesson_status" CHECK ("lessonStatus" IS NULL OR "lessonStatus" IN ('proposed', 'active', 'expired', 'removed'))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_memory_lesson_status" ON "pm_agent_memory" ("lessonStatus") WHERE "kind" = 'lesson'`,
    );

    await queryRunner.query(
      `ALTER TABLE "pm_agent_settings" ADD COLUMN IF NOT EXISTS "lessonsEnabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_settings" ADD COLUMN IF NOT EXISTS "lessonsWeekday" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_settings" ADD COLUMN IF NOT EXISTS "lessonsLastRunDate" date NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_settings" ADD COLUMN IF NOT EXISTS "lessonsLastRun" jsonb NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_settings" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_settings_lessons_weekday"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_settings" ADD CONSTRAINT "CHK_pm_agent_settings_lessons_weekday" CHECK ("lessonsWeekday" BETWEEN 0 AND 6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pm_agent_settings" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_settings_lessons_weekday"`,
    );
    for (const column of [
      'lessonsLastRun',
      'lessonsLastRunDate',
      'lessonsWeekday',
      'lessonsEnabled',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "pm_agent_settings" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
    // Lesson rows cannot satisfy the narrower CHECKs; they go with the columns.
    await queryRunner.query(
      `DELETE FROM "pm_agent_memory" WHERE "kind" = 'lesson'`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_pm_agent_memory_lesson_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_memory_lesson_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_memory_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" ADD CONSTRAINT "CHK_pm_agent_memory_source" CHECK ("source" IN ('card', 'answer', 'rejection', 'feedback', 'manual'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_memory_scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_memory" ADD CONSTRAINT "CHK_pm_agent_memory_scope" CHECK ("scope" IN ('global', 'feature', 'tenant'))`,
    );
    for (const column of [
      'lessonEvents',
      'predicate',
      'lastSupportedAt',
      'requiresConfirm',
      'evalResult',
      'evidenceCardIds',
      'supportRatio',
      'supportCount',
      'category',
      'lane',
      'lessonStatus',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "pm_agent_memory" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
