import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap v2 inline edits (plans/roadmap-builder-merge §4.11, §5.7b) write an
 * attributed plan event, `item_edited`. Widens CHK_plan_events_kind by that
 * one value; additive, and nothing writes it while `roadmapV2Enabled` is off.
 */
export class AddPlanEventItemEdited1983200000000 implements MigrationInterface {
  name = 'AddPlanEventItemEdited1983200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "plan_events" DROP CONSTRAINT IF EXISTS "CHK_plan_events_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "plan_events"
        ADD CONSTRAINT "CHK_plan_events_kind" CHECK ("kind" IN (
          'parked', 'filed', 'taken_on', 'handed_back', 'auto_released',
          'stage_changed', 'archived', 'restored', 'visibility_changed',
          'author_asked', 'budget_changed', 'check_required', 'check_resolved',
          'finding_dismissed', 'measure_frozen', 'measure_changed', 'design_started',
          'design_approved', 'build_sent', 'exported', 'launched',
          'outcome_reviewed', 'closed', 'reopened', 'item_edited'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "plan_events" WHERE "kind" = 'item_edited'`,
    );
    await queryRunner.query(`
      ALTER TABLE "plan_events" DROP CONSTRAINT IF EXISTS "CHK_plan_events_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "plan_events"
        ADD CONSTRAINT "CHK_plan_events_kind" CHECK ("kind" IN (
          'parked', 'filed', 'taken_on', 'handed_back', 'auto_released',
          'stage_changed', 'archived', 'restored', 'visibility_changed',
          'author_asked', 'budget_changed', 'check_required', 'check_resolved',
          'finding_dismissed', 'measure_frozen', 'measure_changed', 'design_started',
          'design_approved', 'build_sent', 'exported', 'launched',
          'outcome_reviewed', 'closed', 'reopened'
        ))
    `);
  }
}
