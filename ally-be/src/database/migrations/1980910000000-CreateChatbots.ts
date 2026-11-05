import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chatbots: configurable bots that are connected to channels, instead of one bot per organisation.
 *
 * A chatbot carries its own persona, answer mode, model, knowledge and settings overrides. It is
 * reached through CONNECTORS — today a WhatsApp number, later Slack, IVR or anything else — and a
 * connector serves at most one bot. Who may manage a bot (`chatbot_members`) and who may chat with
 * it (`chatbot_audience`) are separate lists, and one person can be on many bots in either.
 *
 * Conversion of the organisation-based setup, so every number keeps answering as it did:
 *  - each live WhatsApp number becomes a connector, bound to a new "<organisation> assistant" bot
 *    carrying that organisation's settings overrides, keyword replies and documents (its targeted
 *    documents plus the shared ones), with the organisation as its audience and the
 *    organisation's assigned Ally admins as editors;
 *  - one "Ally assistant" bot serves the platform number configured in env vars (no number row).
 *    It keeps today's per-asker behaviour — `knowledge_source = 'organisation'` answers each
 *    recognised worker from their own organisation's documents plus the shared ones — and is
 *    stored as the platform default in the `whatsapp_bot` settings row;
 *  - conversations are stamped with the bot and connector they happened on, so history stays with
 *    the bot that answered even if a number is later moved to another bot.
 *
 * `wa_org_settings` is dropped (its rows now live on each bot) and keyword replies are re-keyed
 * from organisation to bot.
 */
