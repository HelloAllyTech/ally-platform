import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Judge agreement from the clinical advisor's ordinary reviews (approved
 * 2026-11-12). Under the verdict the advisor confirms one yes/no answer per
 * κ-gate measure, pre-filled from their comment tags and hard fails:
 * `debrief_review_answers` keeps each answer, the pre-filled value and
 * whether they changed it. `debrief_agreement_samples` is the weekly random
 * sample of judged debriefs put in the advisor's queue as "Agreement sample",
 * so κ is not built only from debriefs someone chose to open.
 *
 * Hand-written SQL. The measure CHECK lists `DebriefAgreementMeasure`
 * (check-constraints-cover-enums.spec.ts).
 */
export class AddDebriefAgreementAnswers1981900790000 implements MigrationInterface {
  name = 'AddDebriefAgreementAnswers1981900790000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_review_answers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "reviewId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "measure" character varying(32) NOT NULL,
        "answer" boolean NOT NULL,
        "prefilled" boolean NOT NULL,
        "changed" boolean NOT NULL,
        "prefillSource" jsonb,
        CONSTRAINT "PK_debrief_review_answers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_review_answers_review" FOREIGN KEY ("reviewId")
          REFERENCES "debrief_reviews"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_debrief_review_answers_run" FOREIGN KEY ("runId")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_debrief_review_answers_measure" CHECK ("measure" IN (
          'accuracy','evidence_specificity','missed_risk_cue'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_review_answers_review_measure_uq"
        ON "debrief_review_answers" ("reviewId", "measure")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_review_answers_run_idx"
        ON "debrief_review_answers" ("runId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_agreement_samples" (
        "runId" uuid NOT NULL,
        "tenant_id" character varying,
        "sampledAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_debrief_agreement_samples" PRIMARY KEY ("runId"),
        CONSTRAINT "FK_debrief_agreement_samples_run" FOREIGN KEY ("runId")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_agreement_samples_sampled_idx"
        ON "debrief_agreement_samples" ("sampledAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_agreement_samples"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_review_answers"`);
  }
}
