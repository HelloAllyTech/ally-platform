import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 11a: the inbox. The single switch (`handled_by_user_id`: a team member has the
 * chat, so the assistant doesn't answer), Needs a person, Safety, who wrote a team member's reply,
 * and who has read what. All additive.
 */
export class AddInbox1981330000000 implements MigrationInterface {
  name = 'AddInbox1981330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations"
         ADD "handled_by_user_id" integer,
         ADD "handled_since" TIMESTAMP,
         ADD "needs_person_since" TIMESTAMP,
         ADD "needs_person_reason" character varying(16),
         ADD "safety_at" TIMESTAMP,
         ADD "last_human_reply_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "CHK_chatbot_conversations_needs_person_reason" CHECK ("needs_person_reason" IS NULL OR "needs_person_reason" IN ('asked', 'declined_twice'))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_conversations_needs_person" ON "chatbot_conversations" ("chatbot_id", "needs_person_since") WHERE "needs_person_since" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_conversations_held" ON "chatbot_conversations" ("handled_by_user_id") WHERE "handled_by_user_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_messages" ADD "sent_by_user_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_messages" DROP CONSTRAINT "CHK_chatbot_messages_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_messages" ADD CONSTRAINT "CHK_chatbot_messages_role" CHECK ("role" IN ('user', 'assistant', 'agent_human'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_messages" ADD "sent_by_user_id" integer`,
    );
    await queryRunner.query(
      `CREATE TABLE "chatbot_conversation_reads" ("conversation_id" uuid NOT NULL, "user_id" integer NOT NULL, "read_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_chatbot_conversation_reads" PRIMARY KEY ("conversation_id", "user_id"), CONSTRAINT "FK_chatbot_conversation_reads_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chatbot_conversations"("id") ON DELETE CASCADE)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chatbot_conversation_reads"`);
    await queryRunner.query(
      `ALTER TABLE "wa_messages" DROP COLUMN "sent_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_messages" DROP CONSTRAINT "CHK_chatbot_messages_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_messages" ADD CONSTRAINT "CHK_chatbot_messages_role" CHECK ("role" IN ('user', 'assistant'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_messages" DROP COLUMN "sent_by_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_chatbot_conversations_held"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_chatbot_conversations_needs_person"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" DROP CONSTRAINT "CHK_chatbot_conversations_needs_person_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations"
         DROP COLUMN "last_human_reply_at", DROP COLUMN "safety_at",
         DROP COLUMN "needs_person_reason", DROP COLUMN "needs_person_since",
         DROP COLUMN "handled_since", DROP COLUMN "handled_by_user_id"`,
    );
  }
}
