import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Review and star facts on roadmap opportunities (plans/roadmap-builder-merge
 * D10, D16, §2.1a, §5.7a, §5.7b).
 *
 * - `reviewState` (pending | accepted | declined, nullable), `reviewedBy`,
 *   `reviewedAt`, `declineReason`: the Owner's review. A fact, not a stage.
 * - `selfChecked` (default false): filed with "Fill it in yourself".
 * - `starredByUserId`: who starred it. `directorStarred` stays the rank input,
 *   and `roadmap_rank_weights.prodDirectorUserId` is kept until cleanup.
 *
 * Backfill:
 * - every opportunity that exists now counts as already accepted (§2.1), soft-
 *   deleted rows included, so a restore cannot surface one as "awaiting review";
 * - each existing star is attributed to the current Prod Director. A star with
 *   no director set (or whose director was deleted) stays unattributed rather
 *   than being given to someone who never gave it.
 *
 * Additive: nothing reads these columns while `roadmapV2Enabled` is off.
 */
export class AddRoadmapReviewAndStar1983000000100 implements MigrationInterface {
  name = 'AddRoadmapReviewAndStar1983000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD COLUMN IF NOT EXISTS "reviewState" varchar(10) NULL,
        ADD COLUMN IF NOT EXISTS "reviewedBy" integer NULL,
        ADD COLUMN IF NOT EXISTS "reviewedAt" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "declineReason" text NULL,
        ADD COLUMN IF NOT EXISTS "selfChecked" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "starredByUserId" integer NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_review_state",
        DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_decline_reason",
        DROP CONSTRAINT IF EXISTS "FK_roadmap_opportunities_reviewed_by",
        DROP CONSTRAINT IF EXISTS "FK_roadmap_opportunities_starred_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD CONSTRAINT "CHK_roadmap_opportunities_review_state"
          CHECK ("reviewState" IS NULL OR "reviewState" IN ('pending', 'accepted', 'declined')),
        ADD CONSTRAINT "CHK_roadmap_opportunities_decline_reason"
          CHECK ("declineReason" IS NULL OR char_length("declineReason") <= 1000),
        ADD CONSTRAINT "FK_roadmap_opportunities_reviewed_by"
          FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_roadmap_opportunities_starred_by"
          FOREIGN KEY ("starredByUserId") REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_roadmap_opps_review_state"
         ON "roadmap_opportunities" ("reviewState") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `UPDATE "roadmap_opportunities" SET "reviewState" = 'accepted' WHERE "reviewState" IS NULL`,
    );
    await queryRunner.query(`
      UPDATE "roadmap_opportunities" o
         SET "starredByUserId" = w."prodDirectorUserId"
        FROM "roadmap_rank_weights" w
       WHERE o."directorStarred" = true
         AND o."starredByUserId" IS NULL
         AND w."prodDirectorUserId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_roadmap_opps_review_state"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        DROP CONSTRAINT IF EXISTS "FK_roadmap_opportunities_starred_by",
        DROP CONSTRAINT IF EXISTS "FK_roadmap_opportunities_reviewed_by",
        DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_decline_reason",
        DROP CONSTRAINT IF EXISTS "CHK_roadmap_opportunities_review_state",
        DROP COLUMN IF EXISTS "starredByUserId",
        DROP COLUMN IF EXISTS "selfChecked",
        DROP COLUMN IF EXISTS "declineReason",
        DROP COLUMN IF EXISTS "reviewedAt",
        DROP COLUMN IF EXISTS "reviewedBy",
        DROP COLUMN IF EXISTS "reviewState"
    `);
  }
}
