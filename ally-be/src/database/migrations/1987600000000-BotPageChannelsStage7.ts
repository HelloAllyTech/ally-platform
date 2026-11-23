import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants stage 7 — channels.
 *
 * - `chatbot_pages.public_id`: the page's short random address (`/chat/<public_id>`), assigned by
 *   Ally and never editable by the owner. 8 characters of `[a-z0-9]`, unique, and never equal to
 *   any page's legacy slug (so `/b/<slug>` and `/chat/<id>` can never point at two pages).
 *   Existing pages are backfilled here. The column gets a database default
 *   (`ally_bot_page_public_id()`) so an older instance mid-deploy, which inserts pages without it,
 *   still writes a valid row; the new code always sets it itself after a collision check.
 *   `slug` stays, populated and unique: old `/b/<slug>` links and widget embeds keep resolving.
 * - `widget_sites`: every site the website widget has loaded on (it may now load anywhere), with
 *   first and last seen and an approximate load count. Written at most once an hour per site.
 * - `chatbot_domains`: an owner's own domain for the bot page, with the TXT token that proves they
 *   control it and the last DNS check's result. `host` is unique across all chatbots.
 *
 * Additive only (expand-contract safe).
 */
export class BotPageChannelsStage71987600000000 implements MigrationInterface {
  name = 'BotPageChannelsStage71987600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ally_bot_page_public_id() RETURNS varchar AS $$
        SELECT string_agg(
          substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + floor(random() * 36)::int, 1),
          ''
        )
        FROM generate_series(1, 8)
      $$ LANGUAGE sql VOLATILE
    `);
    await queryRunner.query(
      `ALTER TABLE "chatbot_pages" ADD COLUMN IF NOT EXISTS "public_id" character varying(12)`,
    );
    await queryRunner.query(`
      DO $$
      DECLARE
        r record;
        candidate varchar;
      BEGIN
        FOR r IN SELECT id FROM chatbot_pages WHERE public_id IS NULL LOOP
          LOOP
            candidate := ally_bot_page_public_id();
            EXIT WHEN NOT EXISTS (
              SELECT 1 FROM chatbot_pages
              WHERE public_id = candidate OR lower(slug) = candidate
            );
          END LOOP;
          UPDATE chatbot_pages SET public_id = candidate WHERE id = r.id;
        END LOOP;
      END $$
    `);
    await queryRunner.query(
      `ALTER TABLE "chatbot_pages" ALTER COLUMN "public_id" SET DEFAULT ally_bot_page_public_id()`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_pages" ALTER COLUMN "public_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_chatbot_pages_public_id" ON "chatbot_pages" ("public_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "widget_sites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "chatbot_id" uuid NOT NULL,
        "host" character varying(253) NOT NULL,
        "first_seen" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_seen" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "load_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_widget_sites_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_widget_sites_chatbot" FOREIGN KEY ("chatbot_id")
          REFERENCES "chatbots"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_widget_sites_chatbot_host" ON "widget_sites" ("chatbot_id", "host")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chatbot_domains" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "chatbot_id" uuid NOT NULL,
        "host" character varying(253) NOT NULL,
        "verification_token" character varying(64) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "last_check" jsonb,
        "checked_at" TIMESTAMPTZ,
        "verified_at" TIMESTAMPTZ,
        "created_by" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chatbot_domains_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_chatbot_domains_status" CHECK ("status" IN ('pending', 'verified', 'failed')),
        CONSTRAINT "FK_chatbot_domains_chatbot" FOREIGN KEY ("chatbot_id")
          REFERENCES "chatbots"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_chatbot_domains_host" ON "chatbot_domains" (lower("host"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chatbot_domains_chatbot" ON "chatbot_domains" ("chatbot_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chatbot_domains"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "widget_sites"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_chatbot_pages_public_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_pages" DROP COLUMN IF EXISTS "public_id"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS ally_bot_page_public_id()`,
    );
  }
}
