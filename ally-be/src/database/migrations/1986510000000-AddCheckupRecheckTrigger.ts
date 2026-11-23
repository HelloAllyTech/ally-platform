import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Q4 A0: publishing's safety recheck is its own kind of run (`recheck`), asked in the background
 * while the page polls it, and never the latest checkup (so the 70% gate keeps reading the full
 * run). Before, it was saved as an `onboarding` run and replaced the checkup it rechecked.
 */
export class AddCheckupRecheckTrigger1986510000000 implements MigrationInterface {
  name = 'AddCheckupRecheckTrigger1986510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" DROP CONSTRAINT "CHK_chatbot_checkup_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" ADD CONSTRAINT "CHK_chatbot_checkup_runs_trigger"
         CHECK ("trigger" IN ('onboarding', 'manual', 'after_change', 'eval', 'try', 'recheck'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "chatbot_checkup_runs" WHERE "trigger" = 'recheck'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" DROP CONSTRAINT "CHK_chatbot_checkup_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_checkup_runs" ADD CONSTRAINT "CHK_chatbot_checkup_runs_trigger"
         CHECK ("trigger" IN ('onboarding', 'manual', 'after_change', 'eval', 'try'))`,
    );
  }
}
