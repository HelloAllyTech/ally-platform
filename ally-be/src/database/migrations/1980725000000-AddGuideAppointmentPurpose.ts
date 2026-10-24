import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Why a learner booked a time with Ally (plans/ally-guide/plan.md §3 stage
 * 13): `session` is the closing ritual's "come back to carry on";
 * `spaced_recall` is the finale's door — a short look back seven days after
 * the course. Outreach stops for a finished course except for that one
 * reminder, so the reminder has to know which it is. Existing rows are
 * sessions.
 */
export class AddGuideAppointmentPurpose1980725000000 implements MigrationInterface {
  name = 'AddGuideAppointmentPurpose1980725000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guide_appointments" ADD COLUMN IF NOT EXISTS "purpose" character varying(16) NOT NULL DEFAULT 'session'`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_appointments" ADD CONSTRAINT "CHK_guide_appointments_purpose" CHECK ("purpose" IN ('session', 'spaced_recall'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guide_appointments" DROP CONSTRAINT IF EXISTS "CHK_guide_appointments_purpose"`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_appointments" DROP COLUMN IF EXISTS "purpose"`,
    );
  }
}
