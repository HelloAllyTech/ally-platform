import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One active guide thread per anonymous visitor and course
 * (plans/ally-guide/plan.md §3 stages 1–3), the visitor's twin of
 * `uq_guide_threads_active_user_track`: two tabs opening the same course link
 * at once must land in one conversation, not race two into existence.
 *
 * Replaces the plain lookup index on the same columns. Visitor threads only
 * exist from this release on, so no duplicates can block the unique build.
 */
export class AddGuideVisitorThreadIndex1980650000000 implements MigrationInterface {
  name = 'AddGuideVisitorThreadIndex1980650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_guide_threads_visitor_track"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_guide_threads_active_visitor_track" ON "guide_threads" ("visitorId", "trackId") WHERE "status" = 'active' AND "visitorId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_guide_threads_active_visitor_track"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_threads_visitor_track" ON "guide_threads" ("visitorId", "trackId") WHERE "visitorId" IS NOT NULL`,
    );
  }
}
