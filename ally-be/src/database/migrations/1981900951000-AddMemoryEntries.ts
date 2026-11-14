import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 8a: memory, light. `memory_entries` holds what an assistant remembers about one
 * contact, one short line each, with the person message it came from. Lines are derived data, so
 * erasure and retention delete them (never blank them).
 *
 * - `section`: preferences, context or open_items. `source_kind`: person (the assistant wrote it
 *   from what they said) or owner (an editor changed its text in the Inbox).
 * - `said_at`: when the person last said it. Saying it again renews it. Nothing derived from a
 *   message outlives that message's retention, so the sweep deletes a line once `said_at` passes
 *   the cutoff, and `expires_at` is never later than `said_at` plus the retention days.
 * - `run_id` is the run that wrote it; text, like `tool_runs`, because Preview never writes here.
 *
 * The rolling summary uses the existing `chatbot_conversations.summary` and needs no column.
 */
export class AddMemoryEntries1981900951000 implements MigrationInterface {
  name = 'AddMemoryEntries1981900951000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "memory_entries" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "chatbot_id" uuid NOT NULL,
         "contact_id" uuid NOT NULL,
         "section" character varying(16) NOT NULL,
         "text" character varying(200) NOT NULL,
         "source_message_id" uuid,
         "source_kind" character varying(8) NOT NULL DEFAULT 'person',
         "run_id" text,
         "status" character varying(12) NOT NULL DEFAULT 'active',
         "said_at" TIMESTAMP NOT NULL DEFAULT now(),
         "expires_at" TIMESTAMP,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_memory_entries" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_memory_entries_section" CHECK ("section" IN ('preferences', 'context', 'open_items')),
         CONSTRAINT "CHK_memory_entries_source_kind" CHECK ("source_kind" IN ('person', 'owner')),
         CONSTRAINT "CHK_memory_entries_status" CHECK ("status" IN ('active', 'done', 'forgotten')),
         CONSTRAINT "CHK_memory_entries_text" CHECK (length(btrim("text")) > 0),
         CONSTRAINT "FK_memory_entries_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_memory_entries_contact" FOREIGN KEY ("contact_id") REFERENCES "chatbot_contacts"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_memory_entries_source_message" FOREIGN KEY ("source_message_id") REFERENCES "chatbot_messages"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_memory_entries_person" ON "memory_entries" ("chatbot_id", "contact_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_memory_entries_expires" ON "memory_entries" ("expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_memory_entries_said" ON "memory_entries" ("said_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "memory_entries"`);
  }
}
