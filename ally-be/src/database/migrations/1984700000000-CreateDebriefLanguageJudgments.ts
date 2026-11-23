import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Debrief language judge storage: one row per language-checked debrief run,
 * plus the new judge family on the attempt ledger.
 *
 * The judge reads only the debrief's visible text and returns specific faults
 * (closed types, the exact words). There is no score: the share of debriefs
 * with a finding, and the count per type, are computed at read time, so a
 * threshold can change without re-judging. A re-judge under a new rubric or
 * model writes a new row only after the old one is removed by the caller; one
 * row per run keeps every rate unambiguous.
 *
 * Hand-written SQL, never `migration:generate`. Additive.
 */
export class CreateDebriefLanguageJudgments1984700000000 implements MigrationInterface {
  name = 'CreateDebriefLanguageJudgments1984700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_language_judgments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "runId" uuid NOT NULL,
        "language" character varying NOT NULL,
        "judgeModel" character varying NOT NULL,
        "judgePromptVersion" character varying NOT NULL,
        "findings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "findingCount" integer NOT NULL DEFAULT 0,
        "types" text[] NOT NULL DEFAULT '{}',
        "judgedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_debrief_language_judgments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_language_judgments_run" FOREIGN KEY ("runId")
          REFERENCES "debrief_runs" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_debrief_language_judgments_count" CHECK ("findingCount" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_language_judgments_run_uq"
        ON "debrief_language_judgments" ("runId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_language_judgments_language_idx"
        ON "debrief_language_judgments" ("language", "judgedAt")
    `);

    // What the Debrief PM agent may read about language findings: counts only.
    // No quote, no note, no debrief text, no learner: a language, a fault type
    // and the card section it was found in. A view, so nothing to backfill.
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS debrief_reporting`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.language_checks AS
      SELECT j."runId" AS run_id,
             r."createdAt" AS created_at,
             r.tenant_id,
             COALESCE(t."isTestOrganization", false) AS is_test_org,
             r.mode, j.language,
             j."findingCount" AS finding_count,
             j.types,
             j."judgeModel" AS judge_model,
             j."judgePromptVersion" AS judge_prompt_version
        FROM debrief_language_judgments j
        JOIN debrief_runs r ON r.id = j."runId"
        LEFT JOIN tenants t ON t.id::text = r.tenant_id`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.language_findings AS
      SELECT j."runId" AS run_id,
             r."createdAt" AS created_at,
             r.mode, j.language,
             f->>'error_type' AS error_type,
             f->>'section' AS section
        FROM debrief_language_judgments j
        JOIN debrief_runs r ON r.id = j."runId"
        CROSS JOIN LATERAL jsonb_array_elements(j.findings) f`);

    // The drain records failed attempts per family; without this value every
    // failure write would violate the CHECK.
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" DROP CONSTRAINT IF EXISTS "CHK_judge_attempts_family"`,
    );
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" ADD CONSTRAINT "CHK_judge_attempts_family" CHECK ("family" IN ('drift','language','groundedness','recall-quality','debrief-quality','debrief-language'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP VIEW IF EXISTS debrief_reporting.language_findings`,
    );
    await queryRunner.query(
      `DROP VIEW IF EXISTS debrief_reporting.language_checks`,
    );
    await queryRunner.query(
      `DELETE FROM "judge_attempts" WHERE "family" = 'debrief-language'`,
    );
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" DROP CONSTRAINT IF EXISTS "CHK_judge_attempts_family"`,
    );
    await queryRunner.query(
      `ALTER TABLE "judge_attempts" ADD CONSTRAINT "CHK_judge_attempts_family" CHECK ("family" IN ('drift','language','groundedness','recall-quality','debrief-quality'))`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "debrief_language_judgments"`,
    );
  }
}
