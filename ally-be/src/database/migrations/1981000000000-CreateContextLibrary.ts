import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 1 (docs/context-library/PLAN.md): the engine's tables, the First
 * Principles collection, and access.
 *
 * - No table holds uploaded files or document text. Segment text lives in Redis for at most a
 *   day; `cl_ingest_segments` keeps only hashes, pages and status.
 * - `cl_chunks` is the system of record; the per-collection Weaviate indexes in ally-ai are
 *   derived from it through the `embedding_status` outbox.
 * - Every enum value is pinned by a CHECK constraint, so a typo in code fails loudly.
 *
 * Access: the two permissions go to the platform-tier groups explicitly (the TypeScript
 * spreads are not recomputed into `group_permissions`), and the `context_library` toggle is
 * backfilled on for the same groups, because a new toggle grants itself to nobody. Lists are
 * written out, not imported, so the migration keeps meaning what it meant when it ran.
 * Permissions and toggles are cached in Redis for up to 30 minutes after deploy.
 */
const GROUPS = ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];
const PERMISSIONS = [
  'view:admin:context-library',
  'edit:admin:context-library',
];
const FEATURE_KEY = 'context_library';

const TS = `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`;

export class CreateContextLibrary1981000000000 implements MigrationInterface {
  name = 'CreateContextLibrary1981000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "cl_collections" (${TS},
      "id" character varying(48) NOT NULL,
      "name" character varying(80) NOT NULL,
      "code_prefix" character varying(4) NOT NULL,
      "next_code" integer NOT NULL DEFAULT 1,
      "profile_version" integer NOT NULL DEFAULT 1,
      "density_cap" jsonb,
      "active_search_setup" jsonb,
      "active_index_version" integer NOT NULL DEFAULT 1,
      "status" character varying(16) NOT NULL DEFAULT 'active',
      CONSTRAINT "PK_cl_collections" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_cl_collections_code_prefix" UNIQUE ("code_prefix"),
      CONSTRAINT "CHK_cl_collections_status" CHECK ("status" IN ('active', 'retiring')))`);

    await queryRunner.query(`CREATE TABLE "cl_use_case_access" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "use_case" character varying(40) NOT NULL,
      "collection_id" character varying(48) NOT NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "weight" real NOT NULL DEFAULT 1,
      "updated_by" integer,
      CONSTRAINT "PK_cl_use_case_access" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_use_case_access_collection" FOREIGN KEY ("collection_id") REFERENCES "cl_collections"("id") ON DELETE CASCADE)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_use_case_access" ON "cl_use_case_access" ("use_case", "collection_id")`,
    );
    await queryRunner.query(`CREATE TABLE "cl_use_case_access_log" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "use_case" character varying(40) NOT NULL,
      "collection_id" character varying(48) NOT NULL,
      "enabled_before" boolean,
      "enabled_after" boolean NOT NULL,
      "weight_after" real NOT NULL,
      "changed_by" integer,
      CONSTRAINT "PK_cl_use_case_access_log" PRIMARY KEY ("id"))`);

    await queryRunner.query(`CREATE TABLE "cl_sources" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "title" text NOT NULL,
      "doc_version" character varying(64),
      "year" integer,
      "kind" character varying(16) NOT NULL,
      "language" character varying(16),
      "file_hash" character varying(64),
      "title_key" text NOT NULL,
      "overview" text,
      "overview_state" character varying(16) NOT NULL DEFAULT 'pending',
      "key_terms" jsonb,
      "target_collections" text[] NOT NULL,
      "owner_tenant_id" uuid,
      "consolidated_collections" text[] NOT NULL DEFAULT '{}',
      "page_count" integer NOT NULL DEFAULT 0,
      "segment_count" integer NOT NULL DEFAULT 0,
      "extraction_warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "status" character varying(16) NOT NULL,
      "batch_id" uuid,
      "queue_position" bigint NOT NULL,
      "paused_at" TIMESTAMP,
      "yield" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "distill_model" character varying(80),
      "prompt_versions" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "input_tokens" integer NOT NULL DEFAULT 0,
      "output_tokens" integer NOT NULL DEFAULT 0,
      "cached_input_tokens" integer NOT NULL DEFAULT 0,
      "cost_usd" numeric(10,4) NOT NULL DEFAULT 0,
      "cost_cap_usd" numeric(10,4),
      "generation" integer NOT NULL DEFAULT 1,
      "error" text,
      "uploaded_by" integer,
      CONSTRAINT "PK_cl_sources" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_cl_sources_kind" CHECK ("kind" IN ('pdf', 'epub', 'kb_migration')),
      CONSTRAINT "CHK_cl_sources_status" CHECK ("status" IN ('queued', 'extracting', 'consolidating', 'paused', 'complete', 'failed', 'cancelled', 'archived')),
      CONSTRAINT "CHK_cl_sources_overview_state" CHECK ("overview_state" IN ('pending', 'running', 'done', 'skipped', 'failed')))`);
    await queryRunner.query(
      `CREATE INDEX "idx_cl_sources_file_hash" ON "cl_sources" ("file_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_sources_status" ON "cl_sources" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_sources_title_key" ON "cl_sources" ("title_key")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_ingest_segments" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "source_id" uuid NOT NULL,
      "ordinal" integer NOT NULL,
      "section_path" text,
      "page_from" integer NOT NULL DEFAULT 0,
      "page_to" integer NOT NULL DEFAULT 0,
      "text_hash" character varying(64) NOT NULL,
      "token_count" integer NOT NULL DEFAULT 0,
      "for_overview" boolean NOT NULL DEFAULT false,
      "status" character varying(16) NOT NULL,
      "skipped_reason" character varying(40),
      CONSTRAINT "PK_cl_ingest_segments" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_ingest_segments_source" FOREIGN KEY ("source_id") REFERENCES "cl_sources"("id") ON DELETE CASCADE,
      CONSTRAINT "CHK_cl_ingest_segments_status" CHECK ("status" IN ('pending', 'done', 'failed', 'skipped', 'expired')))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_ingest_segments_source_ordinal" ON "cl_ingest_segments" ("source_id", "ordinal")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_segment_runs" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "segment_id" uuid NOT NULL,
      "source_id" uuid NOT NULL,
      "collection_id" character varying(48) NOT NULL,
      "queue_position" bigint NOT NULL,
      "ordinal" integer NOT NULL,
      "status" character varying(16) NOT NULL,
      "attempts" integer NOT NULL DEFAULT 0,
      "claimed_at" TIMESTAMP,
      "error" text,
      "candidates_found" integer NOT NULL DEFAULT 0,
      "candidates_kept" integer NOT NULL DEFAULT 0,
      "outcomes" jsonb NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT "PK_cl_segment_runs" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_segment_runs_segment" FOREIGN KEY ("segment_id") REFERENCES "cl_ingest_segments"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_cl_segment_runs_source" FOREIGN KEY ("source_id") REFERENCES "cl_sources"("id") ON DELETE CASCADE,
      CONSTRAINT "CHK_cl_segment_runs_status" CHECK ("status" IN ('pending', 'claimed', 'done', 'failed')))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_segment_runs_segment_collection" ON "cl_segment_runs" ("segment_id", "collection_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_segment_runs_claim" ON "cl_segment_runs" ("status", "queue_position", "ordinal")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_segment_runs_source" ON "cl_segment_runs" ("source_id", "collection_id")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_chunks" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "collection_id" character varying(48) NOT NULL,
      "code" character varying(16) NOT NULL,
      "origin" character varying(16) NOT NULL,
      "statement" text NOT NULL,
      "body" text,
      "situations" text[] NOT NULL DEFAULT '{}',
      "example_queries" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "keywords" text[] NOT NULL DEFAULT '{}',
      "topics" text[] NOT NULL DEFAULT '{}',
      "facets" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "citation" jsonb,
      "is_global" boolean NOT NULL DEFAULT true,
      "tenant_ids" text[] NOT NULL DEFAULT '{}',
      "owner_tenant_id" uuid,
      "pinned" boolean NOT NULL DEFAULT false,
      "confidence" character varying(16) NOT NULL DEFAULT 'standard',
      "status" character varying(16) NOT NULL,
      "superseded_by_id" uuid,
      "quality" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "source_count" integer NOT NULL DEFAULT 1,
      "distill_prompt_version" character varying(40),
      "sync_key" character varying(120),
      "agent" character varying(32),
      "embedding_status" character varying(16) NOT NULL DEFAULT 'pending',
      "embedding_attempts" integer NOT NULL DEFAULT 0,
      "embedded_at" TIMESTAMP,
      "text_hash" character varying(64),
      "index_version" integer,
      "times_retrieved" integer NOT NULL DEFAULT 0,
      "times_surfaced" integer NOT NULL DEFAULT 0,
      "times_applied" integer NOT NULL DEFAULT 0,
      "times_contradicted" integer NOT NULL DEFAULT 0,
      "effectiveness" real,
      "last_retrieved_at" TIMESTAMP,
      "last_applied_at" TIMESTAMP,
      "version" integer NOT NULL DEFAULT 1,
      "created_by" integer,
      "edited_by" integer,
      CONSTRAINT "PK_cl_chunks" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_chunks_collection" FOREIGN KEY ("collection_id") REFERENCES "cl_collections"("id"),
      CONSTRAINT "CHK_cl_chunks_origin" CHECK ("origin" IN ('distilled', 'authored', 'imported', 'agent', 'synced')),
      CONSTRAINT "CHK_cl_chunks_status" CHECK ("status" IN ('candidate', 'active', 'archived', 'superseded')),
      CONSTRAINT "CHK_cl_chunks_confidence" CHECK ("confidence" IN ('standard', 'low')),
      CONSTRAINT "CHK_cl_chunks_embedding_status" CHECK ("embedding_status" IN ('pending', 'success', 'failed', 'skipped')),
      CONSTRAINT "CHK_cl_chunks_statement" CHECK (char_length(trim("statement")) > 0))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_chunks_code" ON "cl_chunks" ("code")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_chunks_sync_key" ON "cl_chunks" ("sync_key") WHERE "sync_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunks_collection_status" ON "cl_chunks" ("collection_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunks_owner" ON "cl_chunks" ("owner_tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunks_embedding_pending" ON "cl_chunks" ("embedding_status") WHERE "embedding_status" <> 'success'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunks_facets" ON "cl_chunks" USING GIN ("facets")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_chunk_sources" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "chunk_id" uuid NOT NULL,
      "source_id" uuid NOT NULL,
      "generation" integer NOT NULL DEFAULT 1,
      "section_path" text,
      "page_from" integer NOT NULL DEFAULT 0,
      "page_to" integer NOT NULL DEFAULT 0,
      CONSTRAINT "PK_cl_chunk_sources" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_chunk_sources_chunk" FOREIGN KEY ("chunk_id") REFERENCES "cl_chunks"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_cl_chunk_sources_source" FOREIGN KEY ("source_id") REFERENCES "cl_sources"("id") ON DELETE CASCADE)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_chunk_sources" ON "cl_chunk_sources" ("chunk_id", "source_id", "generation")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunk_sources_chunk" ON "cl_chunk_sources" ("chunk_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunk_sources_source" ON "cl_chunk_sources" ("source_id")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_chunk_relations" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "from_id" uuid NOT NULL,
      "to_id" uuid NOT NULL,
      "type" character varying(16) NOT NULL,
      "note" text,
      "origin" character varying(16) NOT NULL,
      "confidence" real,
      CONSTRAINT "PK_cl_chunk_relations" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_chunk_relations_from" FOREIGN KEY ("from_id") REFERENCES "cl_chunks"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_cl_chunk_relations_to" FOREIGN KEY ("to_id") REFERENCES "cl_chunks"("id") ON DELETE CASCADE,
      CONSTRAINT "CHK_cl_chunk_relations_type" CHECK ("type" IN ('tension', 'refines', 'prerequisite', 'related')),
      CONSTRAINT "CHK_cl_chunk_relations_origin" CHECK ("origin" IN ('adjudicator', 'consolidation', 'curator', 'admin')))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_chunk_relations" ON "cl_chunk_relations" ("from_id", "to_id", "type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunk_relations_from" ON "cl_chunk_relations" ("from_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunk_relations_to" ON "cl_chunk_relations" ("to_id")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_chunk_versions" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "chunk_id" uuid NOT NULL,
      "version" integer NOT NULL,
      "snapshot" jsonb NOT NULL,
      "reason" character varying(40) NOT NULL,
      "edited_by" integer,
      CONSTRAINT "PK_cl_chunk_versions" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_chunk_versions_chunk" FOREIGN KEY ("chunk_id") REFERENCES "cl_chunks"("id") ON DELETE CASCADE)`);
    await queryRunner.query(
      `CREATE INDEX "idx_cl_chunk_versions_chunk" ON "cl_chunk_versions" ("chunk_id", "version")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_bulk_uploads" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "collection_id" character varying(48) NOT NULL,
      "file_name" text NOT NULL,
      "row_count" integer NOT NULL,
      "created_count" integer NOT NULL DEFAULT 0,
      "updated_count" integer NOT NULL DEFAULT 0,
      "rejected" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "status" character varying(16) NOT NULL,
      "owner_tenant_id" uuid,
      "uploaded_by" integer,
      CONSTRAINT "PK_cl_bulk_uploads" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_cl_bulk_uploads_status" CHECK ("status" IN ('dry_run', 'applied')))`);

    // The first collection.
    await queryRunner.query(
      `INSERT INTO "cl_collections" ("id", "name", "code_prefix") VALUES ('first_principles', 'First Principles', 'FP')
       ON CONFLICT ("id") DO NOTHING`,
    );

    // Access.
    for (const name of PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "permissions" (name)
         SELECT $1::character varying
         WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1)`,
        [name],
      );
    }
    await queryRunner.query(
      `INSERT INTO "group_permissions" ("groupId", "permissionId")
       SELECT g.id, p.id
       FROM "groups" g
       JOIN "permissions" p ON p.name = ANY($2::character varying[])
       WHERE g.name = ANY($1::character varying[])
         AND NOT EXISTS (
           SELECT 1 FROM "group_permissions" gp
           WHERE gp."groupId" = g.id AND gp."permissionId" = p.id
         )`,
      [GROUPS, PERMISSIONS],
    );
    await queryRunner.query(
      `INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
       SELECT DISTINCT ug."userId", $2::character varying, true
       FROM "user_groups" ug
       JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
       ON CONFLICT ("userId", "featureKey") DO NOTHING`,
      [GROUPS, FEATURE_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = $1`,
      [FEATURE_KEY],
    );
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1::character varying[]))`,
      [PERMISSIONS],
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name = ANY($1::character varying[])`,
      [PERMISSIONS],
    );
    for (const table of [
      'cl_bulk_uploads',
      'cl_chunk_versions',
      'cl_chunk_relations',
      'cl_chunk_sources',
      'cl_chunks',
      'cl_segment_runs',
      'cl_ingest_segments',
      'cl_sources',
      'cl_use_case_access_log',
      'cl_use_case_access',
      'cl_collections',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
