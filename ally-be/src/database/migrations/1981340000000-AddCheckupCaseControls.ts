import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 20d-2: a Checkup the owner controls. Each question records what should happen
 * (answer, say it doesn't know, decline politely, offer a person), its language and where it came
 * from (a chat, a question it didn't know, a thumbs-down); deleting one is soft so Undo works.
 * Runs record which step they're on and how many questions have been asked, so the screen can show
 * live steps, and whether they asked everything, only the failed ones, or one ("Try this one").
 * Additive only.
 */
export class AddCheckupCaseControls1981340000000 implements MigrationInterface {
  name = 'AddCheckupCaseControls1981340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_cases"
         ADD COLUMN "outcome" character varying(16),
         ADD COLUMN "language" character varying(8),
         ADD COLUMN "added_from" character varying(16),
         ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE,
         ADD CONSTRAINT "CHK_chatbot_checkup_cases_outcome"
           CHECK ("outcome" IS NULL OR "outcome" IN ('answer', 'dont_know', 'decline', 'person')),
         ADD CONSTRAINT "CHK_chatbot_checkup_cases_added_from"
           CHECK ("added_from" IS NULL OR "added_from" IN ('chat', 'unanswered', 'thumbs_down'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs"
         ADD COLUMN "phase" character varying(16) NOT NULL DEFAULT 'asking',
         ADD COLUMN "asked" integer NOT NULL DEFAULT 0,
         ADD COLUMN "only" character varying(8) NOT NULL DEFAULT 'all',
         ADD CONSTRAINT "CHK_chatbot_checkup_runs_phase"
           CHECK ("phase" IN ('writing', 'asking', 'checking', 'done')),
         ADD CONSTRAINT "CHK_chatbot_checkup_runs_only"
           CHECK ("only" IN ('all', 'failed', 'one'))`,
    );
    // "Try this one" is its own kind of run, so it never becomes the latest checkup.
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" DROP CONSTRAINT "CHK_chatbot_checkup_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" ADD CONSTRAINT "CHK_chatbot_checkup_runs_trigger"
         CHECK ("trigger" IN ('onboarding', 'manual', 'after_change', 'eval', 'try'))`,
    );
    // Each question's last results, newest first.
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_checkup_results_case" ON "chatbot_checkup_results" ("case_id", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_chatbot_checkup_results_case"`);
    await queryRunner.query(
      `DELETE FROM "chatbot_checkup_runs" WHERE "trigger" = 'try'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" DROP CONSTRAINT "CHK_chatbot_checkup_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" ADD CONSTRAINT "CHK_chatbot_checkup_runs_trigger"
         CHECK ("trigger" IN ('onboarding', 'manual', 'after_change', 'eval'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs"
         DROP CONSTRAINT "CHK_chatbot_checkup_runs_only",
         DROP CONSTRAINT "CHK_chatbot_checkup_runs_phase",
         DROP COLUMN "only",
         DROP COLUMN "asked",
         DROP COLUMN "phase"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_cases"
         DROP CONSTRAINT "CHK_chatbot_checkup_cases_added_from",
         DROP CONSTRAINT "CHK_chatbot_checkup_cases_outcome",
         DROP COLUMN "deleted_at",
         DROP COLUMN "added_from",
         DROP COLUMN "language",
         DROP COLUMN "outcome"`,
    );
  }
}
