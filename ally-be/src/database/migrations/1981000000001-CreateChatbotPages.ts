import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 12b: the bot page, a branded chat link for one bot.
 *
 * - `chatbot_pages`: one per bot. The slug is the link (`/b/<slug>`), unique ignoring case; the
 *   branding, pre-chat questions, suggested questions and limits are one jsonb blob validated by the
 *   DTO, since they are always read and written together.
 * - `chatbot_page_access`: who may open an organisation-only or invite-only page (emails and
 *   organisations). Deliberately NOT `chatbot_audience`: that list decides who may chat on every
 *   channel, and a page setting must never widen who can reach the bot on WhatsApp.
 *
 * Also an index for the dashboard's channel filter over the shared store.
 */
export class CreateChatbotPages1981000000001 implements MigrationInterface {
  name = 'CreateChatbotPages1981000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chatbot_pages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "slug" character varying(48) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'off', "access" character varying(16) NOT NULL DEFAULT 'invite', "settings" jsonb NOT NULL DEFAULT '{}', "created_by" integer, "updated_by" integer, CONSTRAINT "PK_chatbot_pages_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_pages_status" CHECK ("status" IN ('off', 'on')), CONSTRAINT "CHK_chatbot_pages_access" CHECK ("access" IN ('public', 'organisation', 'invite')), CONSTRAINT "FK_chatbot_pages_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_pages_chatbot" ON "chatbot_pages" ("chatbot_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_pages_slug" ON "chatbot_pages" (lower("slug"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "chatbot_page_access" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "page_id" uuid NOT NULL, "kind" character varying(16) NOT NULL, "value" character varying(256) NOT NULL, "label" character varying(120), "created_by" integer, CONSTRAINT "PK_chatbot_page_access_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_page_access_kind" CHECK ("kind" IN ('email', 'organisation')), CONSTRAINT "FK_chatbot_page_access_page" FOREIGN KEY ("page_id") REFERENCES "chatbot_pages"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_page_access_entry" ON "chatbot_page_access" ("page_id", "kind", "value")`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_conversations_channel" ON "chatbot_conversations" ("chatbot_id", "channel", "last_message_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_chatbot_conversations_channel"`,
    );
    await queryRunner.query(`DROP TABLE "chatbot_page_access"`);
    await queryRunner.query(`DROP TABLE "chatbot_pages"`);
  }
}
