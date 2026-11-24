import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants build plan, stage 3 (Create and Build). Additive only (expand-contract):
 *
 * - `bot_drafts` becomes every chatbot's working copy for its whole life (still one row per chatbot,
 *   `uq_bot_drafts_chatbot`):
 *   - `live_at`: when the chatbot first went live. Before it, edits are projected onto the chatbot
 *     row as they always were; after it, the working copy is a server-side override for tests and
 *     reaches customers only on Apply (R3).
 *   - `live_base`: per staged field, the hash of the live value the working copy last agreed with,
 *     so an edit made on the live row elsewhere (the old home screen) is picked up rather than
 *     reported as a pending change that would undo it.
 *   - `blank` / `touched_at`: a chatbot created at the click, before anything was chosen. "Untouched"
 *     is the explicit null `touched_at`, never inferred from timestamps.
 *   - `build_mode`: the builder's last mode on this chatbot (Copilot or the form).
 *   Existing drafts keep everything; they are marked touched (their old `step` is simply ignored by
 *   the new screen) and the ones whose chatbot is not a draft any more are marked live.
 * - `chatbot_template_installs` records the version of an Ally library template and which kind of
 *   template it was.
 * - `usage_events.kind` admits `template_index`: indexing a template's knowledge is Ally's cost (R4).
 */
export class WorkingCopyBlankChatbotsTemplates1986800000000 implements MigrationInterface {
  name = 'WorkingCopyBlankChatbotsTemplates1986800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bot_drafts"
        ADD COLUMN IF NOT EXISTS "blank" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "touched_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "live_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "live_base" jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS "build_mode" varchar(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "bot_drafts" DROP CONSTRAINT IF EXISTS "CHK_bot_drafts_build_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "bot_drafts" ADD CONSTRAINT "CHK_bot_drafts_build_mode"
        CHECK ("build_mode" IS NULL OR "build_mode" IN ('copilot','form'))
    `);
    // Drafts already in progress keep their data and are touched (never swept as blanks).
    await queryRunner.query(`
      UPDATE "bot_drafts" SET "touched_at" = "updatedAt"
       WHERE "touched_at" IS NULL AND "blank" = false
    `);
    // A chatbot that is live or paused has gone live: its working copy waits for Apply from now on.
    await queryRunner.query(`
      UPDATE "bot_drafts" d SET "live_at" = d."updatedAt"
        FROM "chatbots" c
       WHERE c.id = d.chatbot_id AND c.status <> 'draft' AND d."live_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_bot_drafts_untouched_blank"
        ON "bot_drafts" ("owner_user_id", "createdAt")
        WHERE "blank" = true AND "touched_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "chatbot_template_installs"
        ADD COLUMN IF NOT EXISTS "template_version" integer,
        ADD COLUMN IF NOT EXISTS "template_kind" varchar(16) NOT NULL DEFAULT 'code'
    `);
    await queryRunner.query(`
      ALTER TABLE "chatbot_template_installs"
        DROP CONSTRAINT IF EXISTS "CHK_chatbot_template_installs_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "chatbot_template_installs" ADD CONSTRAINT "CHK_chatbot_template_installs_kind"
        CHECK ("template_kind" IN ('code','library'))
    `);

    await queryRunner.query(`
      ALTER TABLE "usage_events" DROP CONSTRAINT IF EXISTS "CHK_usage_events_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "usage_events" ADD CONSTRAINT "CHK_usage_events_kind" CHECK ("kind" IN ('customer_reply','crisis_check','memory_check','summary','setup','site_reading','indexing','checkup','judge','change_by_chat','try_it','instructions','whatsapp','other','template_index'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "usage_events" WHERE "kind" = 'template_index'`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_events" DROP CONSTRAINT IF EXISTS "CHK_usage_events_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "usage_events" ADD CONSTRAINT "CHK_usage_events_kind" CHECK ("kind" IN ('customer_reply','crisis_check','memory_check','summary','setup','site_reading','indexing','checkup','judge','change_by_chat','try_it','instructions','whatsapp','other'))
    `);
    await queryRunner.query(`
      ALTER TABLE "chatbot_template_installs"
        DROP CONSTRAINT IF EXISTS "CHK_chatbot_template_installs_kind",
        DROP COLUMN IF EXISTS "template_kind",
        DROP COLUMN IF EXISTS "template_version"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_bot_drafts_untouched_blank"`,
    );
    await queryRunner.query(`
      ALTER TABLE "bot_drafts"
        DROP CONSTRAINT IF EXISTS "CHK_bot_drafts_build_mode",
        DROP COLUMN IF EXISTS "build_mode",
        DROP COLUMN IF EXISTS "live_base",
        DROP COLUMN IF EXISTS "live_at",
        DROP COLUMN IF EXISTS "touched_at",
        DROP COLUMN IF EXISTS "blank"
    `);
  }
}
