import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 5: drop the two agent memory tables the Context Library replaced.
 *
 * `agent_memories` (Bug Hunter's notes, and the reserved Builder half) and `builder_lessons`
 * were copied into Bug Hunter Notes and Builder Lessons by `1981000500000`, which only copies;
 * this one, deliberately separate and later, destroys. Nothing reads either table any more — the
 * agent-memory module, Builder's lesson repository and both curators are deleted in the same
 * change — and ally-ai's derived `AgentMemory` Weaviate collection is dropped by ally-ai's own
 * migration `010`.
 *
 * Refuses to run if any row of either table has no copy, so a skipped or failed copy can never
 * turn into lost lessons: the copy is re-runnable, and this simply waits for it.
 *
 * `down` recreates both tables empty, as their last migrations left them; the rows live on in
 * `cl_chunks` (by `sync_key`) and are not copied back.
 */
export class DropAgentMemoriesAndBuilderLessons1981000600000 implements MigrationInterface {
  name = 'DropAgentMemoriesAndBuilderLessons1981000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['agent_memories', 'builder_lessons']) {
      if (!(await queryRunner.hasTable(table))) continue;
      const [missing] = await queryRunner.query(
        `SELECT count(*)::int AS n FROM "${table}" s
          WHERE NOT EXISTS (
            SELECT 1 FROM "cl_chunks" c WHERE c."sync_key" = '${table}:' || s."id")
            AND char_length(trim(COALESCE(${table === 'agent_memories' ? 's."body"' : 's."lesson"'}, ''))) > 0`,
      );
      if (Number(missing?.n ?? 0) > 0) {
        throw new Error(
          `${missing.n} ${table} row(s) have no Context Library copy; re-run CopyAgentMemoriesIntoContextLibrary1981000500000 before dropping.`,
        );
      }
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_memories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_lessons"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "builder_lessons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid,
        "repo" character varying(80),
        "category" character varying(16) NOT NULL,
        "lesson" text NOT NULL,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "repos" jsonb,
        "status" character varying(16) NOT NULL DEFAULT 'candidate',
        "pinned" boolean NOT NULL DEFAULT false,
        "sourceCount" integer NOT NULL DEFAULT 1,
        "sourceSessionIds" jsonb,
        "timesApplied" integer NOT NULL DEFAULT 0,
        "timesContradicted" integer NOT NULL DEFAULT 0,
        "mergedIntoId" uuid,
        "tags" jsonb,
        "lastAppliedAt" TIMESTAMP,
        CONSTRAINT "PK_builder_lessons_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_lessons_category" CHECK ("category" IN ('gotcha', 'convention', 'estimate', 'process')),
        CONSTRAINT "CHK_builder_lessons_status" CHECK ("status" IN ('candidate', 'active', 'merged', 'retired'))
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_lessons_repo" ON "builder_lessons" ("repo")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_lessons_status" ON "builder_lessons" ("status")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_memories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agent" character varying NOT NULL,
        "body" text NOT NULL,
        "repos" jsonb,
        "tags" jsonb,
        "status" character varying NOT NULL DEFAULT 'active',
        "pinned" boolean NOT NULL DEFAULT false,
        "source_count" integer NOT NULL DEFAULT 1,
        "times_applied" integer NOT NULL DEFAULT 0,
        "times_contradicted" integer NOT NULL DEFAULT 0,
        "merged_into_id" uuid,
        "run_id" uuid,
        "finding_id" uuid,
        "created_by" integer,
        "last_applied_at" TIMESTAMP,
        "retired_at" TIMESTAMP,
        "retired_by" integer,
        "retired_reason" text,
        "embedding_status" character varying NOT NULL DEFAULT 'pending',
        "embedding_attempts" integer NOT NULL DEFAULT 0,
        "embedded_at" TIMESTAMP,
        "text_hash" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_memories" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_memories_agent" CHECK ("agent" IN ('bug_hunter', 'builder')),
        CONSTRAINT "CHK_agent_memories_status" CHECK ("status" IN ('candidate', 'active', 'merged', 'retired')),
        CONSTRAINT "CHK_agent_memories_embedding_status" CHECK ("embedding_status" IN ('pending', 'success', 'failed', 'skipped')),
        CONSTRAINT "CHK_agent_memories_body_length" CHECK (char_length("body") BETWEEN 1 AND 600)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_memories_agent_status" ON "agent_memories" ("agent", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_memories_embedding_status" ON "agent_memories" ("embedding_status")`,
    );
  }
}
