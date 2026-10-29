import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Debrief-quality judge storage: one row per scored debrief, plus the new
 * judge family on the attempt ledger.
 *
 * The groundedness judge checks whether each claim in a debrief is true. This
 * judge scores the debrief as a whole on the rubric's eight dimensions — the
 * score the debrief quality bar is read from — and records its hard fails.
 *
 * Labels only: eight 0-10 scores and a hard-fail list. The weighted overall is
 * computed at read time, so a weight can change without re-judging.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefQualityJudgment1980760000000 implements MigrationInterface {
  name = 'CreateDebriefQualityJudgment1980760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_quality_judgment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "scenarioSessionId" uuid NOT NULL,
        "debriefSource" character varying NOT NULL,
        "generator" character varying NOT NULL,
        "evidenceSpecificity" smallint NOT NULL,
        "accuracy" smallint NOT NULL,
        "actionability" smallint NOT NULL,
        "prioritisation" smallint NOT NULL,
        "personalisationProgress" smallint NOT NULL,
        "practiceAlignment" smallint NOT NULL,
        "tone" smallint NOT NULL,
        "clarity" smallint NOT NULL,
        "hardFails" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "reasoning" jsonb,
        "debriefText" text,
        "language" character varying,
        "workerType" character varying,
        "learnerTurns" integer,
        "scenarioId" integer,
        "scenarioVersionId" uuid,
        "llmModel" character varying,
        "occurredAt" TIMESTAMP,
        "judgeModel" character varying NOT NULL,
        "judgePromptVersion" character varying NOT NULL DEFAULT 'v1',
        CONSTRAINT "PK_debrief_quality_judgment" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_debrief_quality_judgment_scores" CHECK (
          "evidenceSpecificity" BETWEEN 0 AND 10 AND "accuracy" BETWEEN 0 AND 10
          AND "actionability" BETWEEN 0 AND 10 AND "prioritisation" BETWEEN 0 AND 10
          AND "personalisationProgress" BETWEEN 0 AND 10
          AND "practiceAlignment" BETWEEN 0 AND 10
          AND "tone" BETWEEN 0 AND 10 AND "clarity" BETWEEN 0 AND 10
        )
      )
    `);

    // A re-judge under a new rubric writes alongside the old one, and an
    // interrupted run is idempotent: it skips what already landed.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_quality_judgment_session_judge_uq"
        ON "debrief_quality_judgment"
        ("scenarioSessionId", "judgeModel", "judgePromptVersion")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_quality_judgment_session_id_idx"
        ON "debrief_quality_judgment" ("scenarioSessionId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_quality_judgment_occurred_at_idx"
        ON "debrief_quality_judgment" ("occurredAt")
    `);

    // The drainer records failed attempts per family; without this value every
    // failure write would violate the CHECK and the family would retry forever.
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" DROP CONSTRAINT IF EXISTS "CHK_judge_attempts_family"`,
    );
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" ADD CONSTRAINT "CHK_judge_attempts_family" CHECK ("family" IN ('drift','language','groundedness','recall-quality','debrief-quality'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "judge_attempts" WHERE "family" = 'debrief-quality'`,
    );
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" DROP CONSTRAINT IF EXISTS "CHK_judge_attempts_family"`,
    );
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" ADD CONSTRAINT "CHK_judge_attempts_family" CHECK ("family" IN ('drift','language','groundedness','recall-quality'))`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_quality_judgment"`);
  }
}
