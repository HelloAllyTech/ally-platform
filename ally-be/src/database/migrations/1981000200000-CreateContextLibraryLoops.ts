import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 3: the learning loops.
 *
 * `cl_judgments` holds the judge's 0–3 labels (the self-building benchmark, split by query hash
 * into learn and holdout). `cl_loop_actions` records every change a loop made, with the
 * before-state an Undo restores. `cl_gap_topics` lists what people searched for and didn't
 * find. Three columns on `cl_collections` let tuning roll back and let Settings pause a loop.
 */
const TS = `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`;

export class CreateContextLibraryLoops1981000200000 implements MigrationInterface {
  name = 'CreateContextLibraryLoops1981000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "cl_judgments" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "retrieval_id" uuid NOT NULL,
      "chunk_id" uuid NOT NULL,
      "collection_id" character varying(48) NOT NULL,
      "grade" smallint NOT NULL,
      "superficial_match" boolean NOT NULL DEFAULT false,
      "split" character varying(8) NOT NULL,
      "final_rank" integer,
      "judge_model" character varying(80) NOT NULL,
      "judge_prompt_version" character varying(40) NOT NULL,
      CONSTRAINT "PK_cl_judgments" PRIMARY KEY ("id"),
      CONSTRAINT "FK_cl_judgments_retrieval" FOREIGN KEY ("retrieval_id") REFERENCES "cl_retrievals"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_cl_judgments_chunk" FOREIGN KEY ("chunk_id") REFERENCES "cl_chunks"("id") ON DELETE CASCADE,
      CONSTRAINT "CHK_cl_judgments_grade" CHECK ("grade" BETWEEN 0 AND 3),
      CONSTRAINT "CHK_cl_judgments_split" CHECK ("split" IN ('learn', 'holdout')))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cl_judgments_retrieval_chunk" ON "cl_judgments" ("retrieval_id", "chunk_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cl_judgments_chunk" ON "cl_judgments" ("chunk_id")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_loop_actions" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "collection_id" character varying(48) NOT NULL,
      "loop" character varying(24) NOT NULL,
      "action" character varying(24) NOT NULL,
      "chunk_id" uuid,
      "reason" text NOT NULL,
      "before" jsonb,
      "after" jsonb,
      "evidence" jsonb,
      "undone_at" TIMESTAMP,
      "undone_by" integer,
      CONSTRAINT "PK_cl_loop_actions" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_cl_loop_actions_loop" CHECK ("loop" IN ('judge', 'query_learning', 'effectiveness', 'curator', 'gaps', 'tuning', 'rollback')),
      CONSTRAINT "CHK_cl_loop_actions_action" CHECK ("action" IN ('archive', 'demote', 'promote', 'learn_query', 'promote_setup', 'rollback_setup', 'merge')))`);
    await queryRunner.query(
      `CREATE INDEX "idx_cl_loop_actions_collection_created" ON "cl_loop_actions" ("collection_id", "createdAt")`,
    );

    await queryRunner.query(`CREATE TABLE "cl_gap_topics" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "collection_id" character varying(48) NOT NULL,
      "kind" character varying(16) NOT NULL,
      "tenant_id" uuid,
      "label" character varying(160) NOT NULL,
      "query_count" integer NOT NULL,
      "example_queries" text[] NOT NULL DEFAULT '{}',
      "first_seen_at" TIMESTAMP NOT NULL,
      "last_seen_at" TIMESTAMP NOT NULL,
      "status" character varying(12) NOT NULL DEFAULT 'open',
      CONSTRAINT "PK_cl_gap_topics" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_cl_gap_topics_kind" CHECK ("kind" IN ('platform', 'organisation')),
      CONSTRAINT "CHK_cl_gap_topics_status" CHECK ("status" IN ('open', 'answered', 'dismissed')))`);
    await queryRunner.query(
      `CREATE INDEX "idx_cl_gap_topics_collection" ON "cl_gap_topics" ("collection_id", "kind")`,
    );

    await queryRunner.query(`ALTER TABLE "cl_collections"
      ADD COLUMN "previous_search_setup" jsonb,
      ADD COLUMN "setup_promoted_at" TIMESTAMP,
      ADD COLUMN "loop_settings" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cl_collections"
      DROP COLUMN IF EXISTS "loop_settings",
      DROP COLUMN IF EXISTS "setup_promoted_at",
      DROP COLUMN IF EXISTS "previous_search_setup"`);
    for (const table of ['cl_gap_topics', 'cl_loop_actions', 'cl_judgments']) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
