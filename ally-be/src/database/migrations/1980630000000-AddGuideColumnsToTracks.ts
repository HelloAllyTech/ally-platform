import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two additive columns for the Ally guide (plans/ally-guide/plan.md §8.1):
 *
 *  - `tracks.guideNotes` (jsonb, null) — the course layer of Ally's config:
 *    trainer notes, per-item tension overrides, whether Course Copilot drafted
 *    them. Never part of a learner payload. Copied by duplicateTrack like
 *    `landingPage`.
 *  - `track_enrollments.entrySource` (varchar, null) — how the learner reached
 *    the course, so guided, public-link and in-app cohorts can be compared
 *    without a holdout (plan §2.1 decision 19). Null for enrollments made
 *    before this column existed.
 *
 * Both nullable with no default, so existing rows and every current code path
 * are untouched.
 */
export class AddGuideColumnsToTracks1980630000000 implements MigrationInterface {
  name = 'AddGuideColumnsToTracks1980630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "guideNotes" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "track_enrollments" ADD COLUMN IF NOT EXISTS "entrySource" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "track_enrollments" ADD CONSTRAINT "CHK_track_enrollments_entry_source"
        CHECK ("entrySource" IS NULL OR "entrySource" IN ('public_link', 'in_app', 'guided', 'outreach'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "track_enrollments" DROP CONSTRAINT IF EXISTS "CHK_track_enrollments_entry_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "track_enrollments" DROP COLUMN IF EXISTS "entrySource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tracks" DROP COLUMN IF EXISTS "guideNotes"`,
    );
  }
}