export class CreateChatbots1980910000000 implements MigrationInterface {
  name = 'CreateChatbots1980910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chatbots" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "description" text, "status" character varying(16) NOT NULL DEFAULT 'draft', "access_mode" character varying(16) NOT NULL DEFAULT 'listed', "answer_mode" character varying(32) NOT NULL DEFAULT 'documents_only', "knowledge_source" character varying(16) NOT NULL DEFAULT 'selected', "persona" jsonb NOT NULL DEFAULT '{}', "model" jsonb, "settings" jsonb NOT NULL DEFAULT '{}', "created_by" integer NOT NULL, "updated_by" integer, "archived_at" TIMESTAMP, CONSTRAINT "PK_chatbots_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbots_active" ON "chatbots" ("createdAt") WHERE "archived_at" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "chatbot_members" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "user_id" integer NOT NULL, "role" character varying(16) NOT NULL, "created_by" integer, CONSTRAINT "PK_chatbot_members_id" PRIMARY KEY ("id"), CONSTRAINT "FK_chatbot_members_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_members_bot_user" ON "chatbot_members" ("chatbot_id", "user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_members_user" ON "chatbot_members" ("user_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "chatbot_audience" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "kind" character varying(16) NOT NULL, "value" character varying(255) NOT NULL, "label" text, "created_by" integer, CONSTRAINT "PK_chatbot_audience_id" PRIMARY KEY ("id"), CONSTRAINT "FK_chatbot_audience_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_audience_entry" ON "chatbot_audience" ("chatbot_id", "kind", "value")`,
    );

    await queryRunner.query(
      `CREATE TABLE "chatbot_documents" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "document_id" uuid NOT NULL, "created_by" integer, CONSTRAINT "PK_chatbot_documents_id" PRIMARY KEY ("id"), CONSTRAINT "FK_chatbot_documents_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_documents_bot_doc" ON "chatbot_documents" ("chatbot_id", "document_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_documents_document" ON "chatbot_documents" ("document_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "connectors" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(32) NOT NULL, "name" character varying(120) NOT NULL, "chatbot_id" uuid, "status" character varying(24) NOT NULL DEFAULT 'pending', "config" jsonb NOT NULL DEFAULT '{}', "created_by" integer NOT NULL, "updated_by" integer, "deletedAt" TIMESTAMP, CONSTRAINT "PK_connectors_id" PRIMARY KEY ("id"), CONSTRAINT "FK_connectors_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE SET NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_connectors_chatbot" ON "connectors" ("chatbot_id") WHERE "deletedAt" IS NULL`,
    );

    // A WhatsApp number is the WhatsApp connector's typed store. It no longer has to belong to an
    // organisation — Ally's own production number belongs to none.
    await queryRunner.query(
      `ALTER TABLE "wa_business_numbers" ADD "connector_id" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_business_numbers_connector" ON "wa_business_numbers" ("connector_id") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_business_numbers" ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_wa_business_numbers_tenant"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wa_conversations" ADD "chatbot_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_conversations" ADD "connector_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wa_conversations_chatbot" ON "wa_conversations" ("chatbot_id", "last_message_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" ADD "chatbot_id" uuid`,
    );

    // ── Conversion ─────────────────────────────────────────────────────────
    const numbers: {
      id: string;
      tenant_id: string;
      tenant_name: string | null;
      status: string;
      display_phone_number: string | null;
      created_by: number;
      settings: Record<string, unknown> | null;
    }[] = await queryRunner.query(
      `SELECT n.id, n.tenant_id, t.name AS tenant_name, n.status, n.display_phone_number, n.created_by, s.settings
         FROM "wa_business_numbers" n
         LEFT JOIN "tenants" t ON t.id = n.tenant_id
         LEFT JOIN "wa_org_settings" s ON s.tenant_id = n.tenant_id
        WHERE n."deletedAt" IS NULL`,
    );

    for (const number of numbers) {
      const name = `${number.tenant_name ?? 'Organisation'} assistant`;
      const [bot] = await queryRunner.query(
        `INSERT INTO "chatbots" ("name", "status", "access_mode", "answer_mode", "knowledge_source", "persona", "settings", "created_by")
         VALUES ($1, $2, 'listed', 'documents_only', 'selected', $3, $4, $5) RETURNING id`,
        [
          name,
          number.status === 'connected' ? 'live' : 'draft',
          JSON.stringify({ displayName: name }),
          JSON.stringify(number.settings ?? {}),
          number.created_by,
        ],
      );
      const [connector] = await queryRunner.query(
        `INSERT INTO "connectors" ("type", "name", "chatbot_id", "status", "created_by")
         VALUES ('whatsapp', $1, $2, $3, $4) RETURNING id`,
        [
          `WhatsApp ${number.display_phone_number ?? ''}`.trim(),
          bot.id,
          number.status,
          number.created_by,
        ],
      );
      await queryRunner.query(
        `UPDATE "wa_business_numbers" SET "connector_id" = $1 WHERE id = $2`,
        [connector.id, number.id],
      );
      await queryRunner.query(
        `INSERT INTO "chatbot_audience" ("chatbot_id", "kind", "value", "label")
         VALUES ($1, 'organisation', $2, $3)`,
        [bot.id, number.tenant_id, number.tenant_name],
      );
      // What the organisation answered from: its targeted documents and the shared ones.
      await queryRunner.query(
        `INSERT INTO "chatbot_documents" ("chatbot_id", "document_id")
         SELECT $1, d.id FROM "kb_documents" d
          WHERE d.corpus = 'whatsapp_qa' AND d.archived_at IS NULL
            AND (d.is_global = true OR EXISTS (
                  SELECT 1 FROM "kb_document_tenants" dt
                   WHERE dt.document_id = d.id AND dt.tenant_id = $2 AND dt."deletedAt" IS NULL))`,
        [bot.id, number.tenant_id],
      );
      await queryRunner.query(
        `INSERT INTO "chatbot_members" ("chatbot_id", "user_id", "role")
         SELECT $1, a."userId", 'editor' FROM "admin_tenants" a
          WHERE a."tenantId" = $2 AND a."deletedAt" IS NULL
         ON CONFLICT DO NOTHING`,
        [bot.id, number.tenant_id],
      );
      await queryRunner.query(
        `UPDATE "wa_keyword_templates" SET "chatbot_id" = $1 WHERE "tenant_id" = $2`,
        [bot.id, number.tenant_id],
      );
      await queryRunner.query(
        `UPDATE "wa_conversations" c SET "chatbot_id" = $1, "connector_id" = $2
           FROM "wa_contacts" ct WHERE ct.id = c.contact_id AND ct.business_number_id = $3`,
        [bot.id, connector.id, number.id],
      );
    }

    // The platform number (env vars, no row). Same behaviour as before: any recognised worker,
    // answered from their own organisation's documents plus the shared ones.
    const [platformBot] = await queryRunner.query(
      `INSERT INTO "chatbots" ("name", "status", "access_mode", "answer_mode", "knowledge_source", "persona", "created_by")
       VALUES ('Ally assistant', 'live', 'recognised', 'documents_only', 'organisation', $1, 0) RETURNING id`,
      [JSON.stringify({ displayName: 'Ally' })],
    );
    await queryRunner.query(
      `UPDATE "wa_conversations" c SET "chatbot_id" = $1
         FROM "wa_contacts" ct WHERE ct.id = c.contact_id AND ct.business_number_id IS NULL`,
      [platformBot.id],
    );
    await queryRunner.query(
      `UPDATE "global_settings" SET "value" = jsonb_set("value", '{platformChatbotId}', to_jsonb($1::text))
        WHERE "name" = 'whatsapp_bot'`,
      [platformBot.id],
    );

    // Replies of organisations that had no number have no bot to go to; they were unreachable.
    await queryRunner.query(
      `DELETE FROM "wa_keyword_templates" WHERE "tenant_id" IS NOT NULL AND "chatbot_id" IS NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_wa_keyword_templates_override"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_wa_keyword_templates_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wa_keyword_templates_chatbot" ON "wa_keyword_templates" ("chatbot_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_keyword_templates_override" ON "wa_keyword_templates" ("chatbot_id", "overrides_template_id") WHERE "overrides_template_id" IS NOT NULL AND "archived_at" IS NULL`,
    );

    await queryRunner.query(`DROP TABLE "wa_org_settings"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wa_org_settings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "settings" jsonb NOT NULL DEFAULT '{}', "created_by" integer NOT NULL, "updated_by" integer, CONSTRAINT "PK_wa_org_settings_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_org_settings_tenant" ON "wa_org_settings" ("tenant_id")`,
    );
    // Back to one settings row and one reply set per organisation, taken from the bot its number
    // was bound to. Bots with no organisation number have nowhere to go back to.
    await queryRunner.query(
      `INSERT INTO "wa_org_settings" ("tenant_id", "settings", "created_by")
       SELECT DISTINCT ON (n.tenant_id) n.tenant_id, b.settings, b.created_by
         FROM "wa_business_numbers" n
         JOIN "connectors" c ON c.id = n.connector_id
         JOIN "chatbots" b ON b.id = c.chatbot_id
        WHERE n.tenant_id IS NOT NULL AND n."deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."uq_wa_keyword_templates_override"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_wa_keyword_templates_chatbot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" ADD "tenant_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "wa_keyword_templates" t SET "tenant_id" = n.tenant_id
         FROM "connectors" c JOIN "wa_business_numbers" n ON n.connector_id = c.id
        WHERE c.chatbot_id = t.chatbot_id AND n.tenant_id IS NOT NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "wa_keyword_templates" WHERE "chatbot_id" IS NOT NULL AND "tenant_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" DROP COLUMN "chatbot_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wa_keyword_templates_tenant" ON "wa_keyword_templates" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_keyword_templates_override" ON "wa_keyword_templates" ("tenant_id", "overrides_template_id") WHERE "overrides_template_id" IS NOT NULL AND "archived_at" IS NULL`,
    );

    await queryRunner.query(
      `UPDATE "global_settings" SET "value" = "value" - 'platformChatbotId' WHERE "name" = 'whatsapp_bot'`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."idx_wa_conversations_chatbot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_conversations" DROP COLUMN "connector_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_conversations" DROP COLUMN "chatbot_id"`,
    );

    // Numbers without an organisation (added after the move to chatbots) cannot go back.
    await queryRunner.query(
      `DELETE FROM "wa_business_numbers" WHERE "tenant_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_business_numbers" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_business_numbers_tenant" ON "wa_business_numbers" ("tenant_id") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_wa_business_numbers_connector"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_business_numbers" DROP COLUMN "connector_id"`,
    );

    await queryRunner.query(`DROP TABLE "connectors"`);
    await queryRunner.query(`DROP TABLE "chatbot_documents"`);
    await queryRunner.query(`DROP TABLE "chatbot_audience"`);
    await queryRunner.query(`DROP TABLE "chatbot_members"`);
    await queryRunner.query(`DROP TABLE "chatbots"`);
  }
}
