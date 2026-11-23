import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 12: one conversation store for every channel.
 *
 * Today every conversation is a WhatsApp one (`wa_contacts`, `wa_conversations`, `wa_messages`).
 * The bot page, the website widget and onboarding's readiness check need conversations that belong
 * to no particular channel, so these four tables hold them. WhatsApp writes to both stores while
 * the switch is on; `wa_*` stays the source of truth until a later chunk says otherwise.
 *
 * - `chatbot_contacts`: a person, scoped to one bot. Profile fields and memory come in chunks 7–8.
 * - `chatbot_contact_identities`: how a contact is recognised on a channel (a phone, a visitor id,
 *   an email), unique per channel, value and bot.
 * - `chatbot_conversations`: a thread. Rows copied from WhatsApp keep their `wa_conversations.id`,
 *   so LangGraph checkpoints (thread = conversation id) stay valid.
 * - `chatbot_messages`: every message on any channel. Rows copied from WhatsApp keep their
 *   `wa_messages.id` and `createdAt`, so history reads back in the same order.
 *
 * Named `chatbot_*` because `messages` already belongs to the chat module.
 */
export class CreateChatbotSharedStore1980990000001 implements MigrationInterface {
  name = 'CreateChatbotSharedStore1980990000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chatbot_contacts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "display_name" text, CONSTRAINT "PK_chatbot_contacts_id" PRIMARY KEY ("id"), CONSTRAINT "FK_chatbot_contacts_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_contacts_chatbot" ON "chatbot_contacts" ("chatbot_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "chatbot_contact_identities" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "contact_id" uuid NOT NULL, "chatbot_id" uuid NOT NULL, "channel" character varying(16) NOT NULL, "external_id" character varying(256) NOT NULL, "verified" boolean NOT NULL DEFAULT false, "verified_at" TIMESTAMP, CONSTRAINT "PK_chatbot_contact_identities_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_contact_identities_channel" CHECK ("channel" IN ('whatsapp', 'web', 'email')), CONSTRAINT "FK_chatbot_contact_identities_contact" FOREIGN KEY ("contact_id") REFERENCES "chatbot_contacts"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_contact_identities_channel_external" ON "chatbot_contact_identities" ("channel", "external_id", "chatbot_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_contact_identities_contact" ON "chatbot_contact_identities" ("contact_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "chatbot_conversations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "channel" character varying(16) NOT NULL, "connector_id" uuid, "status" character varying(16) NOT NULL DEFAULT 'open', "started_at" TIMESTAMP NOT NULL, "last_message_at" TIMESTAMP NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}', "summary" text, CONSTRAINT "PK_chatbot_conversations_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_conversations_channel" CHECK ("channel" IN ('whatsapp', 'web', 'email')), CONSTRAINT "CHK_chatbot_conversations_status" CHECK ("status" IN ('open', 'closed')), CONSTRAINT "FK_chatbot_conversations_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE, CONSTRAINT "FK_chatbot_conversations_contact" FOREIGN KEY ("contact_id") REFERENCES "chatbot_contacts"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_conversations_chatbot" ON "chatbot_conversations" ("chatbot_id", "last_message_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_conversations_open" ON "chatbot_conversations" ("contact_id", "chatbot_id", "channel", "last_message_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE "chatbot_messages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "channel" character varying(16) NOT NULL, "direction" character varying(16) NOT NULL, "role" character varying(16) NOT NULL, "text" text NOT NULL, "attachments" jsonb, "handled_by" character varying(24), "citations" jsonb, "retrieval_meta" jsonb, "agent_run_id" uuid, "agent_runtime" character varying(16), "provider_message_id" character varying(128), "status" character varying(16) NOT NULL DEFAULT 'received', "language" character varying(16), "template_id" uuid, "latency_ms" integer, "error_message" text, "in_reply_to_id" uuid, CONSTRAINT "PK_chatbot_messages_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_messages_channel" CHECK ("channel" IN ('whatsapp', 'web', 'email')), CONSTRAINT "CHK_chatbot_messages_role" CHECK ("role" IN ('user', 'assistant')), CONSTRAINT "FK_chatbot_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chatbot_conversations"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_messages_conversation" ON "chatbot_messages" ("conversation_id", "createdAt")`,
    );
    // The dedupe key, as `uq_wa_messages_provider_id` is on WhatsApp, but per channel: two
    // providers can issue the same id.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_messages_provider_id" ON "chatbot_messages" ("channel", "provider_message_id") WHERE "provider_message_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chatbot_messages"`);
    await queryRunner.query(`DROP TABLE "chatbot_conversations"`);
    await queryRunner.query(`DROP TABLE "chatbot_contact_identities"`);
    await queryRunner.query(`DROP TABLE "chatbot_contacts"`);
  }
}
