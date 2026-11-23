import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The post-launch pulse (PRD §9): on 1 in 10 debriefs for the first 8 weeks,
 * "Did you know what to practise next?" and "Did this feel fair?", yes or no.
 * Each answer is a `debrief_learner_events` row of its own kind
 * (`pulse_knew_next_yes`, …); answering again replaces it. Widens the kind
 * check; the PM agent reads them through `debrief_reporting.learner_events`.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class AddDebriefPulseEventKinds1981900760000 implements MigrationInterface {
  name = 'AddDebriefPulseEventKinds1981900760000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_learner_events" DROP CONSTRAINT IF EXISTS "CHK_debrief_learner_events_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "debrief_learner_events" ADD CONSTRAINT "CHK_debrief_learner_events_kind"
        CHECK ("kind" IN (
          'opened','read_through','listened','practise_next_click',
          'reflection_answered','replied','waited','left_before_ready',
          'pulse_knew_next_yes','pulse_knew_next_no','pulse_fair_yes','pulse_fair_no'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "debrief_learner_events" WHERE kind LIKE 'pulse\\_%'`,
    );
    await queryRunner.query(
      `ALTER TABLE "debrief_learner_events" DROP CONSTRAINT IF EXISTS "CHK_debrief_learner_events_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "debrief_learner_events" ADD CONSTRAINT "CHK_debrief_learner_events_kind"
        CHECK ("kind" IN (
          'opened','read_through','listened','practise_next_click',
          'reflection_answered','replied','waited','left_before_ready'))`);
  }
}
