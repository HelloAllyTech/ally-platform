import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants build, stage 1b (D14): the crisis flag fields on `chatbot_conversations`, a
 * `crisis` needs-a-person reason, and the `alert_outbox` that alert emails, the fixed holding
 * and "no one is available" messages and the staff Slack fallback go through.
 *
 * Additive only: no column or table is dropped or renamed; `safety_at` keeps being written. The
 * CHECK on `needs_person_reason` is widened by one value (`crisis`), the only way a crisis
 * conversation can sit in the needs-a-person queue. Hand-written, like every recent one here.
 */
export class AddCrisisFlagsAndAlertOutbox1986600000000 implements MigrationInterface {
  name = 'AddCrisisFlagsAndAlertOutbox1986600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations"
         ADD COLUMN IF NOT EXISTS "safety_first_at" TIMESTAMP,
         ADD COLUMN IF NOT EXISTS "safety_level" smallint,
         ADD COLUMN IF NOT EXISTS "safety_taken_at" TIMESTAMP,
         ADD COLUMN IF NOT EXISTS "retain_until" TIMESTAMP`,
    );
    // Level: 1 at risk, 2 medical emergency.
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" DROP CONSTRAINT IF EXISTS "CHK_chatbot_conversations_safety_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "CHK_chatbot_conversations_safety_level" CHECK ("safety_level" IS NULL OR "safety_level" IN (1, 2))`,
    );
    // The job's scan: flagged, not taken yet.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chatbot_conversations_safety_untaken"
         ON "chatbot_conversations" ("safety_first_at")
         WHERE "safety_first_at" IS NOT NULL AND "safety_taken_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" DROP CONSTRAINT IF EXISTS "CHK_chatbot_conversations_needs_person_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "CHK_chatbot_conversations_needs_person_reason" CHECK ("needs_person_reason" IS NULL OR "needs_person_reason" IN ('asked', 'declined_twice', 'assistant', 'crisis'))`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "alert_outbox" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "chatbot_id" uuid NOT NULL,
         "conversation_id" uuid,
         "kind" character varying(32) NOT NULL,
         "recipient" character varying(320) NOT NULL,
         "channel" character varying(16) NOT NULL,
         "payload" jsonb NOT NULL DEFAULT '{}',
         "dedupe_key" character varying(200),
         "state" character varying(16) NOT NULL DEFAULT 'pending',
         "attempts" integer NOT NULL DEFAULT 0,
         "next_attempt_at" TIMESTAMP NOT NULL DEFAULT now(),
         "sent_at" TIMESTAMP,
         "last_error" text,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_alert_outbox" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_alert_outbox_state" CHECK ("state" IN ('pending', 'sending', 'sent', 'failed')),
         CONSTRAINT "CHK_alert_outbox_channel" CHECK ("channel" IN ('email', 'whatsapp', 'web', 'slack'))
       )`,
    );
    // The claim's scan.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_alert_outbox_due" ON "alert_outbox" ("next_attempt_at") WHERE "state" IN ('pending', 'sending')`,
    );
    // Once per chatbot and key: a holding message, a "no one is available" message, an alert to
    // one person for one flag.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_alert_outbox_dedupe" ON "alert_outbox" ("chatbot_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_alert_outbox_conversation" ON "alert_outbox" ("conversation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "alert_outbox"`);
    await queryRunner.query(
      `UPDATE "chatbot_conversations" SET "needs_person_reason" = 'asked' WHERE "needs_person_reason" = 'crisis'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" DROP CONSTRAINT IF EXISTS "CHK_chatbot_conversations_needs_person_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "CHK_chatbot_conversations_needs_person_reason" CHECK ("needs_person_reason" IS NULL OR "needs_person_reason" IN ('asked', 'declined_twice', 'assistant'))`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_chatbot_conversations_safety_untaken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" DROP CONSTRAINT IF EXISTS "CHK_chatbot_conversations_safety_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations"
         DROP COLUMN IF EXISTS "retain_until",
         DROP COLUMN IF EXISTS "safety_taken_at",
         DROP COLUMN IF EXISTS "safety_level",
         DROP COLUMN IF EXISTS "safety_first_at"`,
    );
  }
}
