import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 2: the retrieval log, usage events and engineers' read-only keys.
 *
 * `cl_retrievals` + `cl_retrieval_hits` record every search and every candidate that reached
 * re-ranking (shown or not), which is what makes per-retriever recall measurable from real
 * traffic. `cl_usage_events` records what agents and engineers did with a chunk — the learning
 * loops read usage, not people. `cl_reader_keys` stores only key hashes.
 */
const TS = `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`;

export class CreateContextLibraryRetrieval1981000100000 implements MigrationInterface {
  name = 'CreateContextLibraryRetrieval1981000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "cl_retrievals" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "use_case" character varying(40) NOT NULL,
      "collections_searched" text[] NOT NULL,
      "denied_collections" text[] NOT NULL DEFAULT '{}',
      "session_id" character varying(80),
      "turn_index" integer,
      "queries" text[] NOT NULL,
      "query_origin" character varying(24) NOT NULL DEFAULT 'agent_tool',
      "context_descriptor" text,
      "facets" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "audience" jsonb,
      "search_setup" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "candidate_count" integer NOT NULL DEFAULT 0,
      "result_count" integer NOT NULL DEFAULT 0,
      "top_band" character varying(8),
      "filter_backoff" boolean NOT NULL DEFAULT false,
      "rerank_used" boolean NOT NULL DEFAULT false,
      "cache_hit" boolean NOT NULL DEFAULT false,
      "latency_ms" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "failed" boolean NOT NULL DEFAULT false,
      "query_sensitive" boolean NOT NULL DEFAULT false,
      "exclude_from_usage" boolean NOT NULL DEFAULT false,
      CONSTRAINT "PK_cl_retrievals" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_cl_retrievals_use_case_created" ON "cl_retrievals" ("use_case", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_retrievals_session" ON "cl_retrievals" ("session_id")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_retrieval_hits" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "retrieval_id" uuid NOT NULL,
      "chunk_id" uuid NOT NULL,
      "collection_id" character varying(48) NOT NULL,
      "bm25_rank" integer,
      "statement_rank" integer,
      "situations_rank" integer,
      "rrf_score" real NOT NULL,
      "rerank_grade" smallint,
      "band" character varying(8) NOT NULL,
      "dropped_reason" character varying(16),
      "final_rank" integer,
      "surfaced" boolean NOT NULL DEFAULT false,
      "exploration_slot" boolean NOT NULL DEFAULT false,
      CONSTRAINT "PK_cl_retrieval_hits" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_retrieval_hits_retrieval" FOREIGN KEY ("retrieval_id") REFERENCES "cl_retrievals"("id") ON DELETE CASCADE)`);
    await queryRunner.query(
      `CREATE INDEX "idx_cl_retrieval_hits_retrieval" ON "cl_retrieval_hits" ("retrieval_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_retrieval_hits_chunk" ON "cl_retrieval_hits" ("chunk_id")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_usage_events" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "chunk_id" uuid NOT NULL,
      "collection_id" character varying(48) NOT NULL,
      "use_case" character varying(40) NOT NULL,
      "type" character varying(24) NOT NULL,
      "session_id" character varying(80),
      "retrieval_id" uuid,
      "final_rank" integer,
      "exploration_slot" boolean NOT NULL DEFAULT false,
      "detail" jsonb,
      CONSTRAINT "PK_cl_usage_events" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_usage_events_chunk" FOREIGN KEY ("chunk_id") REFERENCES "cl_chunks"("id") ON DELETE CASCADE,
      CONSTRAINT "CHK_cl_usage_events_type" CHECK ("type" IN ('surfaced', 'read', 'probed', 'cited', 'applied_verified', 'cite_rejected', 'unused', 'shipped', 'agent_applied', 'agent_contradicted', 'not_relevant')))`);
    await queryRunner.query(
      `CREATE INDEX "idx_cl_usage_events_chunk_type" ON "cl_usage_events" ("chunk_id", "type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_usage_events_session" ON "cl_usage_events" ("session_id")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_reader_keys" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "owner_id" integer NOT NULL,
      "label" character varying(80) NOT NULL,
      "key_hash" character varying(64) NOT NULL,
      "key_prefix" character varying(12) NOT NULL,
      "last_used_at" TIMESTAMP,
      "revoked_at" TIMESTAMP,
      CONSTRAINT "PK_cl_reader_keys" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_reader_keys_hash" ON "cl_reader_keys" ("key_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_reader_keys_owner" ON "cl_reader_keys" ("owner_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'cl_reader_keys',
      'cl_usage_events',
      'cl_retrieval_hits',
      'cl_retrievals',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
