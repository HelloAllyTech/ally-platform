import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Claiming the plan interview: the idea's author may take it, hand it to the Owners, and an
 * Owner may take it back once it is free.
 *
 * - `plan_events.kind` gains `plan_claimed` and `plan_released`.
 * - `roadmap_notifications.kind` gains `plan_offered` and `plan_handed_over`.
 *
 * Additive. Values the live constraint holds beyond the typed list are carried over, so a
 * phase that widened it in parallel is not lost. `down` deletes the rows of the new kinds
 * (history and notices only) before narrowing.
 *
 * The typed lists are literal on purpose: check-constraints-cover-enums reads them as text.
 */
export class AddRoadmapPlanClaimKinds1985900000000 implements MigrationInterface {
  name = 'AddRoadmapPlanClaimKinds1985900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const events = await this.extra(
      queryRunner,
      'plan_events',
      'CHK_plan_events_kind',
      EVENT_KINDS,
    );
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
          'answer_settled', 'external_build',
          'plan_closed', 'plan_reopened', 'build_mode_set', 'marked_released',
          'plan_claimed', 'plan_released'${events}
        ))
    `);

    const notices = await this.extra(
      queryRunner,
      'roadmap_notifications',
      'CHK_roadmap_notifications_kind',
      NOTICE_KINDS,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_notifications" DROP CONSTRAINT IF EXISTS "CHK_roadmap_notifications_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_notifications" ADD CONSTRAINT "CHK_roadmap_notifications_kind" CHECK ("kind" IN (
        'submitted', 'accepted', 'declined', 'lead_assigned', 'assigned_to_you',
        'handed_back', 'agent_question', 'mention', 'answers_conflict',
        'decision_needed', 'shipped', 'outcome_reviewed', 'release_held',
        'release_failed', 'breaker_open', 'budget', 'activity',
        'plan_ready', 'plan_closed', 'comment', 'question_answered',
        'plan_offered', 'plan_handed_over'${notices}
      ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "roadmap_notifications" WHERE "kind" IN ('plan_offered', 'plan_handed_over')`,
    );
    await queryRunner.query(
      `DELETE FROM "plan_events" WHERE "kind" IN ('plan_claimed', 'plan_released')`,
    );
    const events = await this.extra(
      queryRunner,
      'plan_events',
      'CHK_plan_events_kind',
      [...EVENT_KINDS, 'plan_claimed', 'plan_released'],
    );
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
          'answer_settled', 'external_build',
          'plan_closed', 'plan_reopened', 'build_mode_set', 'marked_released'${events}
        ))
    `);
    const notices = await this.extra(
      queryRunner,
      'roadmap_notifications',
      'CHK_roadmap_notifications_kind',
      [...NOTICE_KINDS, 'plan_offered', 'plan_handed_over'],
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_notifications" DROP CONSTRAINT IF EXISTS "CHK_roadmap_notifications_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_notifications" ADD CONSTRAINT "CHK_roadmap_notifications_kind" CHECK ("kind" IN (
        'submitted', 'accepted', 'declined', 'lead_assigned', 'assigned_to_you',
        'handed_back', 'agent_question', 'mention', 'answers_conflict',
        'decision_needed', 'shipped', 'outcome_reviewed', 'release_held',
        'release_failed', 'breaker_open', 'budget', 'activity',
        'plan_ready', 'plan_closed', 'comment', 'question_answered'${notices}
      ))
    `);
  }

  /** Values the live constraint allows that this file does not name. */
  private async extra(
    queryRunner: QueryRunner,
    table: string,
    constraint: string,
    typed: string[],
  ): Promise<string> {
    const rows: { def: string }[] = await queryRunner.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = $1 AND c.conname = $2`,
      [table, constraint],
    );
    const known = new Set([
      ...typed,
      'plan_claimed',
      'plan_released',
      'plan_offered',
      'plan_handed_over',
    ]);
    const live = [...(rows?.[0]?.def ?? '').matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    return [...new Set(live)]
      .filter((kind) => !known.has(kind))
      .map((kind) => `, '${kind}'`)
      .join('');
  }
}

const EVENT_KINDS = [
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
  'external_build',
  'plan_closed',
  'plan_reopened',
  'build_mode_set',
  'marked_released',
];

const NOTICE_KINDS = [
  'submitted',
  'accepted',
  'declined',
  'lead_assigned',
  'assigned_to_you',
  'handed_back',
  'agent_question',
  'mention',
  'answers_conflict',
  'decision_needed',
  'shipped',
  'outcome_reviewed',
  'release_held',
  'release_failed',
  'breaker_open',
  'budget',
  'activity',
  'plan_ready',
  'plan_closed',
  'comment',
  'question_answered',
];
