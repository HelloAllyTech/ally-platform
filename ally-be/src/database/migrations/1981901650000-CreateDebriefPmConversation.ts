import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Debrief v2: autonomy by default (docs/debrief-harness/V2_AUTONOMY.md).
 *
 * - `debrief_pm_messages` (C1–C3): the one shared PM agent conversation of the
 *   Debrief console. A person's message, then the agent's reply with the
 *   action it took; `plan` on an agent message is an approval waiting for the
 *   person's "yes"; `actions` on a person's message is everything the turn
 *   did, recorded by the gateway (never by what the model says).
 * - `debrief_change_holds` (A9, C2): per-language release pins the runner
 *   honours (a change held or undone for one language, or live only for some),
 *   and pauses of a kind of change until a date.
 * - `debrief_run_feedback.answer` (F1): the Debrief agent's answer to a
 *   learner's flag `{ action, reply, at, model, costUsd }`.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefPmConversation1981901650000 implements MigrationInterface {
  name = 'CreateDebriefPmConversation1981901650000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_pm_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "who" varchar(8) NOT NULL CHECK ("who" IN ('person','agent')),
        "authorUserId" int NULL,
        "authorName" varchar(200) NULL,
        "text" text NOT NULL,
        "about" jsonb NULL,
        "action" jsonb NULL,
        "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "plan" jsonb NULL,
        "replyTo" uuid NULL,
        "status" varchar(16) NULL,
        "model" varchar(80) NULL,
        "costUsd" numeric(10,4) NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_debrief_pm_messages_created" ON "debrief_pm_messages" ("createdAt" DESC)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_change_holds" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "kind" varchar(12) NOT NULL CHECK ("kind" IN ('language','pause')),
        "language" varchar(10) NULL,
        "changeKind" varchar(20) NULL,
        "releaseId" uuid NULL,
        "ideaId" uuid NULL,
        "reason" varchar(12) NOT NULL CHECK ("reason" IN ('held','undone','only','paused')),
        "until" timestamp NULL,
        "note" text NULL,
        "createdBy" int NULL,
        "liftedAt" timestamp NULL,
        "liftedBy" int NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CHECK (("kind" = 'language') = ("language" IS NOT NULL AND "releaseId" IS NOT NULL)),
        CHECK (("kind" = 'pause') = ("changeKind" IS NOT NULL AND "until" IS NOT NULL))
      )
    `);
    // One pin in force per language: the newest decision wins, older ones are lifted first.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_debrief_change_holds_language_active" ON "debrief_change_holds" ("language") WHERE "kind" = 'language' AND "liftedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "debrief_run_feedback" ADD COLUMN IF NOT EXISTS "answer" jsonb NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_run_feedback" DROP COLUMN IF EXISTS "answer"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_change_holds"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_pm_messages"`);
  }
}
