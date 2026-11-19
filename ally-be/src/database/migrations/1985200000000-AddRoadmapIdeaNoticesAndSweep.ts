import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap idea-to-plan audit, recommendations 8 and 9.
 *
 * - `roadmap_notifications.kind` gains four kinds (RoadmapNotificationKind):
 *   `plan_ready`, `plan_closed`, `comment` and `question_answered`.
 * - `roadmap_opportunities` gains `sweepKeptAt` / `sweepKeptBy`: an Owner kept
 *   the idea when the old-and-quiet sweep pulled it up, so it is not offered
 *   again. Nothing else writes them; the sweep never changes an idea by itself.
 *
 * Additive. `down` narrows the CHECK again, so it first deletes rows of the
 * new kinds (notices only: nothing else points at them).
 *
 * The value lists are literal on purpose: check-constraints-cover-enums.spec
 * reads them from this file as text.
 */
export class AddRoadmapIdeaNoticesAndSweep1985200000000 implements MigrationInterface {
  name = 'AddRoadmapIdeaNoticesAndSweep1985200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_notifications" DROP CONSTRAINT IF EXISTS "CHK_roadmap_notifications_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_notifications" ADD CONSTRAINT "CHK_roadmap_notifications_kind" CHECK ("kind" IN (
        'submitted', 'accepted', 'declined', 'lead_assigned', 'assigned_to_you',
        'handed_back', 'agent_question', 'mention', 'answers_conflict',
        'decision_needed', 'shipped', 'outcome_reviewed', 'release_held',
        'release_failed', 'breaker_open', 'budget', 'activity',
        'plan_ready', 'plan_closed', 'comment', 'question_answered'
      ))
    `);
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities"
         ADD COLUMN IF NOT EXISTS "sweepKeptAt" timestamptz NULL,
         ADD COLUMN IF NOT EXISTS "sweepKeptBy" integer NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities"
         DROP COLUMN IF EXISTS "sweepKeptBy",
         DROP COLUMN IF EXISTS "sweepKeptAt"`,
    );
    await queryRunner.query(
      `DELETE FROM "roadmap_notifications"
        WHERE "kind" IN ('plan_ready', 'plan_closed', 'comment', 'question_answered')`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_notifications" DROP CONSTRAINT IF EXISTS "CHK_roadmap_notifications_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_notifications" ADD CONSTRAINT "CHK_roadmap_notifications_kind" CHECK ("kind" IN (
        'submitted', 'accepted', 'declined', 'lead_assigned', 'assigned_to_you',
        'handed_back', 'agent_question', 'mention', 'answers_conflict',
        'decision_needed', 'shipped', 'outcome_reviewed', 'release_held',
        'release_failed', 'breaker_open', 'budget', 'activity'
      ))
    `);
  }
}
