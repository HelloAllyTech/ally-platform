import { MigrationInterface, QueryRunner } from 'typeorm';

/** The kinds this migration adds; `down` deletes their rows before narrowing the CHECK. */
const KINDS_ADDED =
  "'reviewed', 'lead_assigned', 'lead_handed_back', 'planning_started', 'answer_settled'";

/**
 * Roadmap v2 P3/P3b (plans/roadmap-builder-merge §2.1a, §4.2, §4.5a, §5.7a).
 * Additive only; nothing writes any of it while `roadmapV2Enabled` is off.
 *
 * 1. Plan events for review, the lead and the shared session: `reviewed`,
 *    `lead_assigned`, `lead_handed_back`, `planning_started`, `answer_settled`.
 *    Every existing kind is kept.
 * 2. A draft's code lives in `builder_sessions.plan->>'code'` from the moment
 *    New idea creates it (session-first: no opportunity row until Submit). The
 *    unique index makes the code lookup cheap and a code impossible to hand
 *    to two drafts.
 * 3. Answers, comments and draft replies carry a client idempotency key so an
 *    offline send retried later is never stored twice. Enforced here, not only
 *    by a read-then-insert in the service [BL-0006].
 */
export class AddRoadmapV2DraftsAndReview1983300000000 implements MigrationInterface {
  name = 'AddRoadmapV2DraftsAndReview1983300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plan_events" DROP CONSTRAINT IF EXISTS "CHK_plan_events_kind"`,
    );
    // Written out in full (not built from a list): check-constraints-cover-enums.spec
    // reads the literal CHECK text.
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
          'answer_settled'
        ))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_builder_sessions_plan_code"
        ON "builder_sessions" (("plan"->>'code'))
        WHERE "kind" = 'plan' AND ("plan"->>'code') IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_builder_messages_idempotency_key"
        ON "builder_messages" ("sessionId", ("metadata"->>'idempotencyKey'))
        WHERE ("metadata"->>'idempotencyKey') IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_builder_messages_idempotency_key"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_builder_sessions_plan_code"`,
    );
    await queryRunner.query(
      `DELETE FROM "plan_events" WHERE "kind" IN (${KINDS_ADDED})`,
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
          'outcome_reviewed', 'closed', 'reopened', 'item_edited'
        ))
    `);
  }
}
