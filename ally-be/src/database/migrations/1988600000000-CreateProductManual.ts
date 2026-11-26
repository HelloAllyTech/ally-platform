import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product Manual: a read-only, DB-backed guide to the whole product for Ally staff (admin → Roadmap →
 * Product Manual). It lives only in the database because the monorepo and the developer wiki are public.
 *
 *  - `manual_pages`      the pages and section headings, with a generated full-text `search_vector`.
 *  - `manual_revisions`  every change as a full copy of the page: the visible change log and the
 *                        source for one-click revert.
 *  - `manual_links`      `[[slug]]` cross-links, rebuilt on write; backlinks and the map read it.
 *  - `manual_proposals`  "the manual needs to change" notes from coding agents and from chat gaps.
 *  - `manual_settings`   singleton (id = 1) for the weekly agent: off by default, USD monthly budget.
 *  - `manual_runs`       one row per weekly / run-now pass; at most one `running`.
 *  - `manual_agent_keys` proposal-scoped keys for coding agents (hash only).
 *  - `manual_conversations` a user's chats and their drafts tray.
 *
 * varchar + CHECK rather than Postgres enums, matching the rest of the schema.
 */
export class CreateProductManual1988600000000 implements MigrationInterface {
  name = 'CreateProductManual1988600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "manual_pages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug" varchar(120) NOT NULL,
        "title" varchar(200) NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "parent_slug" varchar(120),
        "position" integer NOT NULL DEFAULT 0,
        "kind" varchar(10) NOT NULL DEFAULT 'page',
        "body" text NOT NULL DEFAULT '',
        "roles" text[] NOT NULL DEFAULT '{}',
        "surfaces" text[] NOT NULL DEFAULT '{}',
        "journeys" text[] NOT NULL DEFAULT '{}',
        "release_state" varchar(10) NOT NULL DEFAULT 'live',
        "next_since" timestamptz,
        "verified_at" timestamptz,
        "verified_ref" varchar(80),
        "created_by" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "search_vector" tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
          setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
          setweight(to_tsvector('english', coalesce("body", '')), 'C')
        ) STORED,
        CONSTRAINT "PK_manual_pages" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_manual_pages_kind" CHECK ("kind" IN ('section', 'page')),
        CONSTRAINT "CHK_manual_pages_release_state" CHECK ("release_state" IN ('live', 'next'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_manual_pages_slug" ON "manual_pages" ("slug") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_manual_pages_parent" ON "manual_pages" ("parent_slug", "position") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_manual_pages_search" ON "manual_pages" USING GIN ("search_vector")`,
    );

    await queryRunner.query(`
      CREATE TABLE "manual_revisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "page_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "body" text NOT NULL DEFAULT '',
        "author_kind" varchar(16) NOT NULL,
        "author_ref" varchar(120),
        "reason" text NOT NULL DEFAULT '',
        "source_refs" jsonb NOT NULL DEFAULT '[]',
        "revert_of" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_manual_revisions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_manual_revisions_page" FOREIGN KEY ("page_id")
          REFERENCES "manual_pages" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_manual_revisions_author_kind"
          CHECK ("author_kind" IN ('seed', 'weekly_agent', 'chat_agent', 'proposal', 'human', 'revert'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_manual_revisions_page" ON "manual_revisions" ("page_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_manual_revisions_recent" ON "manual_revisions" ("created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "manual_links" (
        "from_slug" varchar(120) NOT NULL,
        "to_slug" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_manual_links" PRIMARY KEY ("from_slug", "to_slug")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_manual_links_to" ON "manual_links" ("to_slug")`,
    );

    await queryRunner.query(`
      CREATE TABLE "manual_proposals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" varchar(10) NOT NULL,
        "page_slug" varchar(120),
        "summary" text NOT NULL,
        "detail" text NOT NULL DEFAULT '',
        "pr_ref" varchar(200),
        "source" varchar(16) NOT NULL,
        "key_id" uuid,
        "submitted_by" integer,
        "status" varchar(10) NOT NULL DEFAULT 'open',
        "applied_revision_id" uuid,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_manual_proposals" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_manual_proposals_kind" CHECK ("kind" IN ('edit', 'new_page', 'gap')),
        CONSTRAINT "CHK_manual_proposals_source" CHECK ("source" IN ('coding_agent', 'chat')),
        CONSTRAINT "CHK_manual_proposals_status" CHECK ("status" IN ('open', 'applied', 'dismissed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_manual_proposals_status" ON "manual_proposals" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_manual_proposals_page" ON "manual_proposals" ("page_slug")`,
    );

    await queryRunner.query(`
      CREATE TABLE "manual_settings" (
        "id" integer NOT NULL DEFAULT 1,
        "enabled" boolean NOT NULL DEFAULT false,
        "monthly_budget_usd" numeric(10,2) NOT NULL DEFAULT 100,
        "last_run_date" date,
        "last_run" jsonb,
        "updated_by" integer,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_manual_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_manual_settings_singleton" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(
      `INSERT INTO "manual_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(`
      CREATE TABLE "manual_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "trigger" varchar(12) NOT NULL,
        "status" varchar(10) NOT NULL DEFAULT 'running',
        "stop_reason" varchar(30),
        "reserved_usd" numeric(10,4) NOT NULL DEFAULT 0,
        "spent_usd" numeric(10,4) NOT NULL DEFAULT 0,
        "pages_touched" integer NOT NULL DEFAULT 0,
        "proposals_applied" integer NOT NULL DEFAULT 0,
        "summary" text,
        "error" text,
        "triggered_by" integer,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        CONSTRAINT "PK_manual_runs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_manual_runs_trigger" CHECK ("trigger" IN ('scheduled', 'manual')),
        CONSTRAINT "CHK_manual_runs_status" CHECK ("status" IN ('running', 'done', 'failed', 'skipped'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_manual_runs_one_running" ON "manual_runs" ((1)) WHERE "status" = 'running'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_manual_runs_started" ON "manual_runs" ("started_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "manual_agent_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" integer NOT NULL,
        "label" varchar(80) NOT NULL,
        "key_hash" varchar(64) NOT NULL,
        "key_prefix" varchar(12) NOT NULL,
        "last_used_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_manual_agent_keys" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_manual_agent_keys_hash" ON "manual_agent_keys" ("key_hash")`,
    );

    await queryRunner.query(`
      CREATE TABLE "manual_conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer NOT NULL,
        "title" varchar(200) NOT NULL DEFAULT 'New chat',
        "messages" jsonb NOT NULL DEFAULT '[]',
        "drafts" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_manual_conversations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_manual_conversations_user" ON "manual_conversations" ("user_id", "updated_at" DESC) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [
      'manual_conversations',
      'manual_agent_keys',
      'manual_runs',
      'manual_settings',
      'manual_proposals',
      'manual_links',
      'manual_revisions',
      'manual_pages',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${t}"`);
    }
  }
}
