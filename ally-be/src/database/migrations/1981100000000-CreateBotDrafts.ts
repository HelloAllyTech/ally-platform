import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 20a: agent-first onboarding.
 *
 * - `bot_drafts`: one onboarding session, holding everything until it is published as a chatbot
 *   (the crawl, what was learned, the safety pack, answers, the typed draft, the builder chat and
 *   an append-only change log for undo). ally-be owns it; the builder only proposes patches.
 * - `chatbots.safety_pack` (+ version) and `chatbots.rules`: the pack a bot was built with, and the
 *   owner's own Never lines. The engine adds both to every run, so editing the instructions can't
 *   remove them, and a settings change that weakens the pack is refused.
 */
export class CreateBotDrafts1981100000000 implements MigrationInterface {
  name = 'CreateBotDrafts1981100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bot_drafts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "owner_user_id" integer NOT NULL, "tenant_id" uuid, "status" character varying(16) NOT NULL DEFAULT 'active', "step" character varying(16) NOT NULL DEFAULT 'start', "source" jsonb NOT NULL DEFAULT '{}', "crawl" jsonb NOT NULL DEFAULT '{"status":"idle","queue":[],"seen":[],"pages":[],"findings":[]}', "learned" jsonb NOT NULL DEFAULT '{"facts":[],"dropped":0}', "industry" character varying(32), "safety_pack" character varying(32), "safety_pack_version" integer, "answers" jsonb NOT NULL DEFAULT '{}', "design" jsonb NOT NULL DEFAULT '{}', "draft_config" jsonb NOT NULL, "chatbot_id" uuid, "transcript" jsonb NOT NULL DEFAULT '[]', "events" jsonb NOT NULL DEFAULT '[]', "version" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_bot_drafts_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_bot_drafts_status" CHECK ("status" IN ('active', 'published', 'abandoned')), CONSTRAINT "CHK_bot_drafts_step" CHECK ("step" IN ('start', 'reading', 'learned', 'safety', 'gaps', 'design', 'building', 'checkup', 'try_it', 'share', 'published')), CONSTRAINT "CHK_bot_drafts_safety_pack" CHECK ("safety_pack" IS NULL OR "safety_pack" IN ('mental_health', 'medical', 'pharmacy', 'minors', 'legal_financial', 'standard')), CONSTRAINT "FK_bot_drafts_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE SET NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bot_drafts_owner" ON "bot_drafts" ("owner_user_id", "status", "updatedAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_bot_drafts_chatbot" ON "bot_drafts" ("chatbot_id") WHERE "chatbot_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD "safety_pack" character varying(32), ADD "safety_pack_version" integer, ADD "rules" jsonb NOT NULL DEFAULT '{"never":[]}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD CONSTRAINT "CHK_chatbots_safety_pack" CHECK ("safety_pack" IS NULL OR "safety_pack" IN ('mental_health', 'medical', 'pharmacy', 'minors', 'legal_financial', 'standard'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP CONSTRAINT "CHK_chatbots_safety_pack"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP COLUMN "rules", DROP COLUMN "safety_pack_version", DROP COLUMN "safety_pack"`,
    );
    await queryRunner.query(`DROP TABLE "bot_drafts"`);
  }
}
