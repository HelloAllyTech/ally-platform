import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library: the automatic rollout after a release.
 *
 * `cl_rollout_steps` records how far `ContextLibraryRolloutService` has carried each retired
 * Knowledge Base corpus — import or enrichment, smoke check, retirement — one row per
 * (corpus, step), so a restart or another replica picks up where the last tick stopped. The
 * service creates its rows itself; this migration only makes the table. `detail` holds counts
 * only, never a search's or a document's text.
 */
const TS = `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`;

export class CreateContextLibraryRolloutSteps1981001300000 implements MigrationInterface {
  name = 'CreateContextLibraryRolloutSteps1981001300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "cl_rollout_steps" (${TS},
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "corpus" character varying(32) NOT NULL,
      "step" character varying(16) NOT NULL,
      "status" character varying(12) NOT NULL DEFAULT 'pending',
      "attempts" integer NOT NULL DEFAULT 0,
      "started_at" TIMESTAMP,
      "finished_at" TIMESTAMP,
      "next_attempt_at" TIMESTAMP,
      "last_error" character varying(300),
      "detail" jsonb NOT NULL DEFAULT '{}',
      CONSTRAINT "PK_cl_rollout_steps" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_cl_rollout_steps_corpus" CHECK ("corpus" IN ('character_library', 'ally_guide_library', 'debrief_knowledge')),
      CONSTRAINT "CHK_cl_rollout_steps_step" CHECK ("step" IN ('import', 'enrich', 'smoke_check', 'retire')),
      CONSTRAINT "CHK_cl_rollout_steps_status" CHECK ("status" IN ('pending', 'running', 'done', 'failed', 'skipped')),
      CONSTRAINT "CHK_cl_rollout_steps_attempts" CHECK ("attempts" >= 0))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_cl_rollout_steps_corpus_step" ON "cl_rollout_steps" ("corpus", "step")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cl_rollout_steps"`);
  }
}
