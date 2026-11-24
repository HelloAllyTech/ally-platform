import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants build, stage 5: customer data, knowledge and sharing.
 *
 * - `memory_consents`: one row per chatbot and person (an end person when known, else a contact),
 *   asked / granted / declined, with the wording version shown (memory consent, D7).
 * - `kb_documents`: `last_read_at` (staleness), `pii_review` + `pii_findings` (personal-data
 *   review before indexing), `curated` (the curated pool, distinct from `is_global`) and
 *   `copied_from_document_id` (copy, not share).
 * - `wa_keyword_templates`: `locked` (crisis/STOP/START wording not editable on a chatbot's copy)
 *   and `extra_numbers` (regional numbers a builder may add to a locked row).
 * - `wa_conversations.parked` and `connectors.parked`: chatbot-less threads and unbound
 *   connectors, hidden from builder lists by the migration script.
 * - `chatbots.copied_from_chatbot_id`: a duplicate's source.
 * - `safety_translations`: reviewed translations of the fixed safety texts per language.
 *
 * Additive only (expand-contract): nothing is dropped or renamed, no existing column changes.
 * Hand-written, like every recent one here. CHECK constraints are on new columns only.
 */
export class AssistantsCustomerDataKnowledgeSharing1986900000000 implements MigrationInterface {
  name = 'AssistantsCustomerDataKnowledgeSharing1986900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "memory_consents" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "chatbot_id" uuid NOT NULL,
         "subject_key" character varying(80) NOT NULL,
         "end_person_id" uuid,
         "contact_id" uuid,
         "state" character varying(16) NOT NULL,
         "asked_at" TIMESTAMP,
         "decided_at" TIMESTAMP,
         "wording_version" character varying(40) NOT NULL,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_memory_consents" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_memory_consents_state" CHECK ("state" IN ('asked', 'granted', 'declined')),
         CONSTRAINT "FK_memory_consents_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_memory_consents_subject" ON "memory_consents" ("chatbot_id", "subject_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_memory_consents_contact" ON "memory_consents" ("contact_id") WHERE "contact_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "kb_documents"
         ADD COLUMN IF NOT EXISTS "last_read_at" TIMESTAMP,
         ADD COLUMN IF NOT EXISTS "pii_review" character varying(16),
         ADD COLUMN IF NOT EXISTS "pii_findings" jsonb,
         ADD COLUMN IF NOT EXISTS "curated" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "copied_from_document_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP CONSTRAINT IF EXISTS "CHK_kb_documents_pii_review"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_documents" ADD CONSTRAINT "CHK_kb_documents_pii_review" CHECK ("pii_review" IS NULL OR "pii_review" IN ('needs_review', 'approved', 'excluded'))`,
    );
    // Existing documents were read when they were last indexed; the nudge starts from there.
    await queryRunner.query(
      `UPDATE "kb_documents" SET "last_read_at" = "updatedAt" WHERE "last_read_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_documents_curated" ON "kb_documents" ("curated") WHERE "curated" = true AND "archived_at" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates"
         ADD COLUMN IF NOT EXISTS "locked" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "extra_numbers" text[] NOT NULL DEFAULT '{}'`,
    );
    // One copy per chatbot and global reply, so the per-chatbot copy is idempotent.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_wa_keyword_templates_bot_override"
         ON "wa_keyword_templates" ("chatbot_id", "overrides_template_id")
         WHERE "chatbot_id" IS NOT NULL AND "overrides_template_id" IS NOT NULL AND "archived_at" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "wa_conversations" ADD COLUMN IF NOT EXISTS "parked" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "connectors" ADD COLUMN IF NOT EXISTS "parked" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD COLUMN IF NOT EXISTS "copied_from_chatbot_id" uuid`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "safety_translations" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "chatbot_id" uuid,
         "language" character varying(16) NOT NULL,
         "kind" character varying(32) NOT NULL,
         "text" text NOT NULL,
         "reviewed" boolean NOT NULL DEFAULT false,
         "reviewed_by" integer,
         "reviewed_at" TIMESTAMP,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_safety_translations" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_safety_translations_kind" CHECK ("kind" IN ('crisis_help', 'holding', 'no_one_available', 'no_answer', 'blocked_notice')),
         CONSTRAINT "CHK_safety_translations_text" CHECK (length(btrim("text")) > 0),
         CONSTRAINT "FK_safety_translations_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_safety_translations_scope"
         ON "safety_translations" (COALESCE("chatbot_id", '00000000-0000-0000-0000-000000000000'::uuid), "language", "kind")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_translations"`);
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP COLUMN IF EXISTS "copied_from_chatbot_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "connectors" DROP COLUMN IF EXISTS "parked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_conversations" DROP COLUMN IF EXISTS "parked"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_wa_keyword_templates_bot_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" DROP COLUMN IF EXISTS "extra_numbers", DROP COLUMN IF EXISTS "locked"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_kb_documents_curated"`);
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP CONSTRAINT IF EXISTS "CHK_kb_documents_pii_review"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_documents"
         DROP COLUMN IF EXISTS "copied_from_document_id",
         DROP COLUMN IF EXISTS "curated",
         DROP COLUMN IF EXISTS "pii_findings",
         DROP COLUMN IF EXISTS "pii_review",
         DROP COLUMN IF EXISTS "last_read_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "memory_consents"`);
  }
}
