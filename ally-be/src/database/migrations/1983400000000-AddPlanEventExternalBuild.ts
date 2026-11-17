import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap v2's Open in Claude Code (plans/roadmap-builder-merge D18, §4.5b)
 * writes an attributed `external_build` plan event. Widens
 * CHK_plan_events_kind by that one value. Additive, and nothing writes it
 * while `roadmapV2Enabled` is off.
 *
 * The typed list is every value the constraint has held up to here
 * (`item_edited` from P2, and P3's five review, lead, planning and settling
 * kinds from 1983300000000) and is what check-constraints-cover-enums reads.
 * Any value the live constraint allows beyond it — a phase that widened it in
 * parallel and ran first — is carried over, so neither loses the other's.
 */
export class AddPlanEventExternalBuild1983400000000 implements MigrationInterface {
  name = 'AddPlanEventExternalBuild1983400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const extra = await this.extraKinds(queryRunner, ['external_build']);
    await queryRunner.query(
      `ALTER TABLE "plan_events" DROP CONSTRAINT IF EXISTS "CHK_plan_events_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "plan_events"
        ADD CONSTRAINT "CHK_plan_events_kind" CHECK ("kind" IN (
          'parked', 'filed', 'taken_on', 'handed_back', 'auto_released',
          'stage_changed', 'archived', 'restored', 'visibility_changed',
          'author_asked', 'budget_changed', 'check_required', 'check_resolved',
          'finding_dismissed', 'measure_frozen', 'measure_changed', 'design_started',
          'design_approved', 'build_sent', 'exported', 'launched',
          'outcome_reviewed', 'closed', 'reopened', 'item_edited',
          'reviewed', 'lead_assigned', 'lead_handed_back', 'planning_started',
          'answer_settled',
          'external_build'${extra}
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "plan_events" WHERE "kind" = 'external_build'`,
    );
    const extra = await this.extraKinds(queryRunner, ['external_build']);
    await queryRunner.query(
      `ALTER TABLE "plan_events" DROP CONSTRAINT IF EXISTS "CHK_plan_events_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "plan_events"
        ADD CONSTRAINT "CHK_plan_events_kind" CHECK ("kind" IN (
          'parked', 'filed', 'taken_on', 'handed_back', 'auto_released',
          'stage_changed', 'archived', 'restored', 'visibility_changed',
          'author_asked', 'budget_changed', 'check_required', 'check_resolved',
          'finding_dismissed', 'measure_frozen', 'measure_changed', 'design_started',
          'design_approved', 'build_sent', 'exported', 'launched',
          'outcome_reviewed', 'closed', 'reopened', 'item_edited',
          'reviewed', 'lead_assigned', 'lead_handed_back', 'planning_started',
          'answer_settled'${extra}
        ))
    `);
  }

  /**
   * Values the live constraint allows that the typed list above does not, as
   * a `, 'a', 'b'` suffix (empty when there are none). `skip` is never
   * carried, so down() really removes what up() added.
   */
  private async extraKinds(
    queryRunner: QueryRunner,
    skip: string[],
  ): Promise<string> {
    const typed = new Set([
      'parked',
      'filed',
      'taken_on',
      'handed_back',
      'auto_released',
      'stage_changed',
      'archived',
      'restored',
      'visibility_changed',
      'author_asked',
      'budget_changed',
      'check_required',
      'check_resolved',
      'finding_dismissed',
      'measure_frozen',
      'measure_changed',
      'design_started',
      'design_approved',
      'build_sent',
      'exported',
      'launched',
      'outcome_reviewed',
      'closed',
      'reopened',
      'item_edited',
      'reviewed',
      'lead_assigned',
      'lead_handed_back',
      'planning_started',
      'answer_settled',
      ...skip,
    ]);
    const rows: { def: string }[] = await queryRunner.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'plan_events' AND c.conname = 'CHK_plan_events_kind'`,
    );
    const live = [...(rows?.[0]?.def ?? '').matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    const extra = [...new Set(live)].filter((kind) => !typed.has(kind));
    return extra.map((kind) => `, '${kind}'`).join('');
  }
}
