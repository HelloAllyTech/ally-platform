import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expert-review comments get the tag "Too vague" (`too_vague`): a point that
 * names no specific moment. A comment with it pre-fills the Evidence answer
 * under the verdict as No (debrief-agreement.util `prefillAnswers`).
 * Widens CHK_debrief_review_comments_tag; down narrows it back, clearing the
 * tag from any comment that carries it first.
 */
export class AddDebriefCommentTagTooVague1981900920000 implements MigrationInterface {
  name = 'AddDebriefCommentTagTooVague1981900920000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_review_comments" DROP CONSTRAINT IF EXISTS "CHK_debrief_review_comments_tag"`,
    );
    await queryRunner.query(`
      ALTER TABLE "debrief_review_comments" ADD CONSTRAINT "CHK_debrief_review_comments_tag"
        CHECK ("tag" IS NULL OR "tag" IN (
          'missed_moment','wrong_or_unsupported','tone','advice_doesnt_fit',
          'protocol','language','too_long_or_unclear','good_keep_this','too_vague'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "debrief_review_comments" SET "tag" = NULL WHERE "tag" = 'too_vague'`,
    );
    await queryRunner.query(
      `ALTER TABLE "debrief_review_comments" DROP CONSTRAINT IF EXISTS "CHK_debrief_review_comments_tag"`,
    );
    await queryRunner.query(`
      ALTER TABLE "debrief_review_comments" ADD CONSTRAINT "CHK_debrief_review_comments_tag"
        CHECK ("tag" IS NULL OR "tag" IN (
          'missed_moment','wrong_or_unsupported','tone','advice_doesnt_fit',
          'protocol','language','too_long_or_unclear','good_keep_this'))
    `);
  }
}
