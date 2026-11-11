import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk Q2a: the live scorecard. A visitor's thumbs up or down on one answer (its own
 * table, so the shared store's message log stays append-only), and one row of numbers per
 * assistant per day, filled by the hourly job and read by the Overview.
 */
export class CreateScorecard1981320000000 implements MigrationInterface {
  name = 'CreateScorecard1981320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chatbot_message_feedback" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "chatbot_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "rating" character varying(8) NOT NULL, "reason" character varying(16), "note" character varying(300), "status" character varying(16) NOT NULL DEFAULT 'open', "handled_by" integer, "handled_at" TIMESTAMP, CONSTRAINT "PK_chatbot_message_feedback_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_chatbot_message_feedback_message" UNIQUE ("message_id"), CONSTRAINT "CHK_chatbot_message_feedback_rating" CHECK ("rating" IN ('up', 'down')), CONSTRAINT "CHK_chatbot_message_feedback_reason" CHECK ("reason" IS NULL OR "reason" IN ('wrong_info', 'not_answered', 'other')), CONSTRAINT "CHK_chatbot_message_feedback_status" CHECK ("status" IN ('open', 'fine', 'corrected')), CONSTRAINT "FK_chatbot_message_feedback_message" FOREIGN KEY ("message_id") REFERENCES "chatbot_messages"("id") ON DELETE CASCADE, CONSTRAINT "FK_chatbot_message_feedback_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_message_feedback_chatbot" ON "chatbot_message_feedback" ("chatbot_id", "rating", "status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE TABLE "chatbot_daily_stats" ("chatbot_id" uuid NOT NULL, "day" date NOT NULL, "conversations" integer NOT NULL DEFAULT 0, "answers" integer NOT NULL DEFAULT 0, "answered_with_source" integer NOT NULL DEFAULT 0, "declined" integer NOT NULL DEFAULT 0, "wrong_decline_suspected" integer NOT NULL DEFAULT 0, "handed_over" integer NOT NULL DEFAULT 0, "crisis" integer NOT NULL DEFAULT 0, "thumbs_up" integer NOT NULL DEFAULT 0, "thumbs_down" integer NOT NULL DEFAULT 0, "reply_ms_p50" integer, "reply_ms_p90" integer, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_chatbot_daily_stats" PRIMARY KEY ("chatbot_id", "day"), CONSTRAINT "FK_chatbot_daily_stats_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chatbot_daily_stats"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_chatbot_message_feedback_chatbot"`,
    );
    await queryRunner.query(`DROP TABLE "chatbot_message_feedback"`);
  }
}
