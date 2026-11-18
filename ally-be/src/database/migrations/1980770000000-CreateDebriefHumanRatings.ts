import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The debrief calibration set: people scoring debriefs on the same rubric as
 * the independent debrief-quality judge.
 *
 * Judge-vs-human κ on accuracy, evidence and the missed-risk-cue hard fail is
 * the standing gate on the debrief Improver's autonomy; human-vs-human κ is
 * the ceiling the judge is read against. One row per (debrief, rater, rubric
 * version); a rater re-scoring the same debrief replaces their earlier score.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefHumanRatings1980770000000 implements MigrationInterface {
  name = 'CreateDebriefHumanRatings1980770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_human_ratings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "scenarioSessionId" uuid NOT NULL,
        "raterId" integer NOT NULL,
        "rubricVersion" character varying NOT NULL DEFAULT 'v1',
        "evidenceSpecificity" smallint NOT NULL,
        "accuracy" smallint NOT NULL,
        "actionability" smallint NOT NULL,
        "prioritisation" smallint NOT NULL,
        "personalisationProgress" smallint NOT NULL,
        "practiceAlignment" smallint NOT NULL,
        "tone" smallint NOT NULL,
        "clarity" smallint NOT NULL,
        "hardFails" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "note" text,
        CONSTRAINT "PK_debrief_human_ratings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_debrief_human_ratings_scores" CHECK (
          "evidenceSpecificity" BETWEEN 0 AND 10 AND "accuracy" BETWEEN 0 AND 10
          AND "actionability" BETWEEN 0 AND 10 AND "prioritisation" BETWEEN 0 AND 10
          AND "personalisationProgress" BETWEEN 0 AND 10
          AND "practiceAlignment" BETWEEN 0 AND 10
          AND "tone" BETWEEN 0 AND 10 AND "clarity" BETWEEN 0 AND 10
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_human_ratings_session_rater_uq"
        ON "debrief_human_ratings" ("scenarioSessionId", "raterId", "rubricVersion")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_human_ratings"`);
  }
}
