import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Select-and-comment for learners on the web debrief.
 *
 * - `debrief_review_comments.source`: who wrote a comment, `expert` (every row so far) or `learner`.
 *   A learner's comment reuses the expert comment row (anchor, quoted words, body, status, idea link),
 *   so the PM agent's `comments_read` and the Console's review lists carry it with no second path.
 * - `debrief_learner_feature_access`: who has a learner-facing debrief feature. One row per person;
 *   a row with no user means everyone. Rows are added and removed from Debrief settings.
 *
 * Hand-written SQL, never `migration:generate`. Additive.
 */
export class AddLearnerSelectionComments1984800000000 implements MigrationInterface {
  name = 'AddLearnerSelectionComments1984800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_review_comments"
        ADD COLUMN IF NOT EXISTS "source" character varying(10) NOT NULL DEFAULT 'expert'
    `);
    await queryRunner.query(`
      ALTER TABLE "debrief_review_comments"
        DROP CONSTRAINT IF EXISTS "CHK_debrief_review_comments_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "debrief_review_comments"
        ADD CONSTRAINT "CHK_debrief_review_comments_source"
        CHECK ("source" IN ('expert', 'learner'))
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_learner_feature_access" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "feature" character varying(40) NOT NULL,
        "userId" integer,
        "addedBy" integer,
        CONSTRAINT "PK_debrief_learner_feature_access" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_learner_feature_access_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_learner_feature_access_uq"
        ON "debrief_learner_feature_access" ("feature", COALESCE("userId", 0))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "debrief_learner_feature_access"`,
    );
    await queryRunner.query(`
      ALTER TABLE "debrief_review_comments" DROP CONSTRAINT IF EXISTS "CHK_debrief_review_comments_source"
    `);
    await queryRunner.query(
      `ALTER TABLE "debrief_review_comments" DROP COLUMN IF EXISTS "source"`,
    );
  }
}
