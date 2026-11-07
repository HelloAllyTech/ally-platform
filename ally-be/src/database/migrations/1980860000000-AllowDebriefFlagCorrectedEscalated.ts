import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * v9 FR-31/FR-38: a reviewer can now correct a flagged card, or escalate the
 * flag to the clinical advisor. Widen the status check to take both.
 */
export class AllowDebriefFlagCorrectedEscalated1980860000000 implements MigrationInterface {
  name = 'AllowDebriefFlagCorrectedEscalated1980860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_run_feedback" DROP CONSTRAINT "CHK_debrief_run_feedback_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debrief_run_feedback" ADD CONSTRAINT "CHK_debrief_run_feedback_status" CHECK ("status" IN ('open','kept','removed','withdrawn','noted','corrected','escalated'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "debrief_run_feedback" SET "status" = 'open' WHERE "status" = 'escalated'`,
    );
    await queryRunner.query(
      `UPDATE "debrief_run_feedback" SET "status" = 'kept' WHERE "status" = 'corrected'`,
    );
    await queryRunner.query(
      `ALTER TABLE "debrief_run_feedback" DROP CONSTRAINT "CHK_debrief_run_feedback_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debrief_run_feedback" ADD CONSTRAINT "CHK_debrief_run_feedback_status" CHECK ("status" IN ('open','kept','removed','withdrawn','noted'))`,
    );
  }
}
